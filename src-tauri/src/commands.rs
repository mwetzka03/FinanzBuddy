use crate::accounts::get_main_account_id;
use crate::error::{AppError, AppResult};
use crate::income_actuals::{clear_all_actuals_for_forecast, effective_income_amount, income_forecast_source_id};
use crate::logic::{last_day_of_month_iso, generate_occurrences_with_due_rule_rp, month_add_iso, month_bounds};
use crate::models::{Account, BuyItem, DayView, FixedCost, IncomeForecast, LedgerTransaction, MonthView, TimelineEvent};
use crate::state::AppState;
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

type CmdResult<T> = Result<T, String>;

fn to_cmd_result<T>(res: AppResult<T>) -> CmdResult<T> {
  res.map_err(|e| e.to_string())
}

fn default_icon_for_kind(kind: &str) -> &'static str {
  match kind {
    "income" => "banknote",
    "expense" | "buy_apply" | "buy_planned" => "shop",
    "transfer" => "wallet",
    "fixed_cost" => "calendar",
    "adjustment" => "target",
    "forecast" => "trending",
    _ => "target",
  }
}

fn default_color_for_kind(kind: &str) -> &'static str {
  match kind {
    "income" => "#10b981",
    "expense" | "buy_apply" | "buy_planned" => "#ec4899",
    "transfer" => "#6366f1",
    "fixed_cost" => "#8b5cf6",
    "adjustment" => "#64748b",
    "forecast" => "#3b82f6",
    _ => "#6366f1",
  }
}

fn normalize_icon(icon: Option<String>, fallback: &str) -> String {
  icon.filter(|s| !s.trim().is_empty())
    .unwrap_or_else(|| fallback.to_string())
}

fn normalize_color(color: Option<String>, fallback: &str) -> String {
  color.filter(|s| !s.trim().is_empty())
    .unwrap_or_else(|| fallback.to_string())
}

fn account_liquid_map(conn: &rusqlite::Connection) -> AppResult<std::collections::HashMap<String, bool>> {
  let mut map = std::collections::HashMap::new();
  let mut stmt = conn.prepare("SELECT id, is_liquid FROM accounts")?;
  let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)))?;
  for row in rows {
    let (id, is_liquid) = row?;
    map.insert(id, is_liquid);
  }
  Ok(map)
}

fn account_name_map(conn: &rusqlite::Connection) -> AppResult<std::collections::HashMap<String, String>> {
  let mut map = std::collections::HashMap::new();
  let mut stmt = conn.prepare("SELECT id, name FROM accounts")?;
  let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
  for row in rows {
    let (id, name) = row?;
    map.insert(id, name);
  }
  Ok(map)
}

fn account_name_of(map: &std::collections::HashMap<String, String>, id: &str) -> String {
  map.get(id).cloned().unwrap_or_else(|| "Unbekannt".into())
}

fn event_matches_account(
  account_filter: &Option<String>,
  main_id: &str,
  event_account_id: Option<&str>,
) -> bool {
  match account_filter {
    None => true,
    Some(fid) => event_account_id == Some(fid.as_str()) || (event_account_id.is_none() && fid == main_id),
  }
}

fn forecasts_apply(account_filter: &Option<String>, main_id: &str) -> bool {
  match account_filter {
    None => true,
    Some(aid) => aid == main_id,
  }
}

fn income_occurrence_booked(conn: &rusqlite::Connection, forecast_id: &str, occurrence_date: &str) -> AppResult<bool> {
  let source_id = income_forecast_source_id(forecast_id, occurrence_date);
  let count: i64 = conn.query_row(
    "SELECT COUNT(*) FROM ledger_transactions WHERE source_id = ?1",
    params![source_id],
    |r| r.get(0),
  )?;
  if count > 0 {
    return Ok(true);
  }
  let legacy: i64 = conn.query_row(
    "SELECT COUNT(*) FROM ledger_transactions WHERE source_id = ?1 AND date = ?2",
    params![forecast_id, occurrence_date],
    |r| r.get(0),
  )?;
  Ok(legacy > 0)
}

struct IncomeForecastTemplate {
  id: String,
  name: String,
  amount_cents: i64,
  cadence: String,
  first_charge_date: String,
  due_rule: String,
  day_of_month: Option<i64>,
  end_charge_date: Option<String>,
}

