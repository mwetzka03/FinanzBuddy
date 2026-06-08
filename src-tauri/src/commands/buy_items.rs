use super::helpers::{normalize_color, normalize_icon, to_cmd_result, CmdResult};
use crate::accounts::get_main_account_id;
use crate::error::{AppError, AppResult};
use chrono::Utc;
use crate::models::BuyItem;
use crate::state::AppState;
use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

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
