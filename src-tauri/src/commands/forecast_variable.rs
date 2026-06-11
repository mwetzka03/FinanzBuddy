pub(crate) const VARIABLE_COSTS_START_MONTH: &str = "2026-06";

use super::helpers::{event_matches_account, iso_date, month_from_date};
use crate::accounts::get_main_account_id;
use crate::error::{AppError, AppResult};
use crate::logic::{last_day_of_month_iso, month_add_iso, month_bounds};
use crate::models::TimelineEvent;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

pub(crate) fn variable_cost_source_id(vc_id: &str, month: &str) -> String {
  format!("variable_cost:{}:{}", vc_id, month)
}

pub(crate) fn variable_costs_active_month(month: &str) -> bool {
  month >= VARIABLE_COSTS_START_MONTH
}

/// Monat für Anzeige von Budget/Ist in Listen und Übersicht (ab Startmonat der variablen Kosten).
pub(crate) fn variable_cost_stats_month() -> String {
  let now = Utc::now().format("%Y-%m").to_string();
  if now.as_str() < VARIABLE_COSTS_START_MONTH {
    VARIABLE_COSTS_START_MONTH.to_string()
  } else {
    now
  }
}

pub(crate) struct VariableCostTemplate {
  pub(crate) id: String,
  pub(crate) name: String,
  pub(crate) amount_cents: i64,
  pub(crate) account_id: String,
}