fn load_income_forecast_templates(conn: &rusqlite::Connection) -> AppResult<Vec<IncomeForecastTemplate>> {
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents, cadence, first_charge_date, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date
     FROM income_forecasts WHERE COALESCE(active, 1) = 1",
  )?;
  let rows = stmt
    .query_map([], |r| {
      Ok(IncomeForecastTemplate {
        id: r.get(0)?,
        name: r.get(1)?,
        amount_cents: r.get(2)?,
        cadence: r.get(3)?,
        first_charge_date: r.get(4)?,
        due_rule: r.get(5)?,
        day_of_month: r.get(6)?,
        end_charge_date: r.get(7)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

fn income_forecast_occurrences(
  template: &IncomeForecastTemplate,
  range_start: &str,
  range_end: &str,
  limit: usize,
) -> Vec<String> {
  generate_occurrences_with_due_rule_rp(
    &template.first_charge_date,
    &template.cadence,
    &template.due_rule,
    template.day_of_month.and_then(|x| if x > 0 { Some(x as u32) } else { None }),
    range_start,
    range_end,
    limit,
    template.end_charge_date.as_deref().filter(|s| !s.is_empty()),
  )
}

fn materialize_due_income_forecasts(conn: &rusqlite::Connection) -> AppResult<()> {
  let main_id = get_main_account_id(conn)?;
  let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();

  for t in load_income_forecast_templates(conn)? {
    let occ = income_forecast_occurrences(&t, &t.first_charge_date, &today, 5000);
    for date in occ {
      if date.as_str() > today.as_str() {
        continue;
      }
      if income_occurrence_booked(conn, &t.id, &date)? {
        continue;
      }
      let (amount, is_actual) = effective_income_amount(conn, &t.id, &date, t.amount_cents)?;
      let ledger_id = Uuid::new_v4().to_string();
      let now = Utc::now().to_rfc3339();
      let title = if is_actual {
        if t.name.trim().is_empty() {
          "Einnahme (Ist)".into()
        } else {
          t.name.clone()
        }
      } else {
        income_forecast_title(&t.name)
      };
      let source_id = income_forecast_source_id(&t.id, &date);
      conn.execute(
        "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'income', ?5, NULL, ?6, ?7)",
        params![ledger_id, date, amount.abs(), main_id, title, source_id, now],
      )?;
    }
  }
  Ok(())
}

fn income_forecasts_forecast_until(conn: &rusqlite::Connection, cutoff_inclusive: &str) -> AppResult<i64> {
  let mut sum: i64 = 0;
  for t in load_income_forecast_templates(conn)? {
    let occ = income_forecast_occurrences(&t, &t.first_charge_date, cutoff_inclusive, 5000);
    for date in occ {
      if date.as_str() > cutoff_inclusive {
        continue;
      }
      if !income_occurrence_booked(conn, &t.id, &date)? {
        let (amount, _) = effective_income_amount(conn, &t.id, &date, t.amount_cents)?;
        sum += amount;
      }
    }
  }
  Ok(sum)
}

fn push_unbooked_income_events_for_range(
  conn: &rusqlite::Connection,
  range_start: &str,
  range_end: &str,
  accounting_month: &str,
  main_id: &str,
  main_name: &str,
  events: &mut Vec<TimelineEvent>,
  income_sum: &mut i64,
) -> AppResult<()> {
  for t in load_income_forecast_templates(conn)? {
    let occ = income_forecast_occurrences(&t, range_start, range_end, 500);
    for ev_date in occ {
      if income_occurrence_booked(conn, &t.id, &ev_date)? {
        continue;
      }
      let (amount, is_actual) = effective_income_amount(conn, &t.id, &ev_date, t.amount_cents)?;
      if crate::logic::income_accounting_month(&ev_date).as_deref() == Some(accounting_month) {
        *income_sum += amount;
      }
      events.push(TimelineEvent {
        id: format!("income:{}:{}", t.id, ev_date),
        r#type: "income".into(),
        date: ev_date,
        title: if is_actual {
          if t.name.trim().is_empty() {
            "Einnahmen (Ist)".into()
          } else {
            t.name.clone()
          }
        } else if t.name.trim().is_empty() {
          "Einnahmen (Prognose)".into()
        } else {
          format!("{} (Prognose)", t.name)
        },
        amount_cents: amount,
        account_id: Some(main_id.to_string()),
        account_name: Some(main_name.to_string()),
      });
    }
  }
  Ok(())
}

fn income_forecast_title(name: &str) -> String {
  if name.trim().is_empty() {
    "Einnahme (Prognose)".into()
  } else {
    name.to_string()
  }
}

const VARIABLE_COSTS_START_MONTH: &str = "2026-06";

fn variable_cost_source_id(vc_id: &str, month: &str) -> String {
  format!("variable_cost:{}:{}", vc_id, month)
}

fn variable_costs_active_month(month: &str) -> bool {
  month >= VARIABLE_COSTS_START_MONTH
}

/// Monat für Anzeige von Budget/Ist in Listen und Übersicht (ab Startmonat der variablen Kosten).
fn variable_cost_stats_month() -> String {
  let now = Utc::now().format("%Y-%m").to_string();
  if now.as_str() < VARIABLE_COSTS_START_MONTH {
    VARIABLE_COSTS_START_MONTH.to_string()
  } else {
    now
  }
}

struct VariableCostTemplate {
  id: String,
  name: String,
  amount_cents: i64,
}

fn load_variable_cost_templates(conn: &rusqlite::Connection) -> AppResult<Vec<VariableCostTemplate>> {
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents FROM variable_costs ORDER BY name ASC",
  )?;
  let rows = stmt
    .query_map([], |r| {
      Ok(VariableCostTemplate {
        id: r.get(0)?,
        name: r.get(1)?,
        amount_cents: r.get(2)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

fn actual_amount_for_month(
  conn: &rusqlite::Connection,
  vc_id: &str,
  month: &str,
) -> AppResult<Option<i64>> {
  conn
    .query_row(
      "SELECT amount_cents FROM variable_cost_actuals WHERE variable_cost_id = ?1 AND month = ?2",
      params![vc_id, month],
      |r| r.get(0),
    )
    .optional()
    .map_err(Into::into)
}

fn month_from_date(date: &str) -> AppResult<String> {
  if date.len() < 7 {
    return Err(AppError::Invalid("date must be YYYY-MM-DD".into()));
  }
  Ok(date[..7].to_string())
}

fn sum_categorized_transactions_for_month(
  conn: &rusqlite::Connection,
  vc_id: &str,
  month: &str,
) -> AppResult<i64> {
  let (start, end) = month_bounds(month).ok_or_else(|| AppError::Invalid("invalid month".into()))?;
  let range_start = iso_date(start);
  let range_end = iso_date(end);
  let sum: i64 = conn.query_row(
    "SELECT COALESCE(SUM(ABS(amount_cents)), 0) FROM ledger_transactions
     WHERE variable_cost_id = ?1 AND kind = 'expense' AND date >= ?2 AND date <= ?3",
    params![vc_id, range_start, range_end],
    |r| r.get(0),
  )?;
  Ok(sum)
}

/// Kategorisierte VK-Transaktionen im laufenden Monat nicht zusätzlich zum Prognosewert zählen.
fn open_month_categorized_variable_cost_ledger_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_filter: &Option<String>,
  main_id: &str,
) -> AppResult<i64> {
  let mut stmt = conn.prepare(
    "SELECT amount_cents, date, account_id FROM ledger_transactions
     WHERE kind = 'expense' AND variable_cost_id IS NOT NULL AND date <= ?1",
  )?;
  let rows = stmt.query_map(params![date_inclusive], |r| {
    Ok((
      r.get::<_, i64>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, Option<String>>(2)?,
    ))
  })?;
  let mut sum: i64 = 0;
  for row in rows {
    let (amount_cents, tx_date, account_id) = row?;
    let month = month_from_date(&tx_date)?;
    if month_is_closed(&month)? {
      continue;
    }
    let aid = account_id.as_deref().unwrap_or("");
    if !event_matches_account(account_filter, main_id, Some(aid)) {
      continue;
    }
    sum += amount_cents.abs();
  }
  Ok(sum)
}

fn should_hide_categorized_variable_cost_event(
  variable_cost_id: Option<&str>,
  tx_date: &str,
) -> AppResult<bool> {
  if variable_cost_id.is_none() {
    return Ok(false);
  }
  let month = month_from_date(tx_date)?;
  Ok(!month_is_closed(&month)?)
}

fn validate_variable_cost_id(conn: &rusqlite::Connection, vc_id: &str) -> AppResult<()> {
  let exists: i64 = conn.query_row(
    "SELECT COUNT(*) FROM variable_costs WHERE id = ?1",
    params![vc_id],
    |r| r.get(0),
  )?;
  if exists == 0 {
    return Err(AppError::Invalid("variable cost category not found".into()));
  }
  Ok(())
}

fn month_is_closed(month: &str) -> AppResult<bool> {
  let end = last_day_of_month_iso(month).ok_or_else(|| AppError::Invalid("invalid month".into()))?;
  let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();
  Ok(today.as_str() > end.as_str())
}

fn clear_transaction_derived_actual(
  conn: &rusqlite::Connection,
  vc_id: &str,
  month: &str,
) -> AppResult<()> {
  let source: Option<String> = conn
    .query_row(
      "SELECT actual_source FROM variable_cost_actuals WHERE variable_cost_id = ?1 AND month = ?2",
      params![vc_id, month],
      |r| r.get(0),
    )
    .optional()?;
  if source.as_deref() == Some("transactions") {
    clear_variable_actual_ledger(conn, vc_id, month)?;
    conn.execute(
      "DELETE FROM variable_cost_actuals WHERE variable_cost_id = ?1 AND month = ?2",
      params![vc_id, month],
    )?;
  }
  Ok(())
}

fn sync_variable_cost_from_transactions(
  conn: &rusqlite::Connection,
  vc_id: &str,
  month: &str,
) -> AppResult<()> {
  if !variable_costs_active_month(month) {
    return Ok(());
  }

  if !month_is_closed(month)? {
    clear_transaction_derived_actual(conn, vc_id, month)?;
    return Ok(());
  }

  if let Some((amount, source)) = actual_for_month(conn, vc_id, month)? {
    if source.as_deref() == Some("manual") {
      let name: String = conn.query_row(
        "SELECT name FROM variable_costs WHERE id = ?1",
        params![vc_id],
        |r| r.get(0),
      )?;
      let charge_date = last_day_of_month_iso(month).unwrap_or_else(|| month.to_string());
      let main_id = get_main_account_id(conn)?;
      sync_variable_actual_ledger(conn, vc_id, month, &name, amount, &charge_date, &main_id)?;
      return Ok(());
    }
  }

  let sum = sum_categorized_transactions_for_month(conn, vc_id, month)?;
  if sum > 0 {
    clear_variable_actual_ledger(conn, vc_id, month)?;
    conn.execute(
      "INSERT INTO variable_cost_actuals (variable_cost_id, month, amount_cents, ledger_transaction_id, actual_source)
       VALUES (?1, ?2, ?3, NULL, 'transactions')
       ON CONFLICT(variable_cost_id, month) DO UPDATE SET
         amount_cents = excluded.amount_cents,
         actual_source = 'transactions',
         ledger_transaction_id = NULL",
      params![vc_id, month, sum],
    )?;
    return Ok(());
  }

  clear_transaction_derived_actual(conn, vc_id, month)?;
  Ok(())
}

fn finalize_all_variable_cost_months(conn: &rusqlite::Connection) -> AppResult<()> {
  for t in load_variable_cost_templates(conn)? {
    let mut months: std::collections::HashSet<String> = std::collections::HashSet::new();
    {
      let mut stmt = conn.prepare(
        "SELECT DISTINCT substr(date, 1, 7) FROM ledger_transactions
         WHERE variable_cost_id = ?1 AND kind = 'expense'",
      )?;
      let rows = stmt.query_map(params![t.id.clone()], |r| r.get::<_, String>(0))?;
      for row in rows {
        months.insert(row?);
      }
    }
    {
      let mut stmt = conn.prepare(
        "SELECT month FROM variable_cost_actuals
         WHERE variable_cost_id = ?1 AND actual_source = 'transactions'",
      )?;
      let rows = stmt.query_map(params![t.id.clone()], |r| r.get::<_, String>(0))?;
      for row in rows {
        months.insert(row?);
      }
    }
    for month in months {
      sync_variable_cost_from_transactions(conn, &t.id, &month)?;
    }
  }
  Ok(())
}

fn resync_variable_cost_months(
  conn: &rusqlite::Connection,
  vc_id: Option<&str>,
  date: Option<&str>,
) -> AppResult<()> {
  if let (Some(vc_id), Some(date)) = (vc_id, date) {
    if !vc_id.is_empty() {
      let month = month_from_date(date)?;
      sync_variable_cost_from_transactions(conn, vc_id, &month)?;
    }
  }
  Ok(())
}

fn ledger_tx_is_categorizable(conn: &rusqlite::Connection, id: &str) -> AppResult<bool> {
  let (kind, source_id): (String, Option<String>) = conn.query_row(
    "SELECT kind, source_id FROM ledger_transactions WHERE id = ?1",
    params![id],
    |r| Ok((r.get(0)?, r.get(1)?)),
  )?;
  if kind == "transfer" {
    return Ok(false);
  }
  if let Some(source_id) = source_id {
    if source_id.starts_with("variable_cost:") || source_id.starts_with("income_forecast:") {
      return Ok(false);
    }
  }
  Ok(true)
}

fn normalize_variable_cost_id_for_kind(kind: &str, variable_cost_id: Option<String>) -> AppResult<Option<String>> {
  match variable_cost_id {
    None => Ok(None),
    Some(v) if v.trim().is_empty() => Ok(None),
    Some(v) if kind == "expense" => Ok(Some(v)),
    Some(_) => Err(AppError::Invalid(
      "Kategorie ist nur für Ausgaben möglich".into(),
    )),
  }
}

fn actual_for_month(
  conn: &rusqlite::Connection,
  vc_id: &str,
  month: &str,
) -> AppResult<Option<(i64, Option<String>)>> {
  conn
    .query_row(
      "SELECT amount_cents, actual_source FROM variable_cost_actuals WHERE variable_cost_id = ?1 AND month = ?2",
      params![vc_id, month],
      |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .map_err(Into::into)
}

/// Anzeige Ist: manueller Override, sonst Summe kategorisierter Transaktionen.
fn variable_cost_tatsaechlich_cents(
  conn: &rusqlite::Connection,
  vc_id: &str,
  month: &str,
) -> AppResult<i64> {
  let spent = sum_categorized_transactions_for_month(conn, vc_id, month)?;
  if let Some((amount, source)) = actual_for_month(conn, vc_id, month)? {
    if source.as_deref() == Some("manual") {
      return Ok(amount);
    }
  }
  Ok(spent)
}

fn variable_cost_effective_amount(
  conn: &rusqlite::Connection,
  template: &VariableCostTemplate,
  month: &str,
) -> AppResult<(i64, bool)> {
  let closed = month_is_closed(month)?;
  if !closed {
    return Ok((template.amount_cents, false));
  }

  if let Some((amount, source)) = actual_for_month(conn, &template.id, month)? {
    if source.as_deref() == Some("manual") {
      return Ok((amount, true));
    }
    if source.as_deref() == Some("transactions") {
      return Ok((amount, true));
    }
  }

  let spent = sum_categorized_transactions_for_month(conn, &template.id, month)?;
  if spent > 0 {
    return Ok((spent, true));
  }

  Ok((template.amount_cents, false))
}

fn sync_variable_actual_ledger(
  conn: &rusqlite::Connection,
  vc_id: &str,
  month: &str,
  name: &str,
  amount_cents: i64,
  charge_date: &str,
  main_id: &str,
) -> AppResult<()> {
  let source_id = variable_cost_source_id(vc_id, month);
  let title = format!("{name} ({month})");
  let existing: Option<String> = conn
    .query_row(
      "SELECT ledger_transaction_id FROM variable_cost_actuals WHERE variable_cost_id = ?1 AND month = ?2",
      params![vc_id, month],
      |r| r.get(0),
    )
    .optional()?
    .flatten();

  if let Some(lid) = existing {
    conn.execute(
      "UPDATE ledger_transactions SET date = ?2, amount_cents = ?3, title = ?4 WHERE id = ?1",
      params![lid, charge_date, -amount_cents.abs(), title],
    )?;
    return Ok(());
  }

  let tx_id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'expense', ?5, NULL, ?6, ?7)",
    params![tx_id, charge_date, -amount_cents.abs(), main_id, title, source_id, now],
  )?;
  conn.execute(
    "UPDATE variable_cost_actuals SET ledger_transaction_id = ?3 WHERE variable_cost_id = ?1 AND month = ?2",
    params![vc_id, month, tx_id],
  )?;
  Ok(())
}

fn clear_variable_actual_ledger(conn: &rusqlite::Connection, vc_id: &str, month: &str) -> AppResult<()> {
  let ledger_id: Option<String> = conn
    .query_row(
      "SELECT ledger_transaction_id FROM variable_cost_actuals WHERE variable_cost_id = ?1 AND month = ?2",
      params![vc_id, month],
      |r| r.get(0),
    )
    .optional()?
    .flatten();
  if let Some(lid) = ledger_id {
    conn.execute("DELETE FROM ledger_transactions WHERE id = ?1", params![lid])?;
  }
  conn.execute(
    "DELETE FROM ledger_transactions WHERE source_id = ?1",
    params![variable_cost_source_id(vc_id, month)],
  )?;
  Ok(())
}

fn variable_costs_forecast_until(conn: &rusqlite::Connection, cutoff_inclusive: &str) -> AppResult<i64> {
  let cutoff_month = if cutoff_inclusive.len() >= 7 {
    &cutoff_inclusive[..7]
  } else {
    cutoff_inclusive
  };
  if cutoff_month < VARIABLE_COSTS_START_MONTH {
    return Ok(0);
  }

  let templates = load_variable_cost_templates(conn)?;
  let mut sum: i64 = 0;
  let mut month = VARIABLE_COSTS_START_MONTH.to_string();

  while month.as_str() <= cutoff_month {
    if variable_costs_active_month(&month) {
      for t in &templates {
        let charge_date =
          last_day_of_month_iso(&month).unwrap_or_else(|| month.clone());
        if charge_date.as_str() > cutoff_inclusive {
          continue;
        }
        if actual_amount_for_month(conn, &t.id, &month)?.is_some() {
          continue;
        }
        sum += t.amount_cents;
      }
    }
    let Some(next) = month_add_iso(&month, 1) else {
      break;
    };
    month = next;
  }
  Ok(sum)
}

fn push_variable_cost_events_for_month(
  conn: &rusqlite::Connection,
  month: &str,
  main_id: &str,
  main_name: &str,
  events: &mut Vec<TimelineEvent>,
  variable_costs_sum: &mut i64,
) -> AppResult<()> {
  if !variable_costs_active_month(month) {
    return Ok(());
  }
  for t in load_variable_cost_templates(conn)? {
    let charge_date = last_day_of_month_iso(month).unwrap_or_else(|| month.to_string());
    let (amount, is_actual) = variable_cost_effective_amount(conn, &t, month)?;
    *variable_costs_sum += amount;
    if is_actual {
      continue;
    }
    events.push(TimelineEvent {
      id: format!("variable_cost:{}:{}", t.id, charge_date),
      r#type: "variable_cost".into(),
      date: charge_date,
      title: format!("{} (Prognose)", t.name),
      amount_cents: -amount,
      account_id: Some(main_id.to_string()),
      account_name: Some(main_name.to_string()),
    });
  }
  Ok(())
}

fn load_active_fixed_costs(
  conn: &rusqlite::Connection,
  main_id: &str,
) -> AppResult<
  Vec<(
    String,
    String,
    i64,
    String,
    String,
    String,
    Option<i64>,
    Option<String>,
    String,
  )>,
> {
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents, cadence, first_charge_date, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date, COALESCE(account_id, ?1) FROM fixed_costs WHERE active = 1",
  )?;
  let rows = stmt
    .query_map(params![main_id], |r| {
      Ok((
        r.get(0)?,
        r.get(1)?,
        r.get(2)?,
        r.get(3)?,
        r.get(4)?,
        r.get(5)?,
        r.get::<_, Option<i64>>(6)?,
        r.get::<_, Option<String>>(7)?,
        r.get(8)?,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

fn push_fixed_cost_events_for_range(
  conn: &rusqlite::Connection,
  names: &std::collections::HashMap<String, String>,
  range_start: &str,
  range_end: &str,
  account_filter: &Option<String>,
  main_id: &str,
  events: &mut Vec<TimelineEvent>,
  total: &mut i64,
  max_occurrences: usize,
) -> AppResult<()> {
  for row in load_active_fixed_costs(conn, main_id)? {
    let (
      id,
      name,
      amount_cents,
      cadence,
      first_charge_date,
      due_rule,
      day_of_month,
      end_charge_date,
      fc_account_id,
    ) = row;
    if !event_matches_account(account_filter, main_id, Some(fc_account_id.as_str())) {
      continue;
    }
    let occ = generate_occurrences_with_due_rule_rp(
      &first_charge_date,
      &cadence,
      &due_rule,
      day_of_month.and_then(|x| if x > 0 { Some(x as u32) } else { None }),
      range_start,
      range_end,
      max_occurrences,
      end_charge_date.as_deref(),
    );
    for d in occ {
      *total += amount_cents;
      events.push(TimelineEvent {
        id: format!("fixed_cost:{}:{}", id, d),
        r#type: "fixed_cost".into(),
        date: d,
        title: name.clone(),
        amount_cents: -amount_cents,
        account_id: Some(fc_account_id.clone()),
        account_name: Some(account_name_of(names, &fc_account_id)),
      });
    }
  }
  Ok(())
}

fn fixed_cost_occurrences_until(conn: &rusqlite::Connection, cutoff_inclusive: &str) -> AppResult<i64> {
  let mut sum: i64 = 0;
  let mut stmt = conn.prepare(
    "SELECT amount_cents, cadence, first_charge_date, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date FROM fixed_costs WHERE active = 1",
  )?;
  let rows = stmt.query_map([], |r| {
    Ok((
      r.get::<_, i64>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, String>(2)?,
      r.get::<_, String>(3)?,
      r.get::<_, Option<i64>>(4)?,
      r.get::<_, Option<String>>(5)?,
    ))
  })?;
  for row in rows {
    let (amount_cents, cadence, first_charge_date, due_rule, day_of_month, end_charge_date) = row?;
    let occ = generate_occurrences_with_due_rule_rp(
      &first_charge_date,
      &cadence,
      &due_rule,
      day_of_month.and_then(|x| if x > 0 { Some(x as u32) } else { None }),
      &first_charge_date,
      cutoff_inclusive,
      5000,
      end_charge_date.as_deref(),
    );
    sum += amount_cents * occ.len() as i64;
  }
  Ok(sum)
}

fn forecast_net_until(
  conn: &rusqlite::Connection,
  cutoff_inclusive: &str,
  account_filter: &Option<String>,
  main_id: &str,
  include_parked_buys: bool,
) -> AppResult<i64> {
  if !forecasts_apply(account_filter, main_id) {
    return Ok(0);
  }

  let mut net: i64 = income_forecasts_forecast_until(conn, cutoff_inclusive)?;

  net -= variable_costs_forecast_until(conn, cutoff_inclusive)?;

  if include_parked_buys {
    let cutoff_month = if cutoff_inclusive.len() >= 7 {
      &cutoff_inclusive[..7]
    } else {
      cutoff_inclusive
    };
    net -= conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM buy_items WHERE status='parked' AND planned_month IS NOT NULL AND planned_month <= ?1",
      params![cutoff_month],
      |r| r.get::<_, i64>(0),
    )?;
  }

  net -= fixed_cost_occurrences_until(conn, cutoff_inclusive)?;
  Ok(net)
}

fn account_balance_source(conn: &rusqlite::Connection, account_id: &str) -> AppResult<String> {
  conn
    .query_row(
      "SELECT COALESCE(balance_source, 'ledger') FROM accounts WHERE id = ?1",
      params![account_id],
      |r| r.get(0),
    )
    .map_err(Into::into)
}

fn needs_stock_portfolio_value(
  conn: &rusqlite::Connection,
  account_filter: &Option<String>,
) -> AppResult<bool> {
  match account_filter {
    None => {
      let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM accounts WHERE balance_source = 'stock_portfolio'",
        [],
        |r| r.get(0),
      )?;
      Ok(n > 0)
    }
    Some(id) => Ok(account_balance_source(conn, id)? == "stock_portfolio"),
  }
}

fn cached_stock_portfolio_cents_if_needed(
  state: &AppState,
  conn: &rusqlite::Connection,
  account_filter: &Option<String>,
) -> AppResult<Option<i64>> {
  if !needs_stock_portfolio_value(conn, account_filter)? {
    return Ok(None);
  }
  match account_filter {
    Some(id) => Ok(Some(crate::stocks::portfolio_balance_cents_for_dashboard(
      conn,
      state,
      id.as_str(),
    )?)),
    None => Ok(crate::portfolio_cache::cached_total_cents(state)),
  }
}

fn push_depot_stock_purchase_events(
  conn: &rusqlite::Connection,
  names: &std::collections::HashMap<String, String>,
  depot_account_id: &str,
  range_start: &str,
  range_end: &str,
  events: &mut Vec<TimelineEvent>,
  accumulate_buys: bool,
  buys_sum: &mut i64,
) -> AppResult<()> {
  let mut stmt = conn.prepare(
    "SELECT sl.id, sl.buy_date, sl.buy_price_cents, sl.shares, sl.payment_account_id, sl.is_transfer, sh.name
     FROM stock_lots sl
     JOIN stock_holdings sh ON sh.id = sl.holding_id
     WHERE sh.depot_account_id = ?1 AND sl.buy_date >= ?2 AND sl.buy_date <= ?3
     ORDER BY sl.buy_date ASC, sl.created_at ASC",
  )?;
  let rows = stmt.query_map(params![depot_account_id, range_start, range_end], |r| {
    Ok((
      r.get::<_, String>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, i64>(2)?,
      r.get::<_, f64>(3)?,
      r.get::<_, Option<String>>(4)?,
      r.get::<_, i64>(5)?,
      r.get::<_, String>(6)?,
    ))
  })?;
  for row in rows {
    let (lot_id, buy_date, buy_price_cents, shares, payment_account_id, is_transfer, stock_name) = row?;
    if is_transfer != 0 {
      continue;
    }
    let Some(payment_account_id) = payment_account_id else {
      continue;
    };
    let total_cents = (buy_price_cents as f64 * shares).round() as i64;
    if total_cents <= 0 {
      continue;
    }
    if accumulate_buys {
      *buys_sum += total_cents;
    }
    let payment_name = account_name_of(names, &payment_account_id);
    events.push(TimelineEvent {
      id: format!("stock_lot:{}", lot_id),
      r#type: "stock_purchase".into(),
      date: buy_date,
      title: format!("Aktienkauf: {}", stock_name.trim()),
      amount_cents: -total_cents,
      account_id: Some(payment_account_id),
      account_name: Some(format!("Abbuchung: {payment_name}")),
    });
  }
  Ok(())
}

fn account_effective_balance_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_id: &str,
  stock_portfolio_cents: Option<i64>,
) -> AppResult<i64> {
  if account_balance_source(conn, account_id)? == "stock_portfolio" {
    return Ok(stock_portfolio_cents.unwrap_or(0));
  }
  ledger_account_balance_until(conn, date_inclusive, account_id)
}

fn transaction_after_adjustment_anchor(
  tx_date: &str,
  tx_created: &str,
  adj_date: Option<&str>,
  adj_created: Option<&str>,
) -> bool {
  match (adj_date, adj_created) {
    (Some(d), Some(c)) => tx_date > d || (tx_date == d && tx_created > c),
    _ => true,
  }
}

fn ledger_prognostic_income_on_account_until(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_id: &str,
) -> AppResult<i64> {
  use crate::income_actuals::is_prognostic_income_ledger;

  let anchor: Option<(String, String)> = conn
    .query_row(
      "SELECT date, created_at FROM ledger_transactions
       WHERE account_id = ?1 AND kind = 'adjustment' AND date <= ?2
       ORDER BY date DESC, created_at DESC LIMIT 1",
      params![account_id, date_inclusive],
      |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?;
  let (adj_date, adj_created) = match anchor {
    Some((d, c)) => (Some(d), Some(c)),
    None => (None, None),
  };

  let mut stmt = conn.prepare(
    "SELECT amount_cents, source_id, date, created_at FROM ledger_transactions
     WHERE account_id = ?1 AND kind = 'income' AND date <= ?2
       AND source_id LIKE 'income_forecast:%'",
  )?;
  let rows = stmt.query_map(params![account_id, date_inclusive], |r| {
    Ok((
      r.get::<_, i64>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, String>(2)?,
      r.get::<_, String>(3)?,
    ))
  })?;

  let mut sum = 0i64;
  for row in rows {
    let (amount, source_id, tx_date, tx_created) = row?;
    if !transaction_after_adjustment_anchor(
      &tx_date,
      &tx_created,
      adj_date.as_deref(),
      adj_created.as_deref(),
    ) {
      continue;
    }
    if is_prognostic_income_ledger(conn, &source_id)? {
      sum += amount;
    }
  }
  Ok(sum)
}

fn ledger_account_kontostand_until(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_id: &str,
) -> AppResult<i64> {
  let raw = ledger_account_balance_until(conn, date_inclusive, account_id)?;
  let prognostic = ledger_prognostic_income_on_account_until(conn, date_inclusive, account_id)?;
  Ok(raw - prognostic)
}

fn account_kontostand_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_id: &str,
  stock_market_cents: Option<i64>,
  use_depot_cost_basis: bool,
) -> AppResult<i64> {
  if account_balance_source(conn, account_id)? == "stock_portfolio" {
    if use_depot_cost_basis {
      return crate::stocks::depot_cost_basis_cents_until(conn, account_id, date_inclusive);
    }
    return Ok(stock_market_cents.unwrap_or_else(|| 0));
  }
  ledger_account_kontostand_until(conn, date_inclusive, account_id)
}

fn ledger_kontostand_total_until(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  stock_portfolio_cents: Option<i64>,
) -> AppResult<i64> {
  let mut stmt = conn.prepare("SELECT id FROM accounts")?;
  let ids = stmt
    .query_map([], |r| r.get::<_, String>(0))?
    .collect::<Result<Vec<_>, _>>()?;
  let mut total = 0i64;
  for id in ids {
    if account_balance_source(conn, &id)? == "stock_portfolio" {
      total += stock_portfolio_cents.unwrap_or(0);
    } else {
      total += ledger_account_kontostand_until(conn, date_inclusive, &id)?;
    }
  }
  Ok(total)
}

fn kontostand_total_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_filter: &Option<String>,
  stock_portfolio_cents: Option<i64>,
  use_depot_cost_basis: bool,
) -> AppResult<i64> {
  match account_filter {
    None => ledger_kontostand_total_until(conn, date_inclusive, stock_portfolio_cents),
    Some(aid) => account_kontostand_cents(
      conn,
      date_inclusive,
      aid,
      stock_portfolio_cents,
      use_depot_cost_basis,
    ),
  }
}

/// Gebuchte Einnahmen bis `as_of`, die buchhalterisch in einem späteren Monat zählen.
fn ledger_deferred_income_cents(
  conn: &rusqlite::Connection,
  as_of: &str,
  viewing_month: &str,
  account_filter: &Option<String>,
  main_id: &str,
) -> AppResult<i64> {
  let mut sum: i64 = 0;
  let mut stmt = conn.prepare(
    "SELECT date, amount_cents, account_id FROM ledger_transactions WHERE kind = 'income' AND date <= ?1",
  )?;
  let rows = stmt.query_map(params![as_of], |r| {
    Ok((
      r.get::<_, String>(0)?,
      r.get::<_, i64>(1)?,
      r.get::<_, Option<String>>(2)?,
    ))
  })?;
  for row in rows {
    let (date, amount_cents, account_id) = row?;
    let aid = account_id.as_deref().unwrap_or("");
    if !event_matches_account(account_filter, main_id, Some(aid)) {
      continue;
    }
    if let Some(acct_month) = crate::logic::income_accounting_month(&date) {
      if acct_month.as_str() > viewing_month {
        sum += amount_cents;
      }
    }
  }
  Ok(sum)
}

fn prognostic_total_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_filter: &Option<String>,
  main_id: &str,
  stock_portfolio_cents: Option<i64>,
  include_parked_buys: bool,
) -> AppResult<i64> {
  let forecast = forecast_net_until(
    conn,
    date_inclusive,
    account_filter,
    main_id,
    include_parked_buys,
  )?;
  let vk_double = open_month_categorized_variable_cost_ledger_cents(
    conn,
    date_inclusive,
    account_filter,
    main_id,
  )?;
  let ledger = match account_filter {
    None => ledger_total_until(conn, date_inclusive, stock_portfolio_cents)?,
    Some(aid) => account_effective_balance_cents(conn, date_inclusive, aid, stock_portfolio_cents)?,
  };
  Ok(ledger + forecast - vk_double)
}

fn prognostic_liquid_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_filter: &Option<String>,
  main_id: &str,
  stock_portfolio_cents: Option<i64>,
  include_parked_buys: bool,
) -> AppResult<i64> {
  let forecast = forecast_net_until(
    conn,
    date_inclusive,
    account_filter,
    main_id,
    include_parked_buys,
  )?;
  let vk_double = open_month_categorized_variable_cost_ledger_cents(
    conn,
    date_inclusive,
    account_filter,
    main_id,
  )?;
  match account_filter {
    None => Ok(ledger_liquid_total_until(conn, date_inclusive, stock_portfolio_cents)? + forecast - vk_double),
    Some(aid) if aid == main_id => Ok(
      account_effective_balance_cents(conn, date_inclusive, aid, stock_portfolio_cents)? + forecast - vk_double,
    ),
    Some(aid) => {
      let is_liquid: i64 = conn.query_row("SELECT is_liquid FROM accounts WHERE id = ?1", params![aid], |r| r.get(0))?;
      if is_liquid != 0 {
        Ok(account_effective_balance_cents(
          conn,
          date_inclusive,
          aid,
          stock_portfolio_cents,
        )?)
      } else {
        Ok(0)
      }
    }
  }
}

// ---- Accounts ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccountInput {
  pub name: String,
  pub is_liquid: bool,
  pub balance_source: Option<String>,
}

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> CmdResult<Vec<Account>> {
  to_cmd_result(list_accounts_inner(state))
}

fn list_accounts_inner(state: State<'_, AppState>) -> AppResult<Vec<Account>> {
  let conn = state.conn.lock().unwrap();
  let main_id = crate::accounts::get_main_account_id(&conn)?;
  let mut stmt = conn.prepare("SELECT id, name, is_liquid, COALESCE(balance_source, 'ledger'), created_at FROM accounts ORDER BY name ASC")?;
  let rows = stmt
    .query_map([], |r| {
      let id_str: String = r.get(0)?;
      Ok((
        Uuid::parse_str(id_str.as_str()).unwrap(),
        r.get::<_, String>(1)?,
        r.get::<_, i64>(2)? != 0,
        r.get::<_, String>(3)?,
        chrono::DateTime::parse_from_rfc3339(r.get::<_, String>(4)?.as_str())
          .unwrap()
          .with_timezone(&Utc),
        id_str,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(
    rows
      .into_iter()
      .map(|(id, name, is_liquid, balance_source, created_at, id_str)| Account {
        id,
        name,
        is_liquid,
        balance_source,
        is_main: id_str == main_id,
        created_at,
      })
      .collect(),
  )
}

#[tauri::command]
pub fn create_account(state: State<'_, AppState>, input: CreateAccountInput) -> CmdResult<()> {
  to_cmd_result(create_account_inner(state, input))
}

fn create_account_inner(state: State<'_, AppState>, input: CreateAccountInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let balance_source = input
    .balance_source
    .as_deref()
    .unwrap_or("ledger")
    .trim();
  if balance_source != "ledger" && balance_source != "stock_portfolio" {
    return Err(AppError::Invalid(
      "balanceSource must be ledger or stock_portfolio".into(),
    ));
  }
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "INSERT INTO accounts (id, name, is_liquid, balance_source, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    params![id, input.name, if input.is_liquid { 1 } else { 0 }, balance_source, now],
  )?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountInput {
  pub id: String,
  pub name: String,
}

#[tauri::command]
pub fn update_account(state: State<'_, AppState>, input: UpdateAccountInput) -> CmdResult<()> {
  to_cmd_result(update_account_inner(state, input))
}

fn update_account_inner(state: State<'_, AppState>, input: UpdateAccountInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  let conn = state.conn.lock().unwrap();
  let n = conn.execute(
    "UPDATE accounts SET name = ?2 WHERE id = ?1",
    params![input.id, input.name.trim()],
  )?;
  if n == 0 {
    return Err(AppError::Invalid("account not found".into()));
  }
  Ok(())
}

#[tauri::command]
pub fn set_main_account(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(set_main_account_inner(state, id))
}

fn set_main_account_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  crate::accounts::set_main_account_id(&conn, &id)
}

#[tauri::command]
pub fn set_account_liquid(state: State<'_, AppState>, id: String, is_liquid: bool) -> CmdResult<()> {
  to_cmd_result(set_account_liquid_inner(state, id, is_liquid))
}

fn set_account_liquid_inner(state: State<'_, AppState>, id: String, is_liquid: bool) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "UPDATE accounts SET is_liquid=?2 WHERE id=?1",
    params![id, if is_liquid { 1 } else { 0 }],
  )?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAccountBalanceSourceInput {
  pub id: String,
  pub balance_source: String,
}

#[tauri::command]
pub fn set_account_balance_source(
  app: tauri::AppHandle,
  state: State<'_, AppState>,
  input: SetAccountBalanceSourceInput,
) -> CmdResult<()> {
  to_cmd_result(set_account_balance_source_inner(app, state, input))
}

fn set_account_balance_source_inner(
  app: tauri::AppHandle,
  state: State<'_, AppState>,
  input: SetAccountBalanceSourceInput,
) -> AppResult<()> {
  let source = input.balance_source.trim();
  if source != "ledger" && source != "stock_portfolio" {
    return Err(AppError::Invalid(
      "balanceSource must be ledger or stock_portfolio".into(),
    ));
  }
  let conn = state.conn.lock().unwrap();
  let updated = conn.execute(
    "UPDATE accounts SET balance_source = ?2 WHERE id = ?1",
    params![input.id, source],
  )?;
  if updated == 0 {
    return Err(AppError::Invalid("Account nicht gefunden".into()));
  }
  drop(conn);
  if source == "stock_portfolio" {
    crate::portfolio_cache::spawn_refresh_async(app);
  }
  Ok(())
}

// ---- Ledger transactions ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLedgerTransactionInput {
  pub date: String,
  pub amount_cents: i64,
  pub account_id: String,
  pub kind: String,
  pub title: String,
  pub notes: Option<String>,
  pub variable_cost_id: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
}

#[tauri::command]
pub fn list_ledger_transactions(state: State<'_, AppState>, account_id: Option<String>, start: Option<String>, end: Option<String>) -> CmdResult<Vec<LedgerTransaction>> {
  to_cmd_result(list_ledger_transactions_inner(state, account_id, start, end))
}

fn list_ledger_transactions_inner(
  state: State<'_, AppState>,
  account_id: Option<String>,
  start: Option<String>,
  end: Option<String>,
) -> AppResult<Vec<LedgerTransaction>> {
  let conn = state.conn.lock().unwrap();
  materialize_due_income_forecasts(&conn)?;

  let mut where_parts = vec!["1=1".to_string()];
  let mut params_vec: Vec<String> = Vec::new();

  if let Some(aid) = account_id.clone() {
    where_parts.push("(account_id = ? OR from_account_id = ? OR to_account_id = ?)".into());
    params_vec.push(aid.clone());
    params_vec.push(aid.clone());
    params_vec.push(aid);
  }
  if let Some(v) = start.clone() {
    where_parts.push(format!("date >= ?{}", params_vec.len() + 1));
    params_vec.push(v);
  }
  if let Some(v) = end.clone() {
    where_parts.push(format!("date <= ?{}", params_vec.len() + 1));
    params_vec.push(v);
  }

  let sql = format!(
    "SELECT id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, variable_cost_id, icon, color, created_at FROM ledger_transactions WHERE {} ORDER BY date DESC, created_at DESC",
    where_parts.join(" AND ")
  );

  let mut stmt = conn.prepare(&sql)?;
  let params_refs: Vec<&str> = params_vec.iter().map(|s| s.as_str()).collect();

  let rows = stmt
    .query_map(rusqlite::params_from_iter(params_refs), |r| {
      Ok(LedgerTransaction {
        id: Uuid::parse_str(r.get::<_, String>(0)?.as_str()).unwrap(),
        date: r.get(1)?,
        amount_cents: r.get(2)?,
        account_id: r.get::<_, Option<String>>(3)?.map(|s| Uuid::parse_str(&s).unwrap()),
        from_account_id: r.get::<_, Option<String>>(4)?.map(|s| Uuid::parse_str(&s).unwrap()),
        to_account_id: r.get::<_, Option<String>>(5)?.map(|s| Uuid::parse_str(&s).unwrap()),
        kind: r.get(6)?,
        title: r.get(7)?,
        notes: r.get(8)?,
        source_id: r.get(9)?,
        variable_cost_id: r.get::<_, Option<String>>(10)?.map(|s| Uuid::parse_str(&s).unwrap()),
        icon: r.get::<_, Option<String>>(11)?.unwrap_or_else(|| "target".into()),
        color: r.get::<_, Option<String>>(12)?.unwrap_or_else(|| "#6366f1".into()),
        created_at: chrono::DateTime::parse_from_rfc3339(r.get::<_, String>(13)?.as_str())
          .unwrap()
          .with_timezone(&Utc),
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;

  Ok(rows)
}

#[tauri::command]
pub fn create_ledger_transaction(state: State<'_, AppState>, input: CreateLedgerTransactionInput) -> CmdResult<()> {
  to_cmd_result(create_ledger_transaction_inner(state, input))
}

fn normalize_ledger_amount(kind: &str, amount_cents: i64) -> i64 {
  if kind == "adjustment" {
    amount_cents.abs()
  } else {
    amount_cents
  }
}

fn create_ledger_transaction_inner(state: State<'_, AppState>, input: CreateLedgerTransactionInput) -> AppResult<()> {
  if crate::models::parse_iso_date(&input.date).is_none() {
    return Err(AppError::Invalid("date must be YYYY-MM-DD".into()));
  }
  if input.title.trim().is_empty() {
    return Err(AppError::Invalid("title required".into()));
  }
  if input.account_id.trim().is_empty() {
    return Err(AppError::Invalid("accountId required".into()));
  }
  let amount_cents = normalize_ledger_amount(&input.kind, input.amount_cents);
  let variable_cost_id = normalize_variable_cost_id_for_kind(&input.kind, input.variable_cost_id.clone())?;
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let conn = state.conn.lock().unwrap();
  if account_balance_source(&conn, &input.account_id)? == "stock_portfolio" {
    return Err(AppError::Invalid(
      "Aktiendepots können nicht manuell gebucht werden".into(),
    ));
  }
  if let Some(ref vc_id) = variable_cost_id {
    validate_variable_cost_id(&conn, vc_id)?;
  }
  let icon = normalize_icon(input.icon, default_icon_for_kind(&input.kind));
  let color = normalize_color(input.color, default_color_for_kind(&input.kind));
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, variable_cost_id, icon, color, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?11)",
    params![id, input.date, amount_cents, input.account_id, input.kind, input.title, input.notes, variable_cost_id, icon, color, now],
  )?;
  resync_variable_cost_months(&conn, variable_cost_id.as_deref(), Some(input.date.as_str()))?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLedgerTransactionInput {
  pub id: String,
  pub date: String,
  pub amount_cents: i64,
  pub title: String,
  pub kind: String,
  pub notes: Option<String>,
  pub variable_cost_id: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
}

#[tauri::command]
pub fn update_ledger_transaction(state: State<'_, AppState>, input: UpdateLedgerTransactionInput) -> CmdResult<()> {
  to_cmd_result(update_ledger_transaction_inner(state, input))
}

fn update_ledger_transaction_inner(state: State<'_, AppState>, input: UpdateLedgerTransactionInput) -> AppResult<()> {
  if crate::models::parse_iso_date(&input.date).is_none() {
    return Err(AppError::Invalid("date must be YYYY-MM-DD".into()));
  }
  if input.title.trim().is_empty() {
    return Err(AppError::Invalid("title required".into()));
  }
  let conn = state.conn.lock().unwrap();
  if !ledger_tx_is_categorizable(&conn, &input.id)? {
    return Err(AppError::Invalid("Diese Buchung kann keine Kategorie erhalten".into()));
  }
  let kind: String = conn.query_row(
    "SELECT kind FROM ledger_transactions WHERE id = ?1",
    params![input.id],
    |r| r.get(0),
  )?;
  if kind == "transfer" {
    return Err(AppError::Invalid("Transfers können nicht bearbeitet werden".into()));
  }
  let (old_date, old_vc_id): (String, Option<String>) = conn.query_row(
    "SELECT date, variable_cost_id FROM ledger_transactions WHERE id = ?1",
    params![input.id],
    |r| Ok((r.get(0)?, r.get(1)?)),
  )?;
  let account_id: String = conn.query_row(
    "SELECT account_id FROM ledger_transactions WHERE id = ?1",
    params![input.id],
    |r| r.get(0),
  )?;
  if account_balance_source(&conn, &account_id)? == "stock_portfolio" {
    return Err(AppError::Invalid(
      "Aktiendepots können nicht manuell gebucht werden".into(),
    ));
  }
  let amount_cents = normalize_ledger_amount(&input.kind, input.amount_cents);
  let variable_cost_id = normalize_variable_cost_id_for_kind(&input.kind, input.variable_cost_id.clone())?;
  if let Some(ref vc_id) = variable_cost_id {
    validate_variable_cost_id(&conn, vc_id)?;
  }
  let icon = normalize_icon(input.icon, default_icon_for_kind(&input.kind));
  let color = normalize_color(input.color, default_color_for_kind(&input.kind));
  conn.execute(
    "UPDATE ledger_transactions SET date = ?2, amount_cents = ?3, title = ?4, kind = ?5, notes = ?6, variable_cost_id = ?7, icon = ?8, color = ?9 WHERE id = ?1",
    params![
      input.id,
      input.date,
      amount_cents,
      input.title,
      input.kind,
      input.notes,
      variable_cost_id,
      icon,
      color,
    ],
  )?;
  resync_variable_cost_months(&conn, old_vc_id.as_deref(), Some(old_date.as_str()))?;
  resync_variable_cost_months(&conn, variable_cost_id.as_deref(), Some(input.date.as_str()))?;
  Ok(())
}

#[tauri::command]
pub fn delete_ledger_transaction(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_ledger_transaction_inner(state, id))
}

fn delete_ledger_transaction_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  let kind: String = conn.query_row(
    "SELECT kind FROM ledger_transactions WHERE id = ?1",
    params![id],
    |r| r.get(0),
  )?;
  if kind == "transfer" {
    return Err(AppError::Invalid("Transfers bitte über Rückgängig entfernen".into()));
  }
  let (date, vc_id): (String, Option<String>) = conn.query_row(
    "SELECT date, variable_cost_id FROM ledger_transactions WHERE id = ?1",
    params![id],
    |r| Ok((r.get(0)?, r.get(1)?)),
  )?;
  conn.execute("DELETE FROM ledger_transactions WHERE id = ?1", params![id])?;
  resync_variable_cost_months(&conn, vc_id.as_deref(), Some(date.as_str()))?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransferInput {
  pub date: String,
  pub amount_cents: i64,
  pub from_account_id: String,
  pub to_account_id: String,
  pub title: String,
  pub notes: Option<String>,
}

#[tauri::command]
pub fn create_transfer(state: State<'_, AppState>, input: CreateTransferInput) -> CmdResult<()> {
  to_cmd_result(create_transfer_inner(state, input))
}

fn create_transfer_inner(state: State<'_, AppState>, input: CreateTransferInput) -> AppResult<()> {
  if crate::models::parse_iso_date(&input.date).is_none() {
    return Err(AppError::Invalid("date must be YYYY-MM-DD".into()));
  }
  if input.amount_cents <= 0 {
    return Err(AppError::Invalid("amount must be > 0".into()));
  }
  if input.from_account_id == input.to_account_id {
    return Err(AppError::Invalid("fromAccountId must differ from toAccountId".into()));
  }
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, created_at) VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'transfer', ?6, ?7, NULL, ?8)",
    params![id, input.date, input.amount_cents, input.from_account_id, input.to_account_id, input.title, input.notes, now],
  )?;
  Ok(())
}

#[tauri::command]
pub fn delete_transfer(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_transfer_inner(state, id))
}

fn delete_transfer_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  let kind: String = conn.query_row(
    "SELECT kind FROM ledger_transactions WHERE id = ?1",
    params![id],
    |r| r.get(0),
  )?;
  if kind != "transfer" {
    return Err(AppError::Invalid("only transfers can be deleted".into()));
  }
  conn.execute("DELETE FROM ledger_transactions WHERE id = ?1", params![id])?;
  Ok(())
}

// ---- Day view ----

#[tauri::command]
pub fn get_day_view(state: State<'_, AppState>, date: String, account_id: Option<String>) -> CmdResult<DayView> {
  to_cmd_result(get_day_view_inner(state, date, account_id))
}

fn get_day_view_inner(state: State<'_, AppState>, date: String, account_id: Option<String>) -> AppResult<DayView> {
  if crate::models::parse_iso_date(&date).is_none() {
    return Err(AppError::Invalid("date must be YYYY-MM-DD".into()));
  }
  {
    let conn = state.conn.lock().unwrap();
    materialize_due_income_forecasts(&conn)?;
  }

  let conn = state.conn.lock().unwrap();
  let stock_portfolio_cents = cached_stock_portfolio_cents_if_needed(&state, &conn, &account_id)?;
  let names = account_name_map(&conn)?;
  let main_id = get_main_account_id(&conn)?;

  let total = prognostic_total_cents(
    &conn,
    &date,
    &account_id,
    &main_id,
    stock_portfolio_cents,
    true,
  )?;
  let liquid = prognostic_liquid_cents(
    &conn,
    &date,
    &account_id,
    &main_id,
    stock_portfolio_cents,
    true,
  )?;

  let mut events: Vec<TimelineEvent> = Vec::new();

  // Ledger postings on this day
  {
    let mut stmt = conn.prepare(
      "SELECT id, kind, title, amount_cents, account_id, from_account_id, to_account_id, variable_cost_id FROM ledger_transactions WHERE date = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![date.clone()], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, String>(2)?,
        r.get::<_, i64>(3)?,
        r.get::<_, Option<String>>(4)?,
        r.get::<_, Option<String>>(5)?,
        r.get::<_, Option<String>>(6)?,
        r.get::<_, Option<String>>(7)?,
      ))
    })?;
    for row in rows {
      let (id, kind, title, amount_cents, acc, from_id, to_id, variable_cost_id) = row?;
      if kind == "expense"
        && should_hide_categorized_variable_cost_event(variable_cost_id.as_deref(), &date)?
      {
        continue;
      }
      let (ev_acc_id, ev_acc_name, mapped_amount) = if kind == "transfer" {
        let from = from_id.as_deref().unwrap_or("");
        let to = to_id.as_deref().unwrap_or("");
        if let Some(ref fid) = account_id {
          if fid == from {
            (Some(from.to_string()), account_name_of(&names, from), -amount_cents)
          } else if fid == to {
            (Some(to.to_string()), account_name_of(&names, to), amount_cents)
          } else {
            continue;
          }
        } else {
          (
            None,
            format!("{} → {}", account_name_of(&names, from), account_name_of(&names, to)),
            0,
          )
        }
      } else {
        let aid = acc.clone().unwrap_or_default();
        if !event_matches_account(&account_id, &main_id, Some(aid.as_str())) {
          continue;
        }
        (acc.clone(), account_name_of(&names, &aid), amount_cents)
      };
      events.push(TimelineEvent {
        id: format!("ledger:{}:{}", kind, id),
        r#type: kind,
        date: date.clone(),
        title,
        amount_cents: mapped_amount,
        account_id: ev_acc_id,
        account_name: Some(ev_acc_name),
      });
    }
  }

  // Fixed costs on this day
  {
    let mut fixed_costs_day = 0i64;
    push_fixed_cost_events_for_range(
      &conn,
      &names,
      &date,
      &date,
      &account_id,
      &main_id,
      &mut events,
      &mut fixed_costs_day,
      1,
    )?;
  }

  // Income forecast on this day (unbooked only)
  if event_matches_account(&account_id, &main_id, Some(main_id.as_str())) {
    let mut income_sum = 0i64;
    push_unbooked_income_events_for_range(
      &conn,
      &date,
      &date,
      if date.len() >= 7 { &date[..7] } else { &date },
      &main_id,
      &account_name_of(&names, &main_id),
      &mut events,
      &mut income_sum,
    )?;
  }

  // Variable costs on this day (Hauptkonto, monthly templates)
  if event_matches_account(&account_id, &main_id, Some(main_id.as_str())) {
    let month = if date.len() >= 7 { &date[..7] } else { &date };
    if variable_costs_active_month(month) {
      for t in load_variable_cost_templates(&conn)? {
        let charge_date = last_day_of_month_iso(month).unwrap_or_else(|| date.clone());
        if charge_date != date {
          continue;
        }
        let (amount, is_actual) = variable_cost_effective_amount(&conn, &t, month)?;
        if is_actual {
          continue;
        }
        events.push(TimelineEvent {
          id: format!("variable_cost:{}:{}", t.id, date),
          r#type: "variable_cost".into(),
          date: date.clone(),
          title: format!("{} (Prognose)", t.name),
          amount_cents: -amount,
          account_id: Some(main_id.clone()),
          account_name: Some(account_name_of(&names, &main_id)),
        });
      }
    }
  }

  if let Some(ref fid) = account_id {
    if account_balance_source(&conn, fid)? == "stock_portfolio" {
      push_depot_stock_purchase_events(&conn, &names, fid, &date, &date, &mut events, false, &mut 0)?;
    }
  }

  events.sort_by(|a, b| a.title.cmp(&b.title));

  let kontostand = kontostand_total_cents(
    &conn,
    &date,
    &account_id,
    stock_portfolio_cents,
    false,
  )?;
  let prev_date = crate::models::parse_iso_date(&date)
    .and_then(|d| d.pred_opt())
    .map(iso_date)
    .unwrap_or_else(|| date.clone());
  let prev_kontostand = kontostand_total_cents(
    &conn,
    &prev_date,
    &account_id,
    stock_portfolio_cents,
    true,
  )?;

  Ok(DayView {
    date,
    total_cents: total,
    liquid_cents: liquid,
    kontostand_cents: kontostand,
    prev_kontostand_cents: prev_kontostand,
    events,
  })
}

