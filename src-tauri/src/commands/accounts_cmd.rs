use super::helpers::{to_cmd_result, CmdResult};
use crate::error::{AppError, AppResult};
use crate::models::Account;
use crate::state::AppState;
use chrono::Utc;
use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

// ---- Accounts ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccountInput {
  pub name: String,
  pub is_liquid: bool,
  pub account_kind: Option<String>,
  pub parent_account_id: Option<String>,
  pub iban: Option<String>,
  pub balance_source: Option<String>,
}

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> CmdResult<Vec<Account>> {
  to_cmd_result(list_accounts_inner(state))
}

fn list_accounts_inner(state: State<'_, AppState>) -> AppResult<Vec<Account>> {
  let conn = state.conn.lock().unwrap();
  let main_id = crate::accounts::get_main_account_id(&conn)?;
  let mut stmt = conn.prepare(
    "SELECT id, name, is_liquid, COALESCE(balance_source, 'ledger'), COALESCE(account_kind, 'standard'), parent_account_id, iban, created_at FROM accounts ORDER BY name ASC",
  )?;
  let rows = stmt
    .query_map([], |r| {
      let id_str: String = r.get(0)?;
      let parent_raw: Option<String> = r.get(5)?;
      let balance_source: String = r.get(3)?;
      let raw_kind: String = r.get(4)?;
      let account_kind = crate::accounts::effective_account_kind(&raw_kind, &balance_source);
      Ok((
        Uuid::parse_str(id_str.as_str()).unwrap(),
        r.get::<_, String>(1)?,
        r.get::<_, i64>(2)? != 0,
        balance_source,
        account_kind,
        parent_raw.and_then(|p| Uuid::parse_str(p.as_str()).ok()),
        r.get::<_, Option<String>>(6)?,
        chrono::DateTime::parse_from_rfc3339(r.get::<_, String>(7)?.as_str())
          .unwrap()
          .with_timezone(&Utc),
        id_str,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(
    rows
      .into_iter()
      .map(|(id, name, is_liquid, balance_source, account_kind, parent_account_id, iban, created_at, id_str)| {
        Account {
          id,
          name,
          is_liquid,
          balance_source,
          account_kind,
          parent_account_id,
          iban,
          is_main: id_str == main_id,
          created_at,
        }
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
  let account_kind = input
    .account_kind
    .as_deref()
    .unwrap_or("standard")
    .trim()
    .to_string();
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "INSERT INTO accounts (id, name, is_liquid, balance_source, account_kind, parent_account_id, iban, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    params![
      id,
      input.name,
      if input.is_liquid { 1 } else { 0 },
      balance_source,
      account_kind,
      input.parent_account_id,
      input.iban,
      now
    ],
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

