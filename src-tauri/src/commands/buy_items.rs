use super::helpers::{normalize_color, normalize_icon, to_cmd_result, CmdResult};
use crate::accounts::get_main_account_id;
use crate::error::{AppError, AppResult};
use chrono::Utc;
use crate::models::{BuyItem, BuyItemGroup};
use crate::state::AppState;
use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

fn map_buy_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<BuyItem> {
  let id_str: String = r.get(0)?;
  let id = Uuid::parse_str(id_str.as_str())
    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
  let group_raw: Option<String> = r.get(9)?;
  let group_id = group_raw
    .as_deref()
    .map(Uuid::parse_str)
    .transpose()
    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
  let created_raw: String = r.get(10)?;
  let created_at = chrono::DateTime::parse_from_rfc3339(created_raw.as_str())
    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?
    .with_timezone(&Utc);
  Ok(BuyItem {
    id,
    name: r.get(1)?,
    description: r.get(2)?,
    amount_cents: r.get(3)?,
    status: r.get(4)?,
    applied_date: r.get(5)?,
    planned_month: r.get(6)?,
    icon: r.get::<_, Option<String>>(7)?.unwrap_or_else(|| "shop".into()),
    color: r.get::<_, Option<String>>(8)?.unwrap_or_else(|| "#ec4899".into()),
    group_id,
    created_at,
  })
}

fn map_buy_item_group(r: &rusqlite::Row<'_>) -> rusqlite::Result<BuyItemGroup> {
  let id_str: String = r.get(0)?;
  let id = Uuid::parse_str(id_str.as_str())
    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
  let created_raw: String = r.get(6)?;
  let created_at = chrono::DateTime::parse_from_rfc3339(created_raw.as_str())
    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?
    .with_timezone(&Utc);
  Ok(BuyItemGroup {
    id,
    name: r.get(1)?,
    description: r.get(2)?,
    planned_month: r.get(3)?,
    icon: r.get::<_, Option<String>>(4)?.unwrap_or_else(|| "shop".into()),
    color: r.get::<_, Option<String>>(5)?.unwrap_or_else(|| "#ec4899".into()),
    created_at,
  })
}

#[tauri::command]
pub fn list_buy_items(state: State<'_, AppState>) -> CmdResult<Vec<BuyItem>> {
  to_cmd_result(list_buy_items_inner(state))
}