#[tauri::command]
pub fn list_fixed_costs(state: State<'_, AppState>) -> CmdResult<Vec<FixedCost>> {
  to_cmd_result(list_fixed_costs_inner(state))
}

fn list_fixed_costs_inner(state: State<'_, AppState>) -> AppResult<Vec<FixedCost>> {
  let conn = state.conn.lock().unwrap();
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents, cadence, first_charge_date, active, notes, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date, COALESCE(account_id, '') FROM fixed_costs ORDER BY name ASC",
  )?;
  let main_id = get_main_account_id(&conn)?;
  let rows = stmt
    .query_map([], |r| {
      let account_id: String = r.get(10)?;
      Ok(FixedCost {
        id: Uuid::parse_str(r.get::<_, String>(0)?.as_str()).unwrap(),
        name: r.get(1)?,
        amount_cents: r.get(2)?,
        cadence: r.get(3)?,
        first_charge_date: r.get(4)?,
        active: r.get::<_, i64>(5)? != 0,
        notes: r.get(6)?,
        due_rule: r.get(7)?,
        day_of_month: r.get(8)?,
        end_charge_date: r.get(9)?,
        account_id: if account_id.is_empty() {
          main_id.clone()
        } else {
          account_id
        },
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFixedCostInput {
  pub name: String,
  pub amount_cents: i64,
  pub cadence: String,
  pub first_charge_date: String,
  pub active: bool,
  pub notes: Option<String>,
  pub due_rule: String,
  pub day_of_month: Option<i64>,
  pub end_charge_date: Option<String>,
  pub account_id: Option<String>,
}

#[tauri::command]
pub fn create_fixed_cost(state: State<'_, AppState>, input: CreateFixedCostInput) -> CmdResult<()> {
  to_cmd_result(create_fixed_cost_inner(state, input))
}

fn create_fixed_cost_inner(state: State<'_, AppState>, input: CreateFixedCostInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  if crate::models::parse_iso_date(&input.first_charge_date).is_none() {
    return Err(AppError::Invalid("firstChargeDate must be YYYY-MM-DD".into()));
  }
  if let Some(ref end) = input.end_charge_date {
    if !end.is_empty() && crate::models::parse_iso_date(end).is_none() {
      return Err(AppError::Invalid("endChargeDate must be YYYY-MM-DD".into()));
    }
  }
  let allowed = ["yearly", "monthly", "weekly", "biweekly", "once"];
  if !allowed.contains(&input.cadence.as_str()) {
    return Err(AppError::Invalid("cadence invalid".into()));
  }
  let allowed_due = ["calendar_day", "first_business_day"];
  if !allowed_due.contains(&input.due_rule.as_str()) {
    return Err(AppError::Invalid("dueRule invalid".into()));
  }
  let id = Uuid::new_v4().to_string();
  let day_of_month = input.day_of_month.or_else(|| {
    if input.due_rule.as_str() == "calendar_day" {
      crate::models::parse_iso_date(&input.first_charge_date).map(|d| d.day() as i64)
    } else {
      None
    }
  });
  let conn = state.conn.lock().unwrap();
  let account_id = match input.account_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
    Some(id) => id.to_string(),
    None => get_main_account_id(&conn)?,
  };
  conn.execute(
    "INSERT INTO fixed_costs (id, name, amount_cents, cadence, first_charge_date, active, notes, due_rule, day_of_month, end_charge_date, account_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    params![
      id,
      input.name,
      input.amount_cents,
      input.cadence,
      input.first_charge_date,
      if input.active { 1 } else { 0 },
      input.notes,
      input.due_rule,
      day_of_month,
      input.end_charge_date.filter(|s| !s.is_empty()),
      account_id,
    ],
  )?;
  Ok(())
}

#[tauri::command]
pub fn delete_fixed_cost(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_fixed_cost_inner(state, id))
}

