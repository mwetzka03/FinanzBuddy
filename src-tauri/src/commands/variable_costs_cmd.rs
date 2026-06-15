use super::forecast_variable::{
  clear_variable_actual_ledger, finalize_all_variable_cost_months, sync_variable_actual_ledger,
  sync_variable_cost_from_transactions,
  sum_categorized_transactions_for_month, variable_cost_effective_amount,
  variable_cost_stats_month, variable_cost_tatsaechlich_cents, variable_costs_active_month,
  VariableCostTemplate, VARIABLE_COSTS_START_MONTH, month_is_closed,
};
use super::helpers::{normalize_color, normalize_icon, to_cmd_result, CmdResult};
use crate::logic::last_day_of_month_iso;
use crate::accounts::get_main_account_id;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use chrono::{DateTime, Utc};
use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn list_variable_costs(state: State<'_, AppState>) -> CmdResult<Vec<crate::models::VariableCost>> {
  to_cmd_result(list_variable_costs_inner(state))
}

fn list_variable_costs_inner(state: State<'_, AppState>) -> AppResult<Vec<crate::models::VariableCost>> {
  let conn = state.conn.lock().unwrap();
  finalize_all_variable_cost_months(&conn)?;
  let current_month = variable_cost_stats_month();
  let month_closed = month_is_closed(&current_month)?;
  let main_id = get_main_account_id(&conn)?;
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents, notes, icon, color, created_at, COALESCE(account_id, ?1) FROM variable_costs ORDER BY name ASC",
  )?;
  let rows = stmt
    .query_map(params![main_id.clone()], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, i64>(2)?,
        r.get::<_, Option<String>>(3)?,
        r.get::<_, Option<String>>(4)?.unwrap_or_else(|| "wallet".into()),
        r.get::<_, Option<String>>(5)?.unwrap_or_else(|| "#6366f1".into()),
        r.get::<_, String>(6)?,
        r.get::<_, String>(7)?,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;

  let mut out = Vec::new();
  for (id, name, amount_cents, notes, icon, color, created_at, account_id) in rows {
    let template = VariableCostTemplate {
      id: id.clone(),
      name: name.clone(),
      amount_cents,
      account_id: account_id.clone(),
    };
    let spent = sum_categorized_transactions_for_month(&conn, &id, &current_month).unwrap_or(0);
    let tatsaechlich = variable_cost_tatsaechlich_cents(&conn, &id, &current_month).unwrap_or(spent);
    let (_effective, _) = variable_cost_effective_amount(&conn, &template, &current_month)?;
    out.push(crate::models::VariableCost {
      id: Uuid::parse_str(&id).unwrap(),
      name,
      amount_cents,
      notes,
      icon,
      color,
      created_at: DateTime::parse_from_rfc3339(created_at.as_str())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now()),
      current_month_forecast_cents: amount_cents,
      current_month_actual_cents: tatsaechlich,
      current_month_spent_cents: spent,
      current_month: current_month.clone(),
      current_month_closed: month_closed,
      account_id,
    });
  }
  Ok(out)
}

#[tauri::command]
pub fn get_variable_cost_detail(state: State<'_, AppState>, id: String) -> CmdResult<crate::models::VariableCostDetail> {
  to_cmd_result(get_variable_cost_detail_inner(state, id))
}