fn list_buy_items_inner(state: State<'_, AppState>) -> AppResult<Vec<BuyItem>> {
  let conn = state.conn.lock().unwrap();
  let mut stmt = conn.prepare(
    "SELECT id, name, description, amount_cents, status, applied_date, planned_month, icon, color, group_id, created_at FROM buy_items ORDER BY created_at DESC",
  )?;
  let rows = stmt
    .query_map([], map_buy_item)?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

#[tauri::command]
pub fn list_buy_item_groups(state: State<'_, AppState>) -> CmdResult<Vec<BuyItemGroup>> {
  to_cmd_result(list_buy_item_groups_inner(state))
}

fn list_buy_item_groups_inner(state: State<'_, AppState>) -> AppResult<Vec<BuyItemGroup>> {
  let conn = state.conn.lock().unwrap();
  let mut stmt = conn.prepare(
    "SELECT id, name, description, planned_month, icon, color, created_at FROM buy_item_groups ORDER BY created_at DESC",
  )?;
  let rows = stmt
    .query_map([], map_buy_item_group)?
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
  pub group_id: Option<String>,
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
  let group_id = input
    .group_id
    .as_deref()
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .map(str::to_string);
  if let Some(ref gid) = group_id {
    let exists: i64 = conn.query_row(
      "SELECT COUNT(*) FROM buy_item_groups WHERE id = ?1",
      params![gid],
      |r| r.get(0),
    )?;
    if exists == 0 {
      return Err(AppError::Invalid("group not found".into()));
    }
  }
  conn.execute(
    "INSERT INTO buy_items (id, name, description, amount_cents, status, applied_date, planned_month, icon, color, group_id, created_at) VALUES (?1, ?2, ?3, ?4, 'parked', NULL, ?5, ?6, ?7, ?8, ?9)",
    params![id, input.name, input.description, input.amount_cents, input.planned_month, icon, color, group_id, now],
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
  pub group_id: Option<String>,
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
  let group_id = input
    .group_id
    .as_deref()
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .map(str::to_string);
  if let Some(ref gid) = group_id {
    let exists: i64 = conn.query_row(
      "SELECT COUNT(*) FROM buy_item_groups WHERE id = ?1",
      params![gid],
      |r| r.get(0),
    )?;
    if exists == 0 {
      return Err(AppError::Invalid("group not found".into()));
    }
  }
  conn.execute(
    "UPDATE buy_items SET name=?2, description=?3, amount_cents=?4, planned_month=?5, icon=?6, color=?7, group_id=?8 WHERE id=?1 AND status='parked'",
    params![input.id, input.name, input.description, input.amount_cents, input.planned_month, icon, color, group_id],
  )?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBuyItemGroupInput {
  pub name: String,
  pub description: Option<String>,
  pub planned_month: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
  pub item_ids: Option<Vec<String>>,
}

#[tauri::command]
pub fn create_buy_item_group(state: State<'_, AppState>, input: CreateBuyItemGroupInput) -> CmdResult<String> {
  to_cmd_result(create_buy_item_group_inner(state, input))
}

fn create_buy_item_group_inner(state: State<'_, AppState>, input: CreateBuyItemGroupInput) -> AppResult<String> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let conn = state.conn.lock().unwrap();
  let icon = normalize_icon(input.icon, "shop");
  let color = normalize_color(input.color, "#ec4899");
  conn.execute(
    "INSERT INTO buy_item_groups (id, name, description, planned_month, icon, color, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    params![id, input.name, input.description, input.planned_month, icon, color, now],
  )?;
  if let Some(item_ids) = input.item_ids {
    assign_items_to_group(&conn, &id, &item_ids)?;
  }
  Ok(id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBuyItemGroupInput {
  pub id: String,
  pub name: String,
  pub description: Option<String>,
  pub planned_month: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
  pub item_ids: Option<Vec<String>>,
}

#[tauri::command]
pub fn update_buy_item_group(state: State<'_, AppState>, input: UpdateBuyItemGroupInput) -> CmdResult<()> {
  to_cmd_result(update_buy_item_group_inner(state, input))
}

fn update_buy_item_group_inner(state: State<'_, AppState>, input: UpdateBuyItemGroupInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  let conn = state.conn.lock().unwrap();
  let icon = normalize_icon(input.icon, "shop");
  let color = normalize_color(input.color, "#ec4899");
  conn.execute(
    "UPDATE buy_item_groups SET name=?2, description=?3, planned_month=?4, icon=?5, color=?6 WHERE id=?1",
    params![input.id, input.name, input.description, input.planned_month, icon, color],
  )?;
  if let Some(item_ids) = input.item_ids {
    conn.execute("UPDATE buy_items SET group_id = NULL WHERE group_id = ?1", params![input.id])?;
    assign_items_to_group(&conn, &input.id, &item_ids)?;
  }
  Ok(())
}

fn assign_items_to_group(conn: &rusqlite::Connection, group_id: &str, item_ids: &[String]) -> AppResult<()> {
  for item_id in item_ids {
    let updated = conn.execute(
      "UPDATE buy_items SET group_id = ?1 WHERE id = ?2 AND status = 'parked'",
      params![group_id, item_id],
    )?;
    if updated == 0 {
      return Err(AppError::Invalid(format!("item {item_id} not found or already booked")));
    }
  }
  Ok(())
}

#[tauri::command]
pub fn delete_buy_item_group(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_buy_item_group_inner(state, id))
}

fn delete_buy_item_group_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  conn.execute("UPDATE buy_items SET group_id = NULL WHERE group_id = ?1", params![id])?;
  conn.execute("DELETE FROM buy_item_groups WHERE id = ?1", params![id])?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyBuyItemInput {
  pub id: String,
  pub ledger_transaction_id: Option<String>,
}

#[tauri::command]
pub fn apply_buy_item(state: State<'_, AppState>, input: ApplyBuyItemInput) -> CmdResult<()> {
  to_cmd_result(apply_buy_item_inner(state, input))
}

fn apply_buy_prognosis(conn: &rusqlite::Connection, item_id: &str, main_id: &str) -> AppResult<()> {
  let applied_date = Utc::now().date_naive().format("%Y-%m-%d").to_string();
  let (name, amount_cents, icon, color): (String, i64, String, String) = conn.query_row(
    "SELECT name, amount_cents, icon, color FROM buy_items WHERE id = ?1",
    params![item_id],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
  )?;
  conn.execute(
    "UPDATE buy_items SET status='applied', applied_date=?2 WHERE id=?1",
    params![item_id, applied_date],
  )?;
  let tx_id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let icon = normalize_icon(Some(icon), "shop");
  let color = normalize_color(Some(color), "#ec4899");
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, buy_item_id, icon, color, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'buy_apply', ?5, NULL, ?6, ?7, ?8, ?9, ?10)",
    params![tx_id, applied_date, -amount_cents, main_id, name, item_id, item_id, icon, color, now],
  )?;
  Ok(())
}

fn apply_buy_item_inner(state: State<'_, AppState>, input: ApplyBuyItemInput) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  if let Some(ref ledger_id) = input
    .ledger_transaction_id
    .as_ref()
    .map(|s| s.trim())
    .filter(|s| !s.is_empty())
  {
    crate::buy_assignment::apply_buy_item_assignment(&conn, ledger_id, Some(input.id.as_str()))?;
    return Ok(());
  }
  let main_id = get_main_account_id(&conn)?;
  apply_buy_prognosis(&conn, &input.id, &main_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyBuyItemGroupInput {
  pub group_id: String,
  pub ledger_transaction_id: Option<String>,
}

#[tauri::command]
pub fn apply_buy_item_group(state: State<'_, AppState>, input: ApplyBuyItemGroupInput) -> CmdResult<()> {
  to_cmd_result(apply_buy_item_group_inner(state, input))
}

fn apply_buy_item_group_inner(state: State<'_, AppState>, input: ApplyBuyItemGroupInput) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  if let Some(ref ledger_id) = input
    .ledger_transaction_id
    .as_ref()
    .map(|s| s.trim())
    .filter(|s| !s.is_empty())
  {
    let tx_total: i64 = conn.query_row(
      "SELECT ABS(amount_cents) FROM ledger_transactions WHERE id = ?1",
      params![ledger_id],
      |r| r.get(0),
    )?;
    let splits = crate::buy_group_assignment::build_full_group_splits(&conn, &input.group_id, tx_total)?;
    crate::buy_group_assignment::apply_buy_group_assignment(
      &conn,
      ledger_id,
      Some(input.group_id.as_str()),
      Some(&splits),
    )?;
    return Ok(());
  }
  let main_id = get_main_account_id(&conn)?;
  let member_ids: Vec<String> = conn
    .prepare("SELECT id FROM buy_items WHERE group_id = ?1 AND status = 'parked'")?
    .query_map(params![input.group_id], |r| r.get(0))?
    .collect::<Result<Vec<_>, _>>()?;
  for item_id in member_ids {
    apply_buy_prognosis(&conn, &item_id, &main_id)?;
  }
  Ok(())
}

#[tauri::command]
pub fn unapply_buy_item(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(unapply_buy_item_inner(state, id))
}

fn unapply_buy_item_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "UPDATE ledger_transactions SET buy_item_id = NULL WHERE buy_item_id = ?1",
    params![id],
  )?;
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