fn delete_fixed_cost_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  conn.execute("DELETE FROM fixed_costs WHERE id = ?1", params![id])?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFixedCostInput {
  pub id: String,
  pub name: String,
  pub amount_cents: i64,
  pub cadence: String,
  pub first_charge_date: String,
  pub active: bool,
  pub notes: Option<String>,
  pub due_rule: String,
  pub day_of_month: Option<i64>,
  pub end_charge_date: Option<String>,
  pub account_id: String,
}

#[tauri::command]
pub fn update_fixed_cost(state: State<'_, AppState>, input: UpdateFixedCostInput) -> CmdResult<()> {
  to_cmd_result(update_fixed_cost_inner(state, input))
}

fn update_fixed_cost_inner(state: State<'_, AppState>, input: UpdateFixedCostInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  if crate::models::parse_iso_date(&input.first_charge_date).is_none() {
    return Err(AppError::Invalid("firstChargeDate must be YYYY-MM-DD".into()));
  }
  if let Some(ref end) = input.end_charge_date {
    if !end.is_empty() && crate::models::parse_iso_date(end).is_none() {
      return Err(AppError::Invalid("endChargeDate must be YYYY-MM-DD".into()));
    }
  }
  let day_of_month = input.day_of_month.or_else(|| {
    if input.due_rule.as_str() == "calendar_day" {
      crate::models::parse_iso_date(&input.first_charge_date).map(|d| d.day() as i64)
    } else {
      None
    }
  });
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "UPDATE fixed_costs SET name=?2, amount_cents=?3, cadence=?4, first_charge_date=?5, active=?6, notes=?7, due_rule=?8, day_of_month=?9, end_charge_date=?10, account_id=?11 WHERE id=?1",
    params![
      input.id,
      input.name,
      input.amount_cents,
      input.cadence,
      input.first_charge_date,
      if input.active { 1 } else { 0 },
      input.notes,
      input.due_rule,
      day_of_month,
      input.end_charge_date.filter(|s| !s.is_empty()),
      input.account_id,
    ],
  )?;
  Ok(())
}