pub(crate) fn load_variable_cost_templates(conn: &rusqlite::Connection) -> AppResult<Vec<VariableCostTemplate>> {
  let main_id = get_main_account_id(conn)?;
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents, COALESCE(account_id, ?1) FROM variable_costs ORDER BY name ASC",
  )?;
  let rows = stmt
    .query_map(params![main_id], |r| {
      Ok(VariableCostTemplate {
        id: r.get(0)?,
        name: r.get(1)?,
        amount_cents: r.get(2)?,
        account_id: r.get(3)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

pub(crate) fn actual_amount_for_month(
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


pub(crate) fn sum_categorized_transactions_for_month(
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
pub(crate) fn open_month_categorized_variable_cost_ledger_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_filter: &Option<String>,
  main_id: &str,
) -> AppResult<i64> {
  let scope = super::helpers::account_filter_scope(conn, account_filter)?;
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
    if !event_matches_account(&scope, main_id, Some(aid)) {
      continue;
    }
    sum += amount_cents.abs();
  }
  Ok(sum)
}

pub(crate) fn variable_cost_ledger_excluded_from_flow_totals(
  variable_cost_id: Option<&str>,
  tx_date: &str,
) -> AppResult<bool> {
  if variable_cost_id.is_none() {
    return Ok(false);
  }
  let month = month_from_date(tx_date)?;
  Ok(!month_is_closed(&month)?)
}

pub(crate) fn validate_variable_cost_id(conn: &rusqlite::Connection, vc_id: &str) -> AppResult<()> {
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

pub(crate) fn month_is_closed(month: &str) -> AppResult<bool> {
  let end = last_day_of_month_iso(month).ok_or_else(|| AppError::Invalid("invalid month".into()))?;
  let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();
  Ok(today.as_str() > end.as_str())
}

pub(crate) fn clear_transaction_derived_actual(
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

pub(crate) fn sync_variable_cost_from_transactions(
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

pub(crate) fn finalize_all_variable_cost_months(conn: &rusqlite::Connection) -> AppResult<()> {
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

pub(crate) fn resync_variable_cost_months(
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

pub(crate) fn ledger_tx_is_categorizable(conn: &rusqlite::Connection, id: &str) -> AppResult<bool> {
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

pub(crate) fn actual_for_month(
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
pub(crate) fn variable_cost_tatsaechlich_cents(
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

pub(crate) fn variable_cost_effective_amount(
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

pub(crate) fn sync_variable_actual_ledger(
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

pub(crate) fn clear_variable_actual_ledger(conn: &rusqlite::Connection, vc_id: &str, month: &str) -> AppResult<()> {
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

pub(crate) fn variable_costs_forecast_until(conn: &rusqlite::Connection, cutoff_inclusive: &str) -> AppResult<i64> {
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

pub(crate) fn sum_categorized_transactions_in_range(
  conn: &rusqlite::Connection,
  vc_id: &str,
  range_start: &str,
  range_end: &str,
) -> AppResult<i64> {
  let sum: i64 = conn.query_row(
    "SELECT COALESCE(SUM(ABS(amount_cents)), 0) FROM ledger_transactions
     WHERE variable_cost_id = ?1 AND kind = 'expense' AND date >= ?2 AND date <= ?3",
    params![vc_id, range_start, range_end],
    |r| r.get(0),
  )?;
  Ok(sum)
}

pub(crate) fn sum_variable_cost_prognosis_for_period(
  conn: &rusqlite::Connection,
  period_start: &str,
  period_end: &str,
  account_filter: &Option<String>,
  main_id: &str,
  deduct_spent: bool,
) -> AppResult<i64> {
  if period_end.len() < 7 || &period_end[..7] < VARIABLE_COSTS_START_MONTH {
    return Ok(0);
  }
  let scope = super::helpers::account_filter_scope(conn, account_filter)?;
  let mut total = 0i64;
  for t in load_variable_cost_templates(conn)? {
    if !event_matches_account(&scope, main_id, Some(t.account_id.as_str())) {
      continue;
    }
    let spent = if deduct_spent {
      sum_categorized_transactions_in_range(conn, &t.id, period_start, period_end)?
    } else {
      0
    };
    total += (t.amount_cents - spent).max(0);
  }
  Ok(total)
}

pub(crate) fn push_variable_cost_events_for_period(
  conn: &rusqlite::Connection,
  period_start: &str,
  period_end: &str,
  account_filter: &Option<String>,
  main_id: &str,
  _main_name: &str,
  events: &mut Vec<TimelineEvent>,
  variable_costs_sum: &mut i64,
) -> AppResult<()> {
  if period_start.len() < 7 || period_end.len() < 7 {
    return Ok(());
  }
  let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();
  if today.as_str() > period_end {
    return Ok(());
  }
  let period_is_future = today.as_str() < period_start;
  let deduct_spent = !period_is_future;
  let scope = super::helpers::account_filter_scope(conn, account_filter)?;
  let names = super::helpers::account_name_map(conn)?;
  for t in load_variable_cost_templates(conn)? {
    if !event_matches_account(&scope, main_id, Some(t.account_id.as_str())) {
      continue;
    }
    let spent = if deduct_spent {
      sum_categorized_transactions_in_range(conn, &t.id, period_start, period_end)?
    } else {
      0
    };
    let remaining = (t.amount_cents - spent).max(0);
    if remaining == 0 {
      continue;
    }
    *variable_costs_sum += remaining;
    events.push(TimelineEvent {
      id: format!("variable_cost:{}:{}", t.id, period_end),
      r#type: "variable_cost".into(),
      date: period_end.to_string(),
      title: format!("{} (Prognose)", t.name),
      amount_cents: -remaining,
      account_id: Some(t.account_id.clone()),
      account_name: Some(super::helpers::account_name_of(&names, &t.account_id)),
      internal_transfer: false,
      fixed_cost_id: None,
      variable_cost_id: None,
      buy_item_id: None,
      buy_item_group_id: None,
      notes: None,
    });
  }
  Ok(())
}

#[cfg(test)]
mod variable_period_tests {
  use super::*;
  use crate::db::{migrate, open_db};
  use crate::models::TimelineEvent;
  use std::path::PathBuf;

  fn test_conn() -> rusqlite::Connection {
    let path = PathBuf::from(std::env::temp_dir()).join(format!(
      "finanzbuddy-vc-period-{}.sqlite3",
      uuid::Uuid::new_v4()
    ));
    let _ = std::fs::remove_file(&path);
    let conn = open_db(&path).unwrap();
    migrate(&conn).unwrap();
    conn
      .execute(
        "INSERT INTO accounts (id, name, is_liquid, created_at) VALUES ('acc1', 'Main', 1, datetime('now'))",
        [],
      )
      .unwrap();
    conn
      .execute(
        "INSERT INTO app_settings (key, value) VALUES ('main_account_id', 'acc1')",
        [],
      )
      .unwrap();
    conn
  }

  #[test]
  fn future_period_variable_cost_ignores_spending_from_other_periods() {
    let conn = test_conn();
    conn
      .execute(
        "INSERT INTO variable_costs (id, name, amount_cents, charge_day, created_at, account_id)
         VALUES ('vc1', 'Einkauf', 30000, 31, datetime('now'), 'acc1')",
        [],
      )
      .unwrap();
    conn
      .execute(
        "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, kind, title, variable_cost_id, created_at)
         VALUES ('tx1', '2026-06-15', -2850, 'acc1', 'expense', 'Shop', 'vc1', datetime('now'))",
        [],
      )
      .unwrap();

    let mut events = Vec::<TimelineEvent>::new();
    let mut total = 0i64;
    push_variable_cost_events_for_period(
      &conn,
      "2026-06-30",
      "2026-07-30",
      &None,
      "acc1",
      "Main",
      &mut events,
      &mut total,
    )
    .unwrap();

    assert_eq!(events.len(), 1);
    assert_eq!(total, 30000);
    assert_eq!(events[0].amount_cents, -30000);
  }
}
