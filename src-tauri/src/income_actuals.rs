use crate::accounts::get_main_account_id;
use crate::error::{AppError, AppResult};
use crate::logic::generate_occurrences_with_due_rule_rp;
use crate::state::AppState;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

type CmdResult<T> = Result<T, String>;

fn to_cmd_result<T>(r: AppResult<T>) -> CmdResult<T> {
  r.map_err(|e| e.to_string())
}

pub fn income_forecast_source_id(forecast_id: &str, occurrence_date: &str) -> String {
  format!("income_forecast:{forecast_id}:{occurrence_date}")
}

pub fn parse_income_forecast_source_id(source_id: &str) -> Option<(String, String)> {
  let rest = source_id.strip_prefix("income_forecast:")?;
  let (forecast_id, occurrence_date) = rest.rsplit_once(':')?;
  if occurrence_date.len() != 10 {
    return None;
  }
  Some((forecast_id.to_string(), occurrence_date.to_string()))
}

/// Ledger-Einnahme aus automatisierter Prognose (noch kein Ist-Wert hinterlegt).
pub fn is_prognostic_income_ledger(conn: &rusqlite::Connection, source_id: &str) -> AppResult<bool> {
  let Some((forecast_id, occurrence_date)) = parse_income_forecast_source_id(source_id) else {
    return Ok(false);
  };
  Ok(actual_amount_for_occurrence(conn, &forecast_id, &occurrence_date)?.is_none())
}

pub fn actual_amount_for_occurrence(
  conn: &rusqlite::Connection,
  forecast_id: &str,
  occurrence_date: &str,
) -> AppResult<Option<i64>> {
  conn
    .query_row(
      "SELECT amount_cents FROM income_forecast_actuals WHERE income_forecast_id = ?1 AND occurrence_date = ?2",
      params![forecast_id, occurrence_date],
      |r| r.get(0),
    )
    .optional()
    .map_err(Into::into)
}

pub fn effective_income_amount(
  conn: &rusqlite::Connection,
  forecast_id: &str,
  occurrence_date: &str,
  forecast_amount: i64,
) -> AppResult<(i64, bool)> {
  if let Some(actual) = actual_amount_for_occurrence(conn, forecast_id, occurrence_date)? {
    Ok((actual, true))
  } else {
    Ok((forecast_amount, false))
  }
}

fn ledger_id_for_occurrence(
  conn: &rusqlite::Connection,
  forecast_id: &str,
  occurrence_date: &str,
) -> AppResult<Option<String>> {
  let source_id = income_forecast_source_id(forecast_id, occurrence_date);
  conn
    .query_row(
      "SELECT id FROM ledger_transactions WHERE source_id = ?1 LIMIT 1",
      params![source_id],
      |r| r.get(0),
    )
    .optional()
    .map_err(Into::into)
}

pub fn sync_income_actual_ledger(
  conn: &rusqlite::Connection,
  forecast_id: &str,
  occurrence_date: &str,
  name: &str,
  amount_cents: i64,
  account_id: &str,
) -> AppResult<()> {
  let source_id = income_forecast_source_id(forecast_id, occurrence_date);
  let title = if name.trim().is_empty() {
    "Einnahme (Ist)".into()
  } else {
    name.to_string()
  };

  if let Some(lid) = ledger_id_for_occurrence(conn, forecast_id, occurrence_date)? {
    conn.execute(
      "UPDATE ledger_transactions SET date = ?2, amount_cents = ?3, title = ?4 WHERE id = ?1",
      params![lid, occurrence_date, amount_cents.abs(), title],
    )?;
    conn.execute(
      "UPDATE income_forecast_actuals SET ledger_transaction_id = ?3 WHERE income_forecast_id = ?1 AND occurrence_date = ?2",
      params![forecast_id, occurrence_date, lid],
    )?;
    return Ok(());
  }

  let tx_id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'income', ?5, NULL, ?6, ?7)",
    params![tx_id, occurrence_date, amount_cents.abs(), account_id, title, source_id, now],
  )?;
  conn.execute(
    "UPDATE income_forecast_actuals SET ledger_transaction_id = ?3 WHERE income_forecast_id = ?1 AND occurrence_date = ?2",
    params![forecast_id, occurrence_date, tx_id],
  )?;
  Ok(())
}

pub fn clear_income_actual_ledger(
  conn: &rusqlite::Connection,
  forecast_id: &str,
  occurrence_date: &str,
  forecast_amount: i64,
  name: &str,
  _main_id: &str,
) -> AppResult<()> {
  if let Some(lid) = ledger_id_for_occurrence(conn, forecast_id, occurrence_date)? {
    let title = if name.trim().is_empty() {
      "Einnahme (Prognose)".into()
    } else {
      format!("{name} (Prognose)")
    };
    conn.execute(
      "UPDATE ledger_transactions SET amount_cents = ?2, title = ?3 WHERE id = ?1",
      params![lid, forecast_amount.abs(), title],
    )?;
  }
  Ok(())
}