#[tauri::command]
pub fn preview_fixed_cost(state: State<'_, AppState>, id: String) -> CmdResult<Vec<String>> {
  to_cmd_result(preview_fixed_cost_inner(state, id))
}

fn preview_fixed_cost_inner(state: State<'_, AppState>, id: String) -> AppResult<Vec<String>> {
  let conn = state.conn.lock().unwrap();
  let row: Option<(String, String, String, Option<i64>, Option<String>)> = conn
    .query_row(
      "SELECT first_charge_date, cadence, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date FROM fixed_costs WHERE id = ?1",
      params![id],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )
    .optional()?;
  let (first_charge_date, cadence, due_rule, day_of_month, end_charge_date) =
    row.ok_or_else(|| AppError::Invalid("not found".into()))?;
  let today = Utc::now().date_naive();
  let rs = today.format("%Y-%m-%d").to_string();
  let re = (today + chrono::Duration::days(365)).format("%Y-%m-%d").to_string();
  Ok(generate_occurrences_with_due_rule_rp(
    &first_charge_date,
    &cadence,
    &due_rule,
    day_of_month.and_then(|x| if x > 0 { Some(x as u32) } else { None }),
    &rs,
    &re,
    3,
    end_charge_date.as_deref(),
  ))
}

#[tauri::command]
pub fn list_buy_items(state: State<'_, AppState>) -> CmdResult<Vec<BuyItem>> {
  to_cmd_result(list_buy_items_inner(state))
}

