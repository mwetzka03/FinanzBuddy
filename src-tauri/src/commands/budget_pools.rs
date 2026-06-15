use super::helpers::{normalize_color, normalize_icon, to_cmd_result, CmdResult};
use crate::accounts::get_main_account_id;
use crate::budget_pool_assignment::{
  budget_pool_current_period_stats, budget_pool_start_period_key, compute_budget_pool_period_history,
  BudgetPoolPeriodHistoryRow,
};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetPool {
  pub id: String,
  pub name: String,
  pub amount_cents: i64,
  pub period_mode: String,
  pub account_id: String,
  pub icon: String,
  pub color: String,
  pub notes: Option<String>,
  pub active: bool,
  pub scalable: bool,
  pub scalable_start_period_key: Option<String>,
  pub created_at: String,
  pub period_key: String,
  pub carry_over_cents: i64,
  pub planned_cents: i64,
  pub actual_cents: i64,
  pub remaining_cents: i64,
}

#[tauri::command]
pub fn list_budget_pools(state: State<'_, AppState>) -> CmdResult<Vec<BudgetPool>> {
  to_cmd_result(list_budget_pools_inner(state))
}

fn list_budget_pools_inner(state: State<'_, AppState>) -> AppResult<Vec<BudgetPool>> {
  let conn = state.conn.lock().unwrap();
  let main_id = get_main_account_id(&conn)?;
  let today = Utc::now().format("%Y-%m-%d").to_string();
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents, period_mode, COALESCE(account_id, ?1), icon, color, notes, COALESCE(active, 1), COALESCE(scalable, 0), scalable_start_period_key, created_at FROM budget_pools ORDER BY name ASC",
  )?;
  let rows = stmt
    .query_map(params![main_id], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, i64>(2)?,
        r.get::<_, String>(3)?,
        r.get::<_, String>(4)?,
        r.get::<_, String>(5)?,
        r.get::<_, String>(6)?,
        r.get::<_, Option<String>>(7)?,
        r.get::<_, i64>(8)?,
        r.get::<_, i64>(9)?,
        r.get::<_, Option<String>>(10)?,
        r.get::<_, String>(11)?,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;

  let mut out = Vec::new();
  for (
    id,
    name,
    amount_cents,
    period_mode,
    account_id,
    icon,
    color,
    notes,
    active,
    scalable,
    scalable_start_period_key,
    created_at,
  ) in rows
  {
    let scalable = scalable != 0;
    let start_period_key = budget_pool_start_period_key(
      &conn,
      &period_mode,
      scalable,
      scalable_start_period_key.as_deref(),
      &created_at,
    )?;
    let (period_key, carry_over_cents, planned_cents, actual_cents, remaining_cents) =
      budget_pool_current_period_stats(
        &conn,
        &id,
        amount_cents,
        &period_mode,
        scalable,
        &start_period_key,
        &today,
      )?;
    out.push(BudgetPool {
      id,
      name,
      amount_cents,
      period_mode,
      account_id,
      icon,
      color,
      notes,
      active: active != 0,
      scalable,
      scalable_start_period_key,
      created_at,
      period_key,
      carry_over_cents,
      planned_cents,
      actual_cents,
      remaining_cents,
    });
  }
  Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetPoolPeriodHistory {
  pub pool_id: String,
  pub pool_name: String,
  pub period_mode: String,
  pub scalable: bool,
  pub rows: Vec<BudgetPoolPeriodHistoryRow>,
}

#[tauri::command]
pub fn get_budget_pool_period_history(state: State<'_, AppState>, pool_id: String) -> CmdResult<BudgetPoolPeriodHistory> {
  to_cmd_result(get_budget_pool_period_history_inner(state, pool_id))
}

fn get_budget_pool_period_history_inner(state: State<'_, AppState>, pool_id: String) -> AppResult<BudgetPoolPeriodHistory> {
  let conn = state.conn.lock().unwrap();
  let today = Utc::now().format("%Y-%m-%d").to_string();
  let (name, amount_cents, period_mode, scalable, scalable_start_period_key, created_at): (
    String,
    i64,
    String,
    i64,
    Option<String>,
    String,
  ) = conn
    .query_row(
      "SELECT name, amount_cents, period_mode, COALESCE(scalable, 0), scalable_start_period_key, created_at FROM budget_pools WHERE id = ?1",
      params![pool_id],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    )
    .map_err(|_| AppError::Invalid("Budgetpool nicht gefunden".into()))?;
  let scalable = scalable != 0;
  let start_period_key = budget_pool_start_period_key(
    &conn,
    &period_mode,
    scalable,
    scalable_start_period_key.as_deref(),
    &created_at,
  )?;
  let rows = compute_budget_pool_period_history(
    &conn,
    &pool_id,
    amount_cents,
    &period_mode,
    scalable,
    &start_period_key,
    &today,
  )?;
  Ok(BudgetPoolPeriodHistory {
    pool_id,
    pool_name: name,
    period_mode,
    scalable,
    rows,
  })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBudgetPoolInput {
  pub name: String,
  pub amount_cents: i64,
  pub period_mode: String,
  pub account_id: Option<String>,
  pub notes: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
  pub scalable: Option<bool>,
  pub scalable_start_period_key: Option<String>,
}

#[tauri::command]
pub fn create_budget_pool(state: State<'_, AppState>, input: CreateBudgetPoolInput) -> CmdResult<String> {
  to_cmd_result(create_budget_pool_inner(state, input))
}

fn create_budget_pool_inner(state: State<'_, AppState>, input: CreateBudgetPoolInput) -> AppResult<String> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  if input.amount_cents <= 0 {
    return Err(AppError::Invalid("amount must be positive".into()));
  }
  if input.period_mode != "salary_period" && input.period_mode != "yearly" {
    return Err(AppError::Invalid("periodMode must be salary_period or yearly".into()));
  }
  let conn = state.conn.lock().unwrap();
  let account_id = input
    .account_id
    .filter(|s| !s.trim().is_empty())
    .unwrap_or_else(|| get_main_account_id(&conn).unwrap_or_default());
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let icon = normalize_icon(input.icon, "piggy-bank");
  let color = normalize_color(input.color, "#0ea5e9");
  let scalable = if input.scalable.unwrap_or(false) { 1 } else { 0 };
  let scalable_start_period_key: Option<String> = if scalable != 0 {
    Some(
      input
        .scalable_start_period_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::Invalid("Startzeitraum ist für skalierbare Budgetpools erforderlich".into()))?
        .to_string(),
    )
  } else {
    None
  };
  conn.execute(
    "INSERT INTO budget_pools (id, name, amount_cents, period_mode, account_id, icon, color, notes, active, scalable, scalable_start_period_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11)",
    params![
      id,
      input.name.trim(),
      input.amount_cents,
      input.period_mode,
      account_id,
      icon,
      color,
      input.notes,
      scalable,
      scalable_start_period_key,
      now
    ],
  )?;
  Ok(id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBudgetPoolInput {
  pub id: String,
  pub name: String,
  pub amount_cents: i64,
  pub period_mode: String,
  pub account_id: Option<String>,
  pub notes: Option<String>,
  pub active: bool,
  pub icon: Option<String>,
  pub color: Option<String>,
  pub scalable: Option<bool>,
  pub scalable_start_period_key: Option<String>,
}

#[tauri::command]
pub fn update_budget_pool(state: State<'_, AppState>, input: UpdateBudgetPoolInput) -> CmdResult<()> {
  to_cmd_result(update_budget_pool_inner(state, input))
}

fn update_budget_pool_inner(state: State<'_, AppState>, input: UpdateBudgetPoolInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  if input.amount_cents <= 0 {
    return Err(AppError::Invalid("amount must be positive".into()));
  }
  if input.period_mode != "salary_period" && input.period_mode != "yearly" {
    return Err(AppError::Invalid("periodMode must be salary_period or yearly".into()));
  }
  let conn = state.conn.lock().unwrap();
  let account_id = input
    .account_id
    .filter(|s| !s.trim().is_empty())
    .unwrap_or_else(|| get_main_account_id(&conn).unwrap_or_default());
  let icon = normalize_icon(input.icon, "piggy-bank");
  let color = normalize_color(input.color, "#0ea5e9");
  let scalable = if input.scalable.unwrap_or(false) { 1 } else { 0 };
  let scalable_start_period_key: Option<String> = if scalable != 0 {
    Some(
      input
        .scalable_start_period_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::Invalid("Startzeitraum ist für skalierbare Budgetpools erforderlich".into()))?
        .to_string(),
    )
  } else {
    None
  };
  let updated = conn.execute(
    "UPDATE budget_pools SET name = ?2, amount_cents = ?3, period_mode = ?4, account_id = ?5, icon = ?6, color = ?7, notes = ?8, active = ?9, scalable = ?10, scalable_start_period_key = ?11 WHERE id = ?1",
    params![
      input.id,
      input.name.trim(),
      input.amount_cents,
      input.period_mode,
      account_id,
      icon,
      color,
      input.notes,
      if input.active { 1 } else { 0 },
      scalable,
      scalable_start_period_key,
    ],
  )?;
  if updated == 0 {
    return Err(AppError::Invalid("Budgetpool nicht gefunden".into()));
  }
  Ok(())
}

#[tauri::command]
pub fn delete_budget_pool(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_budget_pool_inner(state, id))
}

fn delete_budget_pool_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  let assigned: i64 = conn.query_row(
    "SELECT COUNT(*) FROM ledger_budget_pool_splits WHERE budget_pool_id = ?1",
    params![id],
    |r| r.get(0),
  )?;
  if assigned > 0 {
    return Err(AppError::Invalid(
      "Budgetpool ist Buchungen zugeordnet und kann nicht gelöscht werden.".into(),
    ));
  }
  conn.execute("DELETE FROM budget_pools WHERE id = ?1", params![id])?;
  Ok(())
}
