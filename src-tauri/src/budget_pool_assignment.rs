use crate::dashboard_period::{list_salary_periods, SalaryPeriod};
use crate::dashboard_period::effective_period_for_month;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetPoolSplitInput {
  pub budget_pool_id: String,
  pub amount_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableCostSplitInput {
  pub variable_cost_id: String,
  pub amount_cents: i64,
}

pub fn budget_pool_period_key(conn: &Connection, period_mode: &str, date: &str) -> AppResult<String> {
  if period_mode == "yearly" {
    if date.len() >= 4 {
      return Ok(date[..4].to_string());
    }
    return Err(AppError::Invalid("Ungültiges Datum für Jahres-Budget".into()));
  }
  let month = if date.len() >= 7 { &date[..7] } else { date };
  let period = effective_period_for_month(conn, month)?;
  Ok(format!("{}:{}", period.period_start, period.period_end))
}

pub fn sum_budget_pool_actual_for_period(
  conn: &Connection,
  pool_id: &str,
  period_key: &str,
) -> AppResult<i64> {
  conn.query_row(
    "SELECT COALESCE(SUM(amount_cents), 0) FROM ledger_budget_pool_splits WHERE budget_pool_id = ?1 AND period_key = ?2",
    params![pool_id, period_key],
    |r| r.get(0),
  )
  .map_err(Into::into)
}

pub fn list_ledger_budget_pool_splits(
  conn: &Connection,
  ledger_id: &str,
) -> AppResult<Vec<BudgetPoolSplitInput>> {
  let mut stmt = conn.prepare(
    "SELECT budget_pool_id, amount_cents FROM ledger_budget_pool_splits WHERE ledger_transaction_id = ?1 ORDER BY created_at ASC",
  )?;
  let rows = stmt
    .query_map(params![ledger_id], |r| {
      Ok(BudgetPoolSplitInput {
        budget_pool_id: r.get(0)?,
        amount_cents: r.get(1)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

pub fn list_ledger_variable_cost_splits(
  conn: &Connection,
  ledger_id: &str,
) -> AppResult<Vec<VariableCostSplitInput>> {
  let mut stmt = conn.prepare(
    "SELECT variable_cost_id, amount_cents FROM ledger_variable_cost_splits WHERE ledger_transaction_id = ?1 ORDER BY created_at ASC",
  )?;
  let rows = stmt
    .query_map(params![ledger_id], |r| {
      Ok(VariableCostSplitInput {
        variable_cost_id: r.get(0)?,
        amount_cents: r.get(1)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetPoolPeriodHistoryRow {
  pub period_key: String,
  pub period_label: String,
  pub base_planned_cents: i64,
  pub carry_over_cents: i64,
  pub planned_cents: i64,
  pub actual_cents: i64,
  pub remaining_cents: i64,
  pub is_current: bool,
}

pub fn budget_pool_style(conn: &Connection, pool_id: &str) -> AppResult<(String, String)> {
  conn.query_row(
    "SELECT icon, color FROM budget_pools WHERE id = ?1",
    params![pool_id],
    |r| Ok((r.get(0)?, r.get(1)?)),
  )
  .map_err(|_| AppError::Invalid("Budgetpool nicht gefunden".into()))
}

fn period_key_sort_key(period_key: &str) -> String {
  if let Some((start, _)) = period_key.split_once(':') {
    start.to_string()
  } else {
    format!("{}-01-01", period_key)
  }
}

fn format_period_label(period_mode: &str, period_key: &str) -> String {
  if period_mode == "yearly" {
    return period_key.to_string();
  }
  if let Some((start, end)) = period_key.split_once(':') {
    return format!("{} – {}", start, end);
  }
  period_key.to_string()
}

fn collect_period_keys_for_pool(
  conn: &Connection,
  period_mode: &str,
  start_period_key: &str,
  current_date: &str,
  scalable: bool,
  pool_id: &str,
) -> AppResult<Vec<String>> {
  let current_key = budget_pool_period_key(conn, period_mode, current_date)?;
  let start_key = start_period_key.to_string();

  if period_mode == "yearly" {
    let start_year: i32 = start_key.parse().map_err(|_| AppError::Invalid("invalid year".into()))?;
    let end_year: i32 = current_key.parse().map_err(|_| AppError::Invalid("invalid year".into()))?;
    let mut keys = Vec::new();
    for year in start_year..=end_year {
      keys.push(year.to_string());
    }
    if !scalable {
      keys.retain(|key| {
        key == &current_key
          || sum_budget_pool_actual_for_period(conn, pool_id, key).unwrap_or(0) > 0
      });
    }
    return Ok(keys);
  }

  let periods = list_salary_periods(conn)?;
  let start_sort = period_key_sort_key(&start_key);
  let current_sort = period_key_sort_key(&current_key);
  let mut keys: Vec<String> = periods
    .iter()
    .filter(|p| {
      let key = salary_period_key(p);
      let sort = period_key_sort_key(&key);
      sort >= start_sort && sort <= current_sort
    })
    .map(salary_period_key)
    .collect();

  if keys.is_empty() {
    keys.push(current_key.clone());
  }

  if !scalable {
    keys.retain(|key| {
      key == &current_key || sum_budget_pool_actual_for_period(conn, pool_id, key).unwrap_or(0) > 0
    });
    if keys.is_empty() {
      keys.push(current_key);
    }
  }

  Ok(keys)
}

fn salary_period_key(period: &SalaryPeriod) -> String {
  format!("{}:{}", period.period_start, period.period_end)
}

pub fn compute_budget_pool_period_history(
  conn: &Connection,
  pool_id: &str,
  base_amount_cents: i64,
  period_mode: &str,
  scalable: bool,
  start_period_key: &str,
  current_date: &str,
) -> AppResult<Vec<BudgetPoolPeriodHistoryRow>> {
  let current_key = budget_pool_period_key(conn, period_mode, current_date)?;
  let period_keys = collect_period_keys_for_pool(
    conn,
    period_mode,
    start_period_key,
    current_date,
    scalable,
    pool_id,
  )?;
  let mut carry = 0i64;
  let mut out = Vec::new();

  for period_key in period_keys {
    let carry_in = if scalable { carry } else { 0 };
    let planned = base_amount_cents + carry_in;
    let actual = sum_budget_pool_actual_for_period(conn, pool_id, &period_key)?;
    let remaining = planned - actual;
    if scalable {
      carry = remaining;
    }
    out.push(BudgetPoolPeriodHistoryRow {
      period_key: period_key.clone(),
      period_label: format_period_label(period_mode, &period_key),
      base_planned_cents: base_amount_cents,
      carry_over_cents: carry_in,
      planned_cents: planned,
      actual_cents: actual,
      remaining_cents: remaining,
      is_current: period_key == current_key,
    });
  }

  out.reverse();
  Ok(out)
}

pub fn budget_pool_start_period_key(
  conn: &Connection,
  period_mode: &str,
  scalable: bool,
  scalable_start_period_key: Option<&str>,
  created_at: &str,
) -> AppResult<String> {
  if scalable {
    if let Some(key) = scalable_start_period_key.filter(|value| !value.trim().is_empty()) {
      return Ok(key.to_string());
    }
    let created_date = if created_at.len() >= 10 {
      &created_at[..10]
    } else {
      created_at
    };
    return budget_pool_period_key(conn, period_mode, created_date);
  }
  let created_date = if created_at.len() >= 10 {
    &created_at[..10]
  } else {
    created_at
  };
  budget_pool_period_key(conn, period_mode, created_date)
}

pub fn budget_pool_current_period_stats(
  conn: &Connection,
  pool_id: &str,
  base_amount_cents: i64,
  period_mode: &str,
  scalable: bool,
  start_period_key: &str,
  current_date: &str,
) -> AppResult<(String, i64, i64, i64, i64)> {
  let history = compute_budget_pool_period_history(
    conn,
    pool_id,
    base_amount_cents,
    period_mode,
    scalable,
    start_period_key,
    current_date,
  )?;
  let current = history
    .iter()
    .find(|row| row.is_current)
    .or_else(|| history.first())
    .ok_or_else(|| AppError::Invalid("Kein Budgetpool-Zeitraum".into()))?;
  Ok((
    current.period_key.clone(),
    current.carry_over_cents,
    current.planned_cents,
    current.actual_cents,
    current.remaining_cents,
  ))
}

pub fn sync_budget_pool_display_style(conn: &Connection, ledger_id: &str) -> AppResult<()> {
  let (variable_cost_id, fixed_cost_id, buy_item_id, buy_item_group_id): (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
  ) = conn.query_row(
    "SELECT variable_cost_id, fixed_cost_id, buy_item_id, buy_item_group_id FROM ledger_transactions WHERE id = ?1",
    params![ledger_id],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
  )?;

  let variable_split_count: i64 = conn.query_row(
    "SELECT COUNT(*) FROM ledger_variable_cost_splits WHERE ledger_transaction_id = ?1",
    params![ledger_id],
    |r| r.get(0),
  )?;

  if variable_cost_id.is_some()
    || fixed_cost_id.is_some()
    || buy_item_id.is_some()
    || buy_item_group_id.is_some()
    || variable_split_count > 0
  {
    return Ok(());
  }

  let pool_id: Option<String> = conn.query_row(
    "SELECT budget_pool_id FROM ledger_budget_pool_splits WHERE ledger_transaction_id = ?1 ORDER BY created_at ASC LIMIT 1",
    params![ledger_id],
    |r| r.get(0),
  ).ok();

  if let Some(pool_id) = pool_id {
    let (icon, color) = budget_pool_style(conn, &pool_id)?;
    conn.execute(
      "UPDATE ledger_transactions SET icon = ?2, color = ?3 WHERE id = ?1",
      params![ledger_id, icon, color],
    )?;
  }

  Ok(())
}

fn revert_budget_pool_splits_for_ledger(conn: &Connection, ledger_id: &str) -> AppResult<()> {
  conn.execute(
    "DELETE FROM ledger_budget_pool_splits WHERE ledger_transaction_id = ?1",
    params![ledger_id],
  )?;
  Ok(())
}

fn revert_variable_cost_splits_for_ledger(conn: &Connection, ledger_id: &str) -> AppResult<()> {
  conn.execute(
    "DELETE FROM ledger_variable_cost_splits WHERE ledger_transaction_id = ?1",
    params![ledger_id],
  )?;
  Ok(())
}

pub fn clear_budget_pool_splits_for_ledger(conn: &Connection, ledger_id: &str) -> AppResult<()> {
  revert_budget_pool_splits_for_ledger(conn, ledger_id)
}

pub fn clear_variable_cost_splits_for_ledger(conn: &Connection, ledger_id: &str) -> AppResult<()> {
  revert_variable_cost_splits_for_ledger(conn, ledger_id)
}

pub fn clear_expense_splits_for_ledger(conn: &Connection, ledger_id: &str) -> AppResult<()> {
  revert_budget_pool_splits_for_ledger(conn, ledger_id)?;
  revert_variable_cost_splits_for_ledger(conn, ledger_id)?;
  Ok(())
}

fn ledger_expense_total(conn: &Connection, ledger_id: &str) -> AppResult<(String, String, i64)> {
  conn.query_row(
    "SELECT kind, date, amount_cents FROM ledger_transactions WHERE id = ?1",
    params![ledger_id],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
  )
  .map_err(Into::into)
}

pub fn apply_variable_cost_splits(
  conn: &Connection,
  ledger_id: &str,
  variable_splits: &[VariableCostSplitInput],
) -> AppResult<()> {
  if variable_splits.is_empty() {
    clear_variable_cost_splits_for_ledger(conn, ledger_id)?;
    conn.execute(
      "UPDATE ledger_transactions SET variable_cost_id = NULL WHERE id = ?1",
      params![ledger_id],
    )?;
    return Ok(());
  }

  let (kind, date, amount_cents) = ledger_expense_total(conn, ledger_id)?;
  if kind != "expense" {
    return Err(AppError::Invalid("Aufteilung ist nur für Ausgaben möglich".into()));
  }

  let tx_total = amount_cents.abs();
  let mut split_sum = 0i64;
  clear_variable_cost_splits_for_ledger(conn, ledger_id)?;

  let now = chrono::Utc::now().to_rfc3339();
  let month_key = if date.len() >= 7 {
    date[..7].to_string()
  } else {
    date.clone()
  };

  let mut seen_vc = std::collections::HashSet::new();
  for split in variable_splits {
    if split.amount_cents <= 0 {
      return Err(AppError::Invalid("Aufteilungsbeträge müssen positiv sein".into()));
    }
    if !seen_vc.insert(split.variable_cost_id.clone()) {
      return Err(AppError::Invalid("Variable Kosten doppelt in Aufteilung".into()));
    }
    split_sum += split.amount_cents;
    let exists: i64 = conn.query_row(
      "SELECT COUNT(*) FROM variable_costs WHERE id = ?1",
      params![split.variable_cost_id],
      |r| r.get(0),
    )?;
    if exists == 0 {
      return Err(AppError::Invalid("Variable Kosten nicht gefunden".into()));
    }
    conn.execute(
      "INSERT INTO ledger_variable_cost_splits (id, ledger_transaction_id, variable_cost_id, amount_cents, month_key, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      params![
        Uuid::new_v4().to_string(),
        ledger_id,
        split.variable_cost_id,
        split.amount_cents,
        month_key,
        now,
      ],
    )?;
  }

  if split_sum != tx_total {
    return Err(AppError::Invalid(format!(
      "Summe der variablen Aufteilung ({:.2} EUR) muss dem Buchungsbetrag ({:.2} EUR) entsprechen",
      split_sum as f64 / 100.0,
      tx_total as f64 / 100.0
    )));
  }

  let primary_vc = variable_splits.first().map(|s| s.variable_cost_id.as_str());
  conn.execute(
    "UPDATE ledger_transactions SET variable_cost_id = ?2 WHERE id = ?1",
    params![ledger_id, primary_vc],
  )?;
  if let Some(vc_id) = primary_vc {
    let (icon, color) = crate::cost_assignment::variable_cost_style(conn, vc_id)?;
    conn.execute(
      "UPDATE ledger_transactions SET icon = ?2, color = ?3 WHERE id = ?1",
      params![ledger_id, icon, color],
    )?;
  }

  Ok(())
}

pub fn apply_budget_pool_splits(
  conn: &Connection,
  ledger_id: &str,
  budget_pool_splits: &[BudgetPoolSplitInput],
) -> AppResult<()> {
  if budget_pool_splits.is_empty() {
    return clear_budget_pool_splits_for_ledger(conn, ledger_id);
  }

  let (kind, date, amount_cents) = ledger_expense_total(conn, ledger_id)?;
  if kind != "expense" {
    return Err(AppError::Invalid("Budgetpool-Zuordnung ist nur für Ausgaben möglich".into()));
  }

  let tx_total = amount_cents.abs();
  let mut split_sum = 0i64;
  clear_budget_pool_splits_for_ledger(conn, ledger_id)?;

  let now = chrono::Utc::now().to_rfc3339();
  let mut seen_bp = std::collections::HashSet::new();
  for split in budget_pool_splits {
    if split.amount_cents <= 0 {
      return Err(AppError::Invalid("Aufteilungsbeträge müssen positiv sein".into()));
    }
    if !seen_bp.insert(split.budget_pool_id.clone()) {
      return Err(AppError::Invalid("Budgetpool doppelt in Aufteilung".into()));
    }
    split_sum += split.amount_cents;
    let period_mode: String = conn.query_row(
      "SELECT period_mode FROM budget_pools WHERE id = ?1",
      params![split.budget_pool_id],
      |r| r.get(0),
    )
    .map_err(|_| AppError::Invalid("Budgetpool nicht gefunden".into()))?;
    let period_key = budget_pool_period_key(conn, &period_mode, &date)?;
    conn.execute(
      "INSERT INTO ledger_budget_pool_splits (id, ledger_transaction_id, budget_pool_id, amount_cents, period_key, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      params![
        Uuid::new_v4().to_string(),
        ledger_id,
        split.budget_pool_id,
        split.amount_cents,
        period_key,
        now,
      ],
    )?;
  }

  if split_sum != tx_total {
    return Err(AppError::Invalid(format!(
      "Summe der Budgetpool-Aufteilung ({:.2} EUR) muss dem Buchungsbetrag ({:.2} EUR) entsprechen",
      split_sum as f64 / 100.0,
      tx_total as f64 / 100.0
    )));
  }

  Ok(())
}