fn list_buy_items_inner(state: State<'_, AppState>) -> AppResult<Vec<BuyItem>> {
  let conn = state.conn.lock().unwrap();
  let mut stmt = conn.prepare(
    "SELECT id, name, description, amount_cents, status, applied_date, planned_month, icon, color, created_at FROM buy_items ORDER BY created_at DESC",
  )?;
  let rows = stmt
    .query_map([], |r| {
      Ok(BuyItem {
        id: Uuid::parse_str(r.get::<_, String>(0)?.as_str()).unwrap(),
        name: r.get(1)?,
        description: r.get(2)?,
        amount_cents: r.get(3)?,
        status: r.get(4)?,
        applied_date: r.get(5)?,
        planned_month: r.get(6)?,
        icon: r.get::<_, Option<String>>(7)?.unwrap_or_else(|| "shop".into()),
        color: r.get::<_, Option<String>>(8)?.unwrap_or_else(|| "#ec4899".into()),
        created_at: chrono::DateTime::parse_from_rfc3339(r.get::<_, String>(9)?.as_str())
          .unwrap()
          .with_timezone(&Utc),
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBuyItemInput {
  pub name: String,
  pub description: Option<String>,
  pub amount_cents: i64,
  pub planned_month: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
}

#[tauri::command]
pub fn create_buy_item(state: State<'_, AppState>, input: CreateBuyItemInput) -> CmdResult<()> {
  to_cmd_result(create_buy_item_inner(state, input))
}

fn create_buy_item_inner(state: State<'_, AppState>, input: CreateBuyItemInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let conn = state.conn.lock().unwrap();
  let icon = normalize_icon(input.icon, "shop");
  let color = normalize_color(input.color, "#ec4899");
  conn.execute(
    "INSERT INTO buy_items (id, name, description, amount_cents, status, applied_date, planned_month, icon, color, created_at) VALUES (?1, ?2, ?3, ?4, 'parked', NULL, ?5, ?6, ?7, ?8)",
    params![id, input.name, input.description, input.amount_cents, input.planned_month, icon, color, now],
  )?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBuyItemInput {
  pub id: String,
  pub name: String,
  pub description: Option<String>,
  pub amount_cents: i64,
  pub planned_month: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
}

#[tauri::command]
pub fn update_buy_item(state: State<'_, AppState>, input: UpdateBuyItemInput) -> CmdResult<()> {
  to_cmd_result(update_buy_item_inner(state, input))
}

fn update_buy_item_inner(state: State<'_, AppState>, input: UpdateBuyItemInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  let conn = state.conn.lock().unwrap();
  let icon = normalize_icon(input.icon, "shop");
  let color = normalize_color(input.color, "#ec4899");
  conn.execute(
    "UPDATE buy_items SET name=?2, description=?3, amount_cents=?4, planned_month=?5, icon=?6, color=?7 WHERE id=?1 AND status='parked'",
    params![input.id, input.name, input.description, input.amount_cents, input.planned_month, icon, color],
  )?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyBuyItemInput {
  pub id: String,
}

#[tauri::command]
pub fn apply_buy_item(state: State<'_, AppState>, input: ApplyBuyItemInput) -> CmdResult<()> {
  to_cmd_result(apply_buy_item_inner(state, input))
}

fn apply_buy_item_inner(state: State<'_, AppState>, input: ApplyBuyItemInput) -> AppResult<()> {
  let applied_date = Utc::now().date_naive().format("%Y-%m-%d").to_string();
  let conn = state.conn.lock().unwrap();
  let main_id = get_main_account_id(&conn)?;
  let (name, amount_cents): (String, i64) = conn.query_row(
    "SELECT name, amount_cents FROM buy_items WHERE id = ?1",
    params![input.id],
    |r| Ok((r.get(0)?, r.get(1)?)),
  )?;
  conn.execute(
    "UPDATE buy_items SET status='applied', applied_date=?2 WHERE id=?1",
    params![input.id, applied_date],
  )?;
  let tx_id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'buy_apply', ?5, NULL, ?6, ?7)",
    params![tx_id, applied_date, -amount_cents, main_id, name, input.id, now],
  )?;
  Ok(())
}

#[tauri::command]
pub fn unapply_buy_item(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(unapply_buy_item_inner(state, id))
}

fn unapply_buy_item_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  conn.execute("UPDATE buy_items SET status='parked', applied_date=NULL WHERE id=?1", params![id])?;
  conn.execute(
    "DELETE FROM ledger_transactions WHERE source_id = ?1 AND kind = 'buy_apply'",
    params![id],
  )?;
  Ok(())
}

#[tauri::command]
pub fn delete_buy_item(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_buy_item_inner(state, id))
}

fn delete_buy_item_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  let status: String = conn.query_row("SELECT status FROM buy_items WHERE id = ?1", params![id], |r| r.get(0))?;
  if status != "parked" {
    return Err(AppError::Invalid(
      "Nur geplante Einträge können gelöscht werden — Real-Buchung zuerst entfernen.".into(),
    ));
  }
  conn.execute("DELETE FROM buy_items WHERE id = ?1", params![id])?;
  Ok(())
}

#[tauri::command]
pub fn list_income_forecasts(state: State<'_, AppState>) -> CmdResult<Vec<IncomeForecast>> {
  to_cmd_result(list_income_forecasts_inner(state))
}

fn list_income_forecasts_inner(state: State<'_, AppState>) -> AppResult<Vec<IncomeForecast>> {
  let conn = state.conn.lock().unwrap();
  materialize_due_income_forecasts(&conn)?;
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents, cadence, first_charge_date, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date, COALESCE(active,1)
     FROM income_forecasts ORDER BY first_charge_date DESC, name ASC",
  )?;
  let rows = stmt
    .query_map([], |r| {
      Ok(IncomeForecast {
        id: Uuid::parse_str(r.get::<_, String>(0)?.as_str()).unwrap(),
        name: r.get(1)?,
        amount_cents: r.get(2)?,
        cadence: r.get(3)?,
        first_charge_date: r.get(4)?,
        due_rule: r.get(5)?,
        day_of_month: r.get(6)?,
        end_charge_date: r.get(7)?,
        active: r.get::<_, i64>(8)? != 0,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIncomeForecastInput {
  pub name: String,
  pub amount_cents: i64,
  pub cadence: String,
  pub first_charge_date: String,
  pub due_rule: String,
  pub day_of_month: Option<i64>,
  pub end_charge_date: Option<String>,
}

#[tauri::command]
pub fn create_income_forecast(state: State<'_, AppState>, input: CreateIncomeForecastInput) -> CmdResult<()> {
  to_cmd_result(create_income_forecast_inner(state, input))
}

fn create_income_forecast_inner(state: State<'_, AppState>, input: CreateIncomeForecastInput) -> AppResult<()> {
  if crate::models::parse_iso_date(&input.first_charge_date).is_none() {
    return Err(AppError::Invalid("firstChargeDate must be YYYY-MM-DD".into()));
  }
  if input.amount_cents <= 0 {
    return Err(AppError::Invalid("amount must be positive".into()));
  }
  if let Some(ref end) = input.end_charge_date {
    if !end.is_empty() && crate::models::parse_iso_date(end).is_none() {
      return Err(AppError::Invalid("endChargeDate must be YYYY-MM-DD".into()));
    }
  }
  let allowed = ["yearly", "monthly", "weekly", "biweekly", "once"];
  if !allowed.contains(&input.cadence.as_str()) {
    return Err(AppError::Invalid("cadence invalid".into()));
  }
  let allowed_due = ["calendar_day", "first_business_day", "last_business_day"];
  if !allowed_due.contains(&input.due_rule.as_str()) {
    return Err(AppError::Invalid("dueRule invalid".into()));
  }
  let day_of_month = input.day_of_month.or_else(|| {
    if input.due_rule.as_str() == "calendar_day" {
      crate::models::parse_iso_date(&input.first_charge_date).map(|d| d.day() as i64)
    } else {
      None
    }
  });
  let id = Uuid::new_v4().to_string();
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "INSERT INTO income_forecasts (id, name, amount_cents, date, cadence, first_charge_date, due_rule, day_of_month, end_charge_date, active, ledger_transaction_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, 1, NULL)",
    params![
      id,
      input.name.trim(),
      input.amount_cents,
      input.first_charge_date,
      input.cadence,
      input.due_rule,
      day_of_month,
      input.end_charge_date.filter(|s| !s.is_empty()),
    ],
  )?;
  materialize_due_income_forecasts(&conn)?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateIncomeForecastInput {
  pub id: String,
  pub name: String,
  pub amount_cents: i64,
  pub cadence: String,
  pub first_charge_date: String,
  pub due_rule: String,
  pub day_of_month: Option<i64>,
  pub end_charge_date: Option<String>,
  pub active: bool,
}

#[tauri::command]
pub fn update_income_forecast(state: State<'_, AppState>, input: UpdateIncomeForecastInput) -> CmdResult<()> {
  to_cmd_result(update_income_forecast_inner(state, input))
}

fn update_income_forecast_inner(state: State<'_, AppState>, input: UpdateIncomeForecastInput) -> AppResult<()> {
  if crate::models::parse_iso_date(&input.first_charge_date).is_none() {
    return Err(AppError::Invalid("firstChargeDate must be YYYY-MM-DD".into()));
  }
  if input.amount_cents <= 0 {
    return Err(AppError::Invalid("amount must be positive".into()));
  }
  if let Some(ref end) = input.end_charge_date {
    if !end.is_empty() && crate::models::parse_iso_date(end).is_none() {
      return Err(AppError::Invalid("endChargeDate must be YYYY-MM-DD".into()));
    }
  }
  let allowed = ["yearly", "monthly", "weekly", "biweekly", "once"];
  if !allowed.contains(&input.cadence.as_str()) {
    return Err(AppError::Invalid("cadence invalid".into()));
  }
  let allowed_due = ["calendar_day", "first_business_day", "last_business_day"];
  if !allowed_due.contains(&input.due_rule.as_str()) {
    return Err(AppError::Invalid("dueRule invalid".into()));
  }
  let day_of_month = input.day_of_month.or_else(|| {
    if input.due_rule.as_str() == "calendar_day" {
      crate::models::parse_iso_date(&input.first_charge_date).map(|d| d.day() as i64)
    } else {
      None
    }
  });
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "UPDATE income_forecasts SET name = ?2, amount_cents = ?3, date = ?4, cadence = ?5, first_charge_date = ?4, due_rule = ?6, day_of_month = ?7, end_charge_date = ?8, active = ?9 WHERE id = ?1",
    params![
      input.id,
      input.name.trim(),
      input.amount_cents,
      input.first_charge_date,
      input.cadence,
      input.due_rule,
      day_of_month,
      input.end_charge_date.filter(|s| !s.is_empty()),
      if input.active { 1 } else { 0 },
    ],
  )?;
  materialize_due_income_forecasts(&conn)?;
  Ok(())
}

#[tauri::command]
pub fn delete_income_forecast(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_income_forecast_inner(state, id))
}

fn delete_income_forecast_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  clear_all_actuals_for_forecast(&conn, &id)?;
  conn.execute(
    "DELETE FROM ledger_transactions WHERE source_id LIKE ?1 OR source_id = ?2",
    params![format!("income_forecast:{id}:%"), id],
  )?;
  conn.execute("DELETE FROM income_forecast_actuals WHERE income_forecast_id = ?1", params![id])?;
  conn.execute("DELETE FROM income_forecasts WHERE id = ?1", params![id])?;
  Ok(())
}

#[tauri::command]
pub fn preview_income_forecast(state: State<'_, AppState>, id: String) -> CmdResult<Vec<String>> {
  to_cmd_result(preview_income_forecast_inner(state, id))
}

fn preview_income_forecast_inner(state: State<'_, AppState>, id: String) -> AppResult<Vec<String>> {
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
  let rs = today.format("%Y-%m-%d").to_string();
  let re = (today + chrono::Duration::days(365)).format("%Y-%m-%d").to_string();
  Ok(generate_occurrences_with_due_rule_rp(
    &first_charge_date,
    &cadence,
    &due_rule,
    day_of_month.and_then(|x| if x > 0 { Some(x as u32) } else { None }),
    &rs,
    &re,
    6,
    end_charge_date.as_deref(),
  ))
}

#[tauri::command]
pub fn list_variable_costs(state: State<'_, AppState>) -> CmdResult<Vec<crate::models::VariableCost>> {
  to_cmd_result(list_variable_costs_inner(state))
}

fn list_variable_costs_inner(state: State<'_, AppState>) -> AppResult<Vec<crate::models::VariableCost>> {
  let conn = state.conn.lock().unwrap();
  finalize_all_variable_cost_months(&conn)?;
  let current_month = variable_cost_stats_month();
  let month_closed = month_is_closed(&current_month)?;
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents, notes, icon, color, created_at FROM variable_costs ORDER BY name ASC",
  )?;
  let rows = stmt
    .query_map([], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, i64>(2)?,
        r.get::<_, Option<String>>(3)?,
        r.get::<_, Option<String>>(4)?.unwrap_or_else(|| "wallet".into()),
        r.get::<_, Option<String>>(5)?.unwrap_or_else(|| "#6366f1".into()),
        r.get::<_, String>(6)?,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;

  let mut out = Vec::new();
  for (id, name, amount_cents, notes, icon, color, created_at) in rows {
    let template = VariableCostTemplate {
      id: id.clone(),
      name: name.clone(),
      amount_cents,
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
  let (name, amount_cents, notes, icon, color, created_at): (String, i64, Option<String>, String, String, String) = conn
    .query_row(
      "SELECT name, amount_cents, notes, COALESCE(icon, 'wallet'), COALESCE(color, '#6366f1'), created_at FROM variable_costs WHERE id = ?1",
      params![id],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
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
    "SELECT id, date, title, amount_cents, notes FROM ledger_transactions
     WHERE variable_cost_id = ?1
     ORDER BY date ASC, created_at ASC",
  )?;
  let transactions = tx_stmt
    .query_map(params![id.clone()], |r| {
      Ok(crate::models::VariableCostCategorizedTransaction {
        id: Uuid::parse_str(r.get::<_, String>(0)?.as_str()).unwrap(),
        date: r.get(1)?,
        title: r.get(2)?,
        amount_cents: r.get(3)?,
        notes: r.get(4)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;

  let current_month = variable_cost_stats_month();
  let month_closed = month_is_closed(&current_month)?;
  let template = VariableCostTemplate {
    id: id.clone(),
    name: name.clone(),
    amount_cents,
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

fn iso_date(d: NaiveDate) -> String {
  d.format("%Y-%m-%d").to_string()
}

#[tauri::command]
pub fn get_month_view(state: State<'_, AppState>, month: String, account_id: Option<String>) -> CmdResult<MonthView> {
  to_cmd_result(get_month_view_inner(state, month, account_id))
}

fn get_month_view_inner(state: State<'_, AppState>, month: String, account_id: Option<String>) -> AppResult<MonthView> {
  let (start, end) = month_bounds(&month).ok_or_else(|| AppError::Invalid("month must be YYYY-MM".into()))?;
  let range_start = iso_date(start);
  let range_end = iso_date(end);

  {
    let conn = state.conn.lock().unwrap();
    materialize_due_income_forecasts(&conn)?;
    finalize_all_variable_cost_months(&conn)?;
  }

  let conn = state.conn.lock().unwrap();
  let stock_portfolio_cents = cached_stock_portfolio_cents_if_needed(&state, &conn, &account_id)?;
  let names = account_name_map(&conn)?;
  let liquid_flags = account_liquid_map(&conn)?;
  let main_id = get_main_account_id(&conn)?;
  let main_name = account_name_of(&names, &main_id);

  let start_balance = prognostic_total_cents(
    &conn,
    &range_start,
    &account_id,
    &main_id,
    stock_portfolio_cents,
    false,
  )?;
  let start_liquid = prognostic_liquid_cents(
    &conn,
    &range_start,
    &account_id,
    &main_id,
    stock_portfolio_cents,
    false,
  )?;

  let mut income: i64 = 0;
  let mut fixed_costs_sum: i64 = 0;
  let mut variable_costs_sum: i64 = 0;
  let mut buys_sum: i64 = 0;
  let mut events: Vec<TimelineEvent> = Vec::new();

  // Ledger events in range
  {
    let mut stmt = conn.prepare(
      "SELECT id, kind, title, amount_cents, date, account_id, from_account_id, to_account_id, variable_cost_id FROM ledger_transactions WHERE date >= ?1 AND date <= ?2 ORDER BY date ASC",
    )?;
    let rows = stmt.query_map(params![range_start, range_end], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, String>(2)?,
        r.get::<_, i64>(3)?,
        r.get::<_, String>(4)?,
        r.get::<_, Option<String>>(5)?,
        r.get::<_, Option<String>>(6)?,
        r.get::<_, Option<String>>(7)?,
        r.get::<_, Option<String>>(8)?,
      ))
    })?;
    for row in rows {
      let (id, kind, title, amount_cents, ev_date, acc, from_id, to_id, variable_cost_id) = row?;
      if kind == "expense"
        && should_hide_categorized_variable_cost_event(variable_cost_id.as_deref(), &ev_date)?
      {
        continue;
      }
      if kind == "transfer" {
        let from = from_id.as_deref().unwrap_or("");
        let to = to_id.as_deref().unwrap_or("");
        if let Some(ref fid) = account_id {
          if fid == from {
            events.push(TimelineEvent {
              id: format!("ledger:transfer:{}", id),
              r#type: "transfer".into(),
              date: ev_date,
              title: format!("Transfer → {}", account_name_of(&names, to)),
              amount_cents: -amount_cents,
              account_id: Some(from.to_string()),
              account_name: Some(account_name_of(&names, from)),
            });
          } else if fid == to {
            events.push(TimelineEvent {
              id: format!("ledger:transfer:{}", id),
              r#type: "transfer".into(),
              date: ev_date,
              title: format!("Transfer ← {}", account_name_of(&names, from)),
              amount_cents,
              account_id: Some(to.to_string()),
              account_name: Some(account_name_of(&names, to)),
            });
          }
        } else {
          let from_liquid = liquid_flags.get(from).copied().unwrap_or(false);
          let to_liquid = liquid_flags.get(to).copied().unwrap_or(false);
          let (mapped_amount, mapped_account) = match (from_liquid, to_liquid) {
            (true, false) => (-amount_cents, Some(from.to_string())),
            (false, true) => (amount_cents, Some(to.to_string())),
            _ => (0i64, None),
          };
          events.push(TimelineEvent {
            id: format!("ledger:transfer:{}", id),
            r#type: "transfer".into(),
            date: ev_date,
            title: format!("Transfer: {} → {}", account_name_of(&names, from), account_name_of(&names, to)),
            amount_cents: mapped_amount,
            account_id: mapped_account,
            account_name: Some(format!("{} → {}", account_name_of(&names, from), account_name_of(&names, to))),
          });
        }
        continue;
      }
      let aid = acc.as_deref().unwrap_or("");
      if !event_matches_account(&account_id, &main_id, Some(aid)) {
        continue;
      }
      if kind == "buy_apply" {
        buys_sum += amount_cents.abs();
      }
      events.push(TimelineEvent {
        id: format!("ledger:{}:{}", kind, id),
        r#type: kind,
        date: ev_date,
        title,
        amount_cents,
        account_id: acc.clone(),
        account_name: Some(account_name_of(&names, aid)),
      });
    }
  }

  // Income forecasts in range (unbooked, Hauptkonto)
  if event_matches_account(&account_id, &main_id, Some(main_id.as_str())) {
    push_unbooked_income_events_for_range(
      &conn,
      &range_start,
      &range_end,
      &month,
      &main_id,
      &main_name,
      &mut events,
      &mut income,
    )?;
  }

  // Fixed costs
  push_fixed_cost_events_for_range(
    &conn,
    &names,
    &range_start,
    &range_end,
    &account_id,
    &main_id,
    &mut events,
    &mut fixed_costs_sum,
    200,
  )?;

  // Variable costs in range (Hauptkonto, monthly)
  if event_matches_account(&account_id, &main_id, Some(main_id.as_str())) {
    push_variable_cost_events_for_month(
      &conn,
      &month,
      &main_id,
      &main_name,
      &mut events,
      &mut variable_costs_sum,
    )?;
  }

  // Planned (parked) buy items for this month (Hauptkonto)
  if event_matches_account(&account_id, &main_id, Some(main_id.as_str())) {
    let mut stmt2 = conn.prepare(
      "SELECT id, name, amount_cents FROM buy_items WHERE status='parked' AND planned_month = ?1",
    )?;
    let rows2 = stmt2.query_map(params![month.clone()], |r| {
      Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
    })?;
    for row in rows2 {
      let (id, name, amount_cents) = row?;
      buys_sum += amount_cents;
      events.push(TimelineEvent {
        id: format!("buy_planned:{}:{}", id, month),
        r#type: "buy_planned".into(),
        date: range_start.clone(),
        title: format!("{name} (geplant)"),
        amount_cents: -amount_cents,
        account_id: Some(main_id.clone()),
        account_name: Some(main_name.clone()),
      });
    }
  }

  if let Some(ref fid) = account_id {
    if account_balance_source(&conn, fid)? == "stock_portfolio" {
      push_depot_stock_purchase_events(
        &conn,
        &names,
        fid,
        &range_start,
        &range_end,
        &mut events,
        true,
        &mut buys_sum,
      )?;
    }
  }

  events.sort_by(|a, b| a.date.cmp(&b.date).then(a.title.cmp(&b.title)));

  let transfers_sum = ledger_transfers_in_range(&conn, &range_start, &range_end)?;
  let end_balance = prognostic_total_cents(
    &conn,
    &range_end,
    &account_id,
    &main_id,
    stock_portfolio_cents,
    true,
  )?;
  let liquid = prognostic_liquid_cents(
    &conn,
    &range_end,
    &account_id,
    &main_id,
    stock_portfolio_cents,
    true,
  )?;

  let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();
  let as_of = if today.as_str() <= range_end.as_str() {
    today
  } else {
    range_end.clone()
  };
  let kontostand = kontostand_total_cents(
    &conn,
    &as_of,
    &account_id,
    stock_portfolio_cents,
    false,
  )?;
  let deferred = ledger_deferred_income_cents(&conn, &as_of, &month, &account_id, &main_id)?;
  let kontostand_saldo = kontostand - deferred;
  let start_kontostand = kontostand_total_cents(
    &conn,
    &range_start,
    &account_id,
    stock_portfolio_cents,
    false,
  )?;
  let start_deferred =
    ledger_deferred_income_cents(&conn, &range_start, &month, &account_id, &main_id)?;
  let kontostand_start_saldo = start_kontostand - start_deferred;
  let prev_month = month_add_iso(&month, -1).unwrap_or_else(|| month.clone());
  let prev_range_end = month_bounds(&prev_month)
    .map(|(_, end)| iso_date(end))
    .unwrap_or_else(|| range_start.clone());
  let prev_kontostand = kontostand_total_cents(
    &conn,
    &prev_range_end,
    &account_id,
    stock_portfolio_cents,
    true,
  )?;

  Ok(MonthView {
    month,
    start_balance_cents: start_balance,
    income_cents: income,
    fixed_costs_cents: fixed_costs_sum,
    variable_costs_cents: variable_costs_sum,
    applied_buys_cents: buys_sum,
    transfers_cents: transfers_sum,
    end_balance_cents: end_balance,
    start_liquid_cents: start_liquid,
    total_liquid_cents: liquid,
    kontostand_cents: kontostand,
    kontostand_saldo_cents: kontostand_saldo,
    kontostand_as_of: as_of,
    kontostand_start_cents: start_kontostand,
    kontostand_start_saldo_cents: kontostand_start_saldo,
    prev_kontostand_cents: prev_kontostand,
    events,
  })
}

fn ledger_account_balance_until(conn: &rusqlite::Connection, date_inclusive: &str, account_id: &str) -> AppResult<i64> {
  let anchor: Option<(i64, String, String)> = conn
    .query_row(
      "SELECT amount_cents, date, created_at FROM ledger_transactions
       WHERE account_id = ?1 AND kind = 'adjustment' AND date <= ?2
       ORDER BY date DESC, created_at DESC LIMIT 1",
      params![account_id, date_inclusive],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .optional()?;

  let (base, after_date, after_created) = match anchor {
    Some((amount, date, created_at)) => (amount, Some(date), Some(created_at)),
    None => (0i64, None, None),
  };

  let normal: i64 = if let (Some(adj_date), Some(adj_created)) = (&after_date, &after_created) {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions
       WHERE account_id = ?1 AND kind != 'adjustment' AND date <= ?2
         AND (date > ?3 OR (date = ?3 AND created_at > ?4))",
      params![account_id, date_inclusive, adj_date, adj_created],
      |r| r.get(0),
    )?
  } else {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions
       WHERE account_id = ?1 AND kind != 'adjustment' AND date <= ?2",
      params![account_id, date_inclusive],
      |r| r.get(0),
    )?
  };

  let incoming: i64 = if let (Some(adj_date), Some(adj_created)) = (&after_date, &after_created) {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions
       WHERE to_account_id = ?1 AND date <= ?2
         AND (date > ?3 OR (date = ?3 AND created_at > ?4))",
      params![account_id, date_inclusive, adj_date, adj_created],
      |r| r.get(0),
    )?
  } else {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE to_account_id = ?1 AND date <= ?2",
      params![account_id, date_inclusive],
      |r| r.get(0),
    )?
  };

  let outgoing: i64 = if let (Some(adj_date), Some(adj_created)) = (&after_date, &after_created) {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions
       WHERE from_account_id = ?1 AND date <= ?2
         AND (date > ?3 OR (date = ?3 AND created_at > ?4))",
      params![account_id, date_inclusive, adj_date, adj_created],
      |r| r.get(0),
    )?
  } else {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE from_account_id = ?1 AND date <= ?2",
      params![account_id, date_inclusive],
      |r| r.get(0),
    )?
  };

  Ok(base + normal + incoming - outgoing)
}

fn ledger_total_until(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  stock_portfolio_cents: Option<i64>,
) -> AppResult<i64> {
  let mut stmt = conn.prepare("SELECT id FROM accounts")?;
  let ids = stmt
    .query_map([], |r| r.get::<_, String>(0))?
    .collect::<Result<Vec<_>, _>>()?;
  let mut total = 0i64;
  for id in ids {
    total += account_effective_balance_cents(conn, date_inclusive, &id, stock_portfolio_cents)?;
  }
  Ok(total)
}

fn ledger_liquid_total_until(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  stock_portfolio_cents: Option<i64>,
) -> AppResult<i64> {
  let mut stmt = conn.prepare("SELECT id FROM accounts WHERE is_liquid = 1")?;
  let ids = stmt
    .query_map([], |r| r.get::<_, String>(0))?
    .collect::<Result<Vec<_>, _>>()?;
  let mut total = 0i64;
  for id in ids {
    total += account_effective_balance_cents(conn, date_inclusive, &id, stock_portfolio_cents)?;
  }
  Ok(total)
}

fn ledger_transfers_in_range(conn: &rusqlite::Connection, rs: &str, re: &str) -> AppResult<i64> {
  // informational: sum of transfer amounts in range
  let v: i64 = conn
    .query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE kind='transfer' AND date >= ?1 AND date <= ?2",
      params![rs, re],
      |r| r.get(0),
    )?;
  Ok(v)
}