fn get_variable_cost_detail_inner(state: State<'_, AppState>, id: String) -> AppResult<crate::models::VariableCostDetail> {
  let conn = state.conn.lock().unwrap();
  finalize_all_variable_cost_months(&conn)?;
  let main_id = get_main_account_id(&conn)?;
  let (name, amount_cents, notes, icon, color, created_at, account_id): (
    String,
    i64,
    Option<String>,
    String,
    String,
    String,
    String,
  ) = conn
    .query_row(
      "SELECT name, amount_cents, notes, COALESCE(icon, 'shop'), COALESCE(color, '#6366f1'), created_at, COALESCE(account_id, ?2) FROM variable_costs WHERE id = ?1",
      params![id, main_id],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
    )
    .map_err(|_| AppError::Invalid("variable cost not found".into()))?;

  let mut stmt = conn.prepare(
    "SELECT month, amount_cents, actual_source FROM variable_cost_actuals WHERE variable_cost_id = ?1 ORDER BY month ASC",
  )?;
  let actuals = stmt
    .query_map(params![id.clone()], |r| {
      Ok(crate::models::VariableCostActual {
        month: r.get(0)?,
        amount_cents: r.get(1)?,
        actual_source: r.get(2)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;

  let mut tx_stmt = conn.prepare(
    "SELECT l.id, l.date, l.title, l.amount_cents, l.notes,
            s.amount_cents AS split_amount_cents
     FROM ledger_transactions l
     LEFT JOIN ledger_variable_cost_splits s
       ON s.ledger_transaction_id = l.id AND s.variable_cost_id = ?1
     WHERE l.variable_cost_id = ?1
        OR s.variable_cost_id = ?1
     ORDER BY l.date ASC, l.created_at ASC",
  )?;
  let transactions = tx_stmt
    .query_map(params![id.clone()], |r| {
      let split_amount: Option<i64> = r.get(5)?;
      Ok(crate::models::VariableCostCategorizedTransaction {
        id: Uuid::parse_str(r.get::<_, String>(0)?.as_str()).unwrap(),
        date: r.get(1)?,
        title: r.get(2)?,
        amount_cents: r.get(3)?,
        notes: r.get(4)?,
        split_amount_cents: split_amount,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;

  let current_month = variable_cost_stats_month();
  let month_closed = month_is_closed(&current_month)?;
  let template = VariableCostTemplate {
    id: id.clone(),
    name: name.clone(),
    amount_cents,
    account_id: account_id.clone(),
  };
  let spent = sum_categorized_transactions_for_month(&conn, &id, &current_month).unwrap_or(0);
  let tatsaechlich = variable_cost_tatsaechlich_cents(&conn, &id, &current_month)?;
  let (_effective, _) = variable_cost_effective_amount(&conn, &template, &current_month)?;

  Ok(crate::models::VariableCostDetail {
    cost: crate::models::VariableCost {
      id: Uuid::parse_str(&id).unwrap(),
      name,
      amount_cents,
      notes,
      icon,
      color,
      created_at: DateTime::parse_from_rfc3339(created_at.as_str())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now()),
      current_month_forecast_cents: amount_cents,
      current_month_actual_cents: tatsaechlich,
      current_month_spent_cents: spent,
      current_month: current_month.clone(),
      current_month_closed: month_closed,
      account_id,
    },
    actuals,
    transactions,
  })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVariableCostInput {
  pub name: String,
  pub amount_cents: i64,
  pub notes: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
}

#[tauri::command]
pub fn create_variable_cost(state: State<'_, AppState>, input: CreateVariableCostInput) -> CmdResult<()> {
  to_cmd_result(create_variable_cost_inner(state, input))
}

fn create_variable_cost_inner(state: State<'_, AppState>, input: CreateVariableCostInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  if input.amount_cents <= 0 {
    return Err(AppError::Invalid("amount must be positive".into()));
  }
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let legacy_date = last_day_of_month_iso(VARIABLE_COSTS_START_MONTH).unwrap_or_else(|| "2026-06-30".to_string());
  let conn = state.conn.lock().unwrap();
  let icon = normalize_icon(input.icon, "wallet");
  let color = normalize_color(input.color, "#6366f1");
  conn.execute(
    "INSERT INTO variable_costs (id, name, amount_cents, charge_day, notes, icon, color, created_at, date) VALUES (?1, ?2, ?3, 31, ?4, ?5, ?6, ?7, ?8)",
    params![id, input.name, input.amount_cents, input.notes, icon, color, now, legacy_date],
  )?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVariableCostInput {
  pub id: String,
  pub name: String,
  pub amount_cents: i64,
  pub notes: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
}

#[tauri::command]
pub fn update_variable_cost(state: State<'_, AppState>, input: UpdateVariableCostInput) -> CmdResult<()> {
  to_cmd_result(update_variable_cost_inner(state, input))
}

fn update_variable_cost_inner(state: State<'_, AppState>, input: UpdateVariableCostInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  if input.amount_cents <= 0 {
    return Err(AppError::Invalid("amount must be positive".into()));
  }
  let conn = state.conn.lock().unwrap();
  let icon = normalize_icon(input.icon, "wallet");
  let color = normalize_color(input.color, "#6366f1");
  conn.execute(
    "UPDATE variable_costs SET name=?2, amount_cents=?3, notes=?4, icon=?5, color=?6 WHERE id=?1",
    params![input.id, input.name, input.amount_cents, input.notes, icon, color],
  )?;
  crate::cost_assignment::sync_ledger_style_for_variable_cost(&conn, &input.id)?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetVariableCostActualInput {
  pub id: String,
  pub month: String,
  pub amount_cents: Option<i64>,
}

#[tauri::command]
pub fn set_variable_cost_actual(state: State<'_, AppState>, input: SetVariableCostActualInput) -> CmdResult<()> {
  to_cmd_result(set_variable_cost_actual_inner(state, input))
}

fn set_variable_cost_actual_inner(state: State<'_, AppState>, input: SetVariableCostActualInput) -> AppResult<()> {
  if input.month.len() != 7 {
    return Err(AppError::Invalid("month must be YYYY-MM".into()));
  }
  if !variable_costs_active_month(&input.month) {
    return Err(AppError::Invalid(format!(
      "variable costs apply from {VARIABLE_COSTS_START_MONTH} onwards"
    )));
  }
  let conn = state.conn.lock().unwrap();
  let main_id = get_main_account_id(&conn)?;
  let name: String = conn.query_row(
    "SELECT name FROM variable_costs WHERE id = ?1",
    params![input.id],
    |r| r.get(0),
  )?;
  let charge_date = last_day_of_month_iso(&input.month)
    .ok_or_else(|| AppError::Invalid("invalid month".into()))?;

  match input.amount_cents {
    None | Some(0) => {
      clear_variable_actual_ledger(&conn, &input.id, &input.month)?;
      conn.execute(
        "DELETE FROM variable_cost_actuals WHERE variable_cost_id = ?1 AND month = ?2 AND actual_source = 'manual'",
        params![input.id, input.month],
      )?;
      if month_is_closed(&input.month)? {
        sync_variable_cost_from_transactions(&conn, &input.id, &input.month)?;
      }
    }
    Some(amount) if amount > 0 => {
      clear_variable_actual_ledger(&conn, &input.id, &input.month)?;
      conn.execute(
        "INSERT INTO variable_cost_actuals (variable_cost_id, month, amount_cents, ledger_transaction_id, actual_source) VALUES (?1, ?2, ?3, NULL, 'manual')
         ON CONFLICT(variable_cost_id, month) DO UPDATE SET amount_cents = excluded.amount_cents, actual_source = 'manual', ledger_transaction_id = NULL",
        params![input.id, input.month, amount],
      )?;
      if month_is_closed(&input.month)? {
        sync_variable_actual_ledger(&conn, &input.id, &input.month, &name, amount, &charge_date, &main_id)?;
      }
    }
    _ => return Err(AppError::Invalid("amount must be positive".into())),
  }
  Ok(())
}

#[tauri::command]
pub fn delete_variable_cost(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_variable_cost_inner(state, id))
}

fn delete_variable_cost_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  let months: Vec<String> = conn
    .prepare("SELECT month FROM variable_cost_actuals WHERE variable_cost_id = ?1")?
    .query_map(params![id.clone()], |r| r.get(0))?
    .collect::<Result<Vec<_>, _>>()?;
  for month in months {
    clear_variable_actual_ledger(&conn, &id, &month)?;
  }
  conn.execute(
    "UPDATE ledger_transactions SET variable_cost_id = NULL WHERE variable_cost_id = ?1",
    params![id.clone()],
  )?;
  conn.execute(
    "DELETE FROM variable_cost_actuals WHERE variable_cost_id = ?1",
    params![id.clone()],
  )?;
  conn.execute("DELETE FROM variable_costs WHERE id = ?1", params![id])?;
  Ok(())
}
