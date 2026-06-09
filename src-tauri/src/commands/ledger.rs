use super::forecast_variable::{ledger_tx_is_categorizable, resync_variable_cost_months};
use super::forecast_income::materialize_due_income_forecasts;
use super::helpers::{
  account_balance_source, default_color_for_kind, default_icon_for_kind, normalize_color, normalize_icon,
  to_cmd_result, CmdResult,
};
use crate::buy_assignment::{apply_buy_item_assignment, clear_buy_assignment_for_transaction};
use crate::cost_assignment::{apply_expense_category_assignment, normalize_expense_category_ids};
use crate::error::{AppError, AppResult};
use crate::models::LedgerTransaction;
use crate::state::AppState;
use chrono::Utc;
use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

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
  pub fixed_cost_id: Option<String>,
  pub buy_item_id: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
  pub assign_similar_fixed_cost: Option<bool>,
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
    "SELECT id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, variable_cost_id, fixed_cost_id, buy_item_id, icon, color, created_at FROM ledger_transactions WHERE {} ORDER BY date DESC, created_at DESC",
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
        fixed_cost_id: r.get::<_, Option<String>>(11)?.map(|s| Uuid::parse_str(&s).unwrap()),
        buy_item_id: r.get::<_, Option<String>>(12)?.map(|s| Uuid::parse_str(&s).unwrap()),
        icon: r.get::<_, Option<String>>(13)?.unwrap_or_else(|| "target".into()),
        color: r.get::<_, Option<String>>(14)?.unwrap_or_else(|| "#6366f1".into()),
        created_at: chrono::DateTime::parse_from_rfc3339(r.get::<_, String>(15)?.as_str())
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

pub(crate) fn normalize_ledger_amount(kind: &str, amount_cents: i64) -> i64 {
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
  let (variable_cost_id, fixed_cost_id, buy_item_id) = normalize_expense_category_ids(
    &input.kind,
    input.variable_cost_id.clone(),
    input.fixed_cost_id.clone(),
    input.buy_item_id.clone(),
  )?;
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let conn = state.conn.lock().unwrap();
  if account_balance_source(&conn, &input.account_id)? == "stock_portfolio" {
    return Err(AppError::Invalid(
      "Aktiendepots können nicht manuell gebucht werden".into(),
    ));
  }
  let icon = normalize_icon(input.icon, default_icon_for_kind(&input.kind));
  let color = normalize_color(input.color, default_color_for_kind(&input.kind));
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, variable_cost_id, fixed_cost_id, buy_item_id, icon, color, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6, ?7, NULL, ?8, ?9, NULL, ?10, ?11, ?12)",
    params![
      id,
      input.date,
      amount_cents,
      input.account_id,
      input.kind,
      input.title,
      input.notes,
      variable_cost_id,
      fixed_cost_id,
      icon,
      color,
      now
    ],
  )?;
  if input.kind == "expense" {
    if variable_cost_id.is_some() || fixed_cost_id.is_some() {
      apply_expense_category_assignment(
        &conn,
        &id,
        variable_cost_id.as_deref(),
        fixed_cost_id.as_deref(),
        input.assign_similar_fixed_cost.unwrap_or(false),
      )?;
    }
    apply_buy_item_assignment(&conn, &id, buy_item_id.as_deref())?;
  } else {
    resync_variable_cost_months(&conn, variable_cost_id.as_deref(), Some(input.date.as_str()))?;
  }
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
  pub fixed_cost_id: Option<String>,
  pub buy_item_id: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
  pub assign_similar_fixed_cost: Option<bool>,
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
  let (old_date, old_vc_id, old_fc_id): (String, Option<String>, Option<String>) = conn.query_row(
    "SELECT date, variable_cost_id, fixed_cost_id FROM ledger_transactions WHERE id = ?1",
    params![input.id],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
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
  let (variable_cost_id, fixed_cost_id, buy_item_id) = normalize_expense_category_ids(
    &input.kind,
    input.variable_cost_id.clone(),
    input.fixed_cost_id.clone(),
    input.buy_item_id.clone(),
  )?;
  let icon = normalize_icon(input.icon, default_icon_for_kind(&input.kind));
  let color = normalize_color(input.color, default_color_for_kind(&input.kind));
  conn.execute(
    "UPDATE ledger_transactions SET date = ?2, amount_cents = ?3, title = ?4, kind = ?5, notes = ?6, icon = ?7, color = ?8 WHERE id = ?1",
    params![
      input.id,
      input.date,
      amount_cents,
      input.title,
      input.kind,
      input.notes,
      icon,
      color,
    ],
  )?;
  if input.kind == "expense" {
    if variable_cost_id.is_some() || fixed_cost_id.is_some() {
      apply_expense_category_assignment(
        &conn,
        &input.id,
        variable_cost_id.as_deref(),
        fixed_cost_id.as_deref(),
        input.assign_similar_fixed_cost.unwrap_or(false),
      )?;
    } else {
      conn.execute(
        "UPDATE ledger_transactions SET variable_cost_id = NULL, fixed_cost_id = NULL WHERE id = ?1",
        params![input.id],
      )?;
    }
    apply_buy_item_assignment(&conn, &input.id, buy_item_id.as_deref())?;
  } else {
    clear_buy_assignment_for_transaction(&conn, &input.id)?;
    conn.execute(
      "UPDATE ledger_transactions SET variable_cost_id = NULL, fixed_cost_id = NULL, buy_item_id = NULL WHERE id = ?1",
      params![input.id],
    )?;
    resync_variable_cost_months(&conn, old_vc_id.as_deref(), Some(old_date.as_str()))?;
  }
  let _ = old_fc_id;
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
  let (date, vc_id, buy_id): (String, Option<String>, Option<String>) = conn.query_row(
    "SELECT date, variable_cost_id, buy_item_id FROM ledger_transactions WHERE id = ?1",
    params![id],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
  )?;
  if let Some(ref bid) = buy_id {
    crate::buy_assignment::revert_buy_item(&conn, bid)?;
  }
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
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, internal_transfer, created_at) VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'transfer', ?6, ?7, NULL, 1, ?8)",
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
