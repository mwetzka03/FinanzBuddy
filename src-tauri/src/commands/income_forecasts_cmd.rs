use super::forecast_income::materialize_due_income_forecasts;
use super::helpers::{normalize_color, normalize_icon, to_cmd_result, CmdResult};
use chrono::{Datelike, Utc};
use rusqlite::OptionalExtension;
use crate::accounts::get_main_account_id;
use crate::error::{AppError, AppResult};
use crate::income_actuals::clear_all_actuals_for_forecast;
use crate::logic::generate_occurrences_with_due_rule_rp;
use crate::models::IncomeForecast;
use crate::state::AppState;
use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn list_income_forecasts(state: State<'_, AppState>) -> CmdResult<Vec<IncomeForecast>> {
  to_cmd_result(list_income_forecasts_inner(state))
}

fn list_income_forecasts_inner(state: State<'_, AppState>) -> AppResult<Vec<IncomeForecast>> {
  let conn = state.conn.lock().unwrap();
  materialize_due_income_forecasts(&conn)?;
  let main_id = get_main_account_id(&conn)?;
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents, cadence, first_charge_date, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date, COALESCE(active,1), COALESCE(account_id, ?1), COALESCE(icon, 'banknote'), COALESCE(color, '#10b981')
     FROM income_forecasts ORDER BY first_charge_date DESC, name ASC",
  )?;
  let rows = stmt
    .query_map(params![main_id], |r| {
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
        account_id: r.get(9)?,
        icon: r.get(10)?,
        color: r.get(11)?,
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
  pub icon: Option<String>,
  pub color: Option<String>,
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
  let icon = normalize_icon(input.icon, "banknote");
  let color = normalize_color(input.color, "#10b981");
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "INSERT INTO income_forecasts (id, name, amount_cents, date, cadence, first_charge_date, due_rule, day_of_month, end_charge_date, active, ledger_transaction_id, icon, color)
     VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, 1, NULL, ?9, ?10)",
    params![
      id,
      input.name.trim(),
      input.amount_cents,
      input.first_charge_date,
      input.cadence,
      input.due_rule,
      day_of_month,
      input.end_charge_date.filter(|s| !s.is_empty()),
      icon,
      color,
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
  pub icon: Option<String>,
  pub color: Option<String>,
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
  let icon_param = input.icon.map(|i| normalize_icon(Some(i), "banknote"));
  let color_param = input.color.map(|c| normalize_color(Some(c), "#10b981"));
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "UPDATE income_forecasts SET name = ?2, amount_cents = ?3, date = ?4, cadence = ?5, first_charge_date = ?4, due_rule = ?6, day_of_month = ?7, end_charge_date = ?8, active = ?9, icon = COALESCE(?10, icon), color = COALESCE(?11, color) WHERE id = ?1",
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
      icon_param,
      color_param,
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