pub fn clear_all_actuals_for_forecast(conn: &rusqlite::Connection, forecast_id: &str) -> AppResult<()> {
  let dates: Vec<String> = conn
    .prepare("SELECT occurrence_date FROM income_forecast_actuals WHERE income_forecast_id = ?1")?
    .query_map(params![forecast_id], |r| r.get(0))?
    .collect::<Result<Vec<_>, _>>()?;
  for date in dates {
    conn.execute(
      "DELETE FROM income_forecast_actuals WHERE income_forecast_id = ?1 AND occurrence_date = ?2",
      params![forecast_id, date],
    )?;
  }
  Ok(())
}

#[tauri::command]
pub fn get_income_forecast_detail(state: State<'_, AppState>, id: String) -> CmdResult<crate::models::IncomeForecastDetail> {
  to_cmd_result(get_income_forecast_detail_inner(state, id))
}

fn get_income_forecast_detail_inner(state: State<'_, AppState>, id: String) -> AppResult<crate::models::IncomeForecastDetail> {
  let conn = state.conn.lock().unwrap();
  let row: (String, i64, String, String, String, Option<i64>, Option<String>, i64, String, String) = conn
    .query_row(
      "SELECT name, amount_cents, cadence, first_charge_date, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date, COALESCE(active,1), COALESCE(icon, 'banknote'), COALESCE(color, '#10b981') FROM income_forecasts WHERE id = ?1",
      params![id],
      |r| {
        Ok((
          r.get(0)?,
          r.get(1)?,
          r.get(2)?,
          r.get(3)?,
          r.get(4)?,
          r.get(5)?,
          r.get(6)?,
          r.get(7)?,
          r.get(8)?,
          r.get(9)?,
        ))
      },
    )
    .map_err(|_| AppError::Invalid("income forecast not found".into()))?;

  let mut stmt = conn.prepare(
    "SELECT occurrence_date, amount_cents FROM income_forecast_actuals WHERE income_forecast_id = ?1 ORDER BY occurrence_date ASC",
  )?;
  let actuals = stmt
    .query_map(params![id.clone()], |r| {
      Ok(crate::models::IncomeForecastActual {
        occurrence_date: r.get(0)?,
        amount_cents: r.get(1)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;

  Ok(crate::models::IncomeForecastDetail {
    forecast: crate::models::IncomeForecast {
      id: Uuid::parse_str(&id).unwrap(),
      name: row.0,
      amount_cents: row.1,
      cadence: row.2,
      first_charge_date: row.3,
      due_rule: row.4,
      day_of_month: row.5,
      end_charge_date: row.6,
      active: row.7 != 0,
      account_id: conn
        .query_row(
          "SELECT COALESCE(account_id, ?1) FROM income_forecasts WHERE id = ?2",
          params![get_main_account_id(&conn)?, id],
          |r| r.get(0),
        )
        .unwrap_or_else(|_| get_main_account_id(&conn).unwrap_or_default()),
      icon: row.8,
      color: row.9,
    },
    actuals,
  })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetIncomeForecastActualInput {
  pub id: String,
  pub occurrence_date: String,
  pub amount_cents: Option<i64>,
}

#[tauri::command]
pub fn set_income_forecast_actual(state: State<'_, AppState>, input: SetIncomeForecastActualInput) -> CmdResult<()> {
  to_cmd_result(set_income_forecast_actual_inner(state, input))
}

fn set_income_forecast_actual_inner(state: State<'_, AppState>, input: SetIncomeForecastActualInput) -> AppResult<()> {
  if input.occurrence_date.len() != 10 {
    return Err(AppError::Invalid("occurrenceDate must be YYYY-MM-DD".into()));
  }
  let conn = state.conn.lock().unwrap();
  let (name, forecast_amount, account_id): (String, i64, String) = conn.query_row(
    "SELECT name, amount_cents, COALESCE(account_id, ?1) FROM income_forecasts WHERE id = ?2",
    params![get_main_account_id(&conn)?, input.id],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
  )?;

  let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();

  match input.amount_cents {
    None | Some(0) => {
      clear_income_actual_ledger(&conn, &input.id, &input.occurrence_date, forecast_amount, &name, &account_id)?;
      conn.execute(
        "DELETE FROM income_forecast_actuals WHERE income_forecast_id = ?1 AND occurrence_date = ?2",
        params![input.id, input.occurrence_date],
      )?;
    }
    Some(amount) if amount > 0 => {
      conn.execute(
        "INSERT INTO income_forecast_actuals (income_forecast_id, occurrence_date, amount_cents, ledger_transaction_id) VALUES (?1, ?2, ?3, NULL)
         ON CONFLICT(income_forecast_id, occurrence_date) DO UPDATE SET amount_cents = excluded.amount_cents",
        params![input.id, input.occurrence_date, amount],
      )?;
      if input.occurrence_date.as_str() <= today.as_str() {
        sync_income_actual_ledger(&conn, &input.id, &input.occurrence_date, &name, amount, &account_id)?;
      }
    }
    _ => return Err(AppError::Invalid("amount must be positive".into())),
  }
  Ok(())
}

#[tauri::command]
pub fn list_income_forecast_occurrences(state: State<'_, AppState>, id: String) -> CmdResult<Vec<String>> {
  to_cmd_result(list_income_forecast_occurrences_inner(state, id))
}

fn list_income_forecast_occurrences_inner(state: State<'_, AppState>, id: String) -> AppResult<Vec<String>> {
  let conn = state.conn.lock().unwrap();
  let row: Option<(String, String, String, Option<i64>, Option<String>)> = conn
    .query_row(
      "SELECT first_charge_date, cadence, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date FROM income_forecasts WHERE id = ?1",
      params![id],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )
    .optional()?;
  let (first_charge_date, cadence, due_rule, day_of_month, end_charge_date) =
    row.ok_or_else(|| AppError::Invalid("not found".into()))?;

  let today = Utc::now().date_naive();
  let end = today + chrono::Duration::days(93);
  let range_end = end.format("%Y-%m-%d").to_string();

  Ok(generate_occurrences_with_due_rule_rp(
    &first_charge_date,
    &cadence,
    &due_rule,
    day_of_month.and_then(|x| if x > 0 { Some(x as u32) } else { None }),
    &first_charge_date,
    &range_end,
    500,
    end_charge_date.as_deref().filter(|s| !s.is_empty()),
  ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkIncomeForecastInput {
  pub ledger_transaction_id: String,
  pub forecast_id: String,
  pub occurrence_date: String,
}

#[tauri::command]
pub fn link_ledger_to_income_forecast(
  state: State<'_, AppState>,
  input: LinkIncomeForecastInput,
) -> CmdResult<()> {
  to_cmd_result(link_ledger_to_income_forecast_inner(state, input))
}

fn link_ledger_to_income_forecast_inner(
  state: State<'_, AppState>,
  input: LinkIncomeForecastInput,
) -> AppResult<()> {
  if input.occurrence_date.len() != 10 {
    return Err(AppError::Invalid("occurrenceDate must be YYYY-MM-DD".into()));
  }
  let conn = state.conn.lock().unwrap();
  let (kind, amount_cents, account_id): (String, i64, Option<String>) = conn.query_row(
    "SELECT kind, amount_cents, account_id FROM ledger_transactions WHERE id = ?1",
    params![input.ledger_transaction_id],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
  )?;
  if kind != "income" || amount_cents <= 0 {
    return Err(AppError::Invalid("Nur Einnahmen können zugeordnet werden".into()));
  }
  let (name, forecast_amount, forecast_account): (String, i64, String) = conn.query_row(
    "SELECT name, amount_cents, COALESCE(account_id, ?1) FROM income_forecasts WHERE id = ?2",
    params![get_main_account_id(&conn)?, input.forecast_id],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
  )?;
  let ledger_account = account_id.as_deref().unwrap_or("");
  if !ledger_account.is_empty() && ledger_account != forecast_account.as_str() {
    return Err(AppError::Invalid("Konto der Buchung passt nicht zur Prognose".into()));
  }

  let source_id = income_forecast_source_id(&input.forecast_id, &input.occurrence_date);
  if let Some(old_id) = ledger_id_for_occurrence(&conn, &input.forecast_id, &input.occurrence_date)? {
    if old_id != input.ledger_transaction_id {
      conn.execute("DELETE FROM ledger_transactions WHERE id = ?1", params![old_id])?;
    }
  }

  let title = if name.trim().is_empty() {
    "Einnahme (Ist)".into()
  } else {
    name.clone()
  };
  conn.execute(
    "UPDATE ledger_transactions SET source_id = ?2, title = ?3 WHERE id = ?1",
    params![input.ledger_transaction_id, source_id, title],
  )?;
  conn.execute(
    "INSERT INTO income_forecast_actuals (income_forecast_id, occurrence_date, amount_cents, ledger_transaction_id)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(income_forecast_id, occurrence_date) DO UPDATE SET amount_cents = excluded.amount_cents, ledger_transaction_id = excluded.ledger_transaction_id",
    params![
      input.forecast_id,
      input.occurrence_date,
      amount_cents,
      input.ledger_transaction_id,
    ],
  )?;
  let _ = forecast_amount;
  Ok(())
}
