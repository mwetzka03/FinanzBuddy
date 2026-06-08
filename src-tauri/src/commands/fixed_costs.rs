use super::helpers::{to_cmd_result, CmdResult};
use crate::accounts::get_main_account_id;
use crate::error::{AppError, AppResult};
use crate::logic::generate_occurrences_with_due_rule_rp;
use crate::models::FixedCost;
use crate::state::AppState;
use chrono::{Datelike, Utc};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

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
  let allowed_due = ["calendar_day", "first_business_day", "last_business_day"];
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
