use crate::error::{AppError, AppResult};
use crate::models::{
  DebtContactDetail, DebtContactSummary, DebtSummary, DebtTransaction, ExpenseGroupDetail,
  ExpenseGroupLine, ExpenseGroupSummary,
};
use crate::state::AppState;
use chrono::{DateTime, Utc};
use rusqlite::params;
use rusqlite::OptionalExtension;
use tauri::State;
use uuid::Uuid;

type CmdResult<T> = Result<T, String>;

fn to_cmd_result<T>(r: AppResult<T>) -> CmdResult<T> {
  r.map_err(|e| e.to_string())
}

fn parse_group_summary(
  id: String,
  name: String,
  date: Option<String>,
  notes: Option<String>,
  total_cents: i64,
  line_count: i64,
  created_at: String,
) -> ExpenseGroupSummary {
  ExpenseGroupSummary {
    id: Uuid::parse_str(&id).unwrap(),
    name,
    date,
    notes,
    total_cents,
    line_count,
    created_at: DateTime::parse_from_rfc3339(created_at.as_str())
      .map(|d| d.with_timezone(&Utc))
      .unwrap_or_else(|_| Utc::now()),
  }
}

// ---- Expense groups ----

#[tauri::command]
pub fn list_expense_groups(state: State<'_, AppState>) -> CmdResult<Vec<ExpenseGroupSummary>> {
  to_cmd_result(list_expense_groups_inner(state))
}

fn list_expense_groups_inner(state: State<'_, AppState>) -> AppResult<Vec<ExpenseGroupSummary>> {
  let conn = state.conn.lock().unwrap();
  let mut stmt = conn.prepare(
    "SELECT g.id, g.name, g.date, g.notes, g.created_at,
            COALESCE((SELECT SUM(amount_cents) FROM expense_group_lines WHERE group_id = g.id), 0),
            COALESCE((SELECT COUNT(*) FROM expense_group_lines WHERE group_id = g.id), 0)
     FROM expense_groups g ORDER BY COALESCE(g.date, g.created_at) DESC, g.name ASC",
  )?;
  let rows = stmt
    .query_map([], |r| {
      Ok(parse_group_summary(
        r.get(0)?,
        r.get(1)?,
        r.get(2)?,
        r.get(3)?,
        r.get(5)?,
        r.get(6)?,
        r.get(4)?,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

#[tauri::command]
pub fn get_expense_group(state: State<'_, AppState>, id: String) -> CmdResult<ExpenseGroupDetail> {
  to_cmd_result(get_expense_group_inner(state, id))
}

fn get_expense_group_inner(state: State<'_, AppState>, id: String) -> AppResult<ExpenseGroupDetail> {
  let conn = state.conn.lock().unwrap();
  let row: Option<(String, String, Option<String>, Option<String>, String)> = conn
    .query_row(
      "SELECT id, name, date, notes, created_at FROM expense_groups WHERE id = ?1",
      params![id],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )
    .optional()?;
  let (gid, name, date, notes, created_at) = row.ok_or_else(|| AppError::Invalid("group not found".into()))?;

  let total: i64 = conn.query_row(
    "SELECT COALESCE(SUM(amount_cents),0) FROM expense_group_lines WHERE group_id = ?1",
    params![gid],
    |r| r.get(0),
  )?;
  let count: i64 = conn.query_row(
    "SELECT COUNT(*) FROM expense_group_lines WHERE group_id = ?1",
    params![gid],
    |r| r.get(0),
  )?;

  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents FROM expense_group_lines WHERE group_id = ?1 ORDER BY sort_order ASC, name ASC",
  )?;
  let lines = stmt
    .query_map(params![gid], |r| {
      Ok(ExpenseGroupLine {
        id: Uuid::parse_str(r.get::<_, String>(0)?.as_str()).unwrap(),
        name: r.get(1)?,
        amount_cents: r.get(2)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;

  Ok(ExpenseGroupDetail {
    group: parse_group_summary(gid, name, date, notes, total, count, created_at),
    lines,
  })
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateExpenseGroupInput {
  pub name: String,
  pub date: Option<String>,
  pub notes: Option<String>,
  pub lines: Vec<ExpenseGroupLineInput>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseGroupLineInput {
  pub name: String,
  pub amount_cents: i64,
}

#[tauri::command]
pub fn create_expense_group(state: State<'_, AppState>, input: CreateExpenseGroupInput) -> CmdResult<String> {
  to_cmd_result(create_expense_group_inner(state, input))
}

fn create_expense_group_inner(state: State<'_, AppState>, input: CreateExpenseGroupInput) -> AppResult<String> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  if input.lines.is_empty() {
    return Err(AppError::Invalid("at least one line required".into()));
  }
  if let Some(ref d) = input.date {
    if !d.is_empty() && crate::models::parse_iso_date(d).is_none() {
      return Err(AppError::Invalid("date must be YYYY-MM-DD".into()));
    }
  }
  for line in &input.lines {
    if line.name.trim().is_empty() {
      return Err(AppError::Invalid("line name required".into()));
    }
    if line.amount_cents <= 0 {
      return Err(AppError::Invalid("line amount must be positive".into()));
    }
  }
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "INSERT INTO expense_groups (id, name, date, notes, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    params![id, input.name.trim(), input.date.filter(|s| !s.is_empty()), input.notes, now],
  )?;
  for (idx, line) in input.lines.iter().enumerate() {
    let lid = Uuid::new_v4().to_string();
    conn.execute(
      "INSERT INTO expense_group_lines (id, group_id, name, amount_cents, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
      params![lid, id, line.name.trim(), line.amount_cents, idx as i64],
    )?;
  }
  Ok(id)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateExpenseGroupInput {
  pub id: String,
  pub name: String,
  pub date: Option<String>,
  pub notes: Option<String>,
  pub lines: Vec<UpdateExpenseGroupLineInput>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateExpenseGroupLineInput {
  pub id: Option<String>,
  pub name: String,
  pub amount_cents: i64,
}

#[tauri::command]
pub fn update_expense_group(state: State<'_, AppState>, input: UpdateExpenseGroupInput) -> CmdResult<()> {
  to_cmd_result(update_expense_group_inner(state, input))
}

fn update_expense_group_inner(state: State<'_, AppState>, input: UpdateExpenseGroupInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  if input.lines.is_empty() {
    return Err(AppError::Invalid("at least one line required".into()));
  }
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "UPDATE expense_groups SET name = ?2, date = ?3, notes = ?4 WHERE id = ?1",
    params![input.id, input.name.trim(), input.date.filter(|s| !s.is_empty()), input.notes],
  )?;
  conn.execute("DELETE FROM expense_group_lines WHERE group_id = ?1", params![input.id])?;
  for (idx, line) in input.lines.iter().enumerate() {
    if line.name.trim().is_empty() || line.amount_cents <= 0 {
      return Err(AppError::Invalid("invalid line".into()));
    }
    let lid = line.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    conn.execute(
      "INSERT INTO expense_group_lines (id, group_id, name, amount_cents, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
      params![lid, input.id, line.name.trim(), line.amount_cents, idx as i64],
    )?;
  }
  Ok(())
}

#[tauri::command]
pub fn delete_expense_group(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_expense_group_inner(state, id))
}

fn delete_expense_group_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  conn.execute("DELETE FROM expense_group_lines WHERE group_id = ?1", params![id])?;
  conn.execute("DELETE FROM expense_groups WHERE id = ?1", params![id])?;
  Ok(())
}

// ---- Debts ----

fn debt_contact_summary_from_row(
  id: String,
  name: String,
  notes: Option<String>,
  created_at: String,
  conn: &rusqlite::Connection,
) -> AppResult<DebtContactSummary> {
  let owed: i64 = conn.query_row(
    "SELECT COALESCE(SUM(amount_cents),0) FROM debt_transactions WHERE contact_id = ?1 AND direction = 'owed_to_me'",
    params![id],
    |r| r.get(0),
  )?;
  let owe: i64 = conn.query_row(
    "SELECT COALESCE(SUM(amount_cents),0) FROM debt_transactions WHERE contact_id = ?1 AND direction = 'i_owe'",
    params![id],
    |r| r.get(0),
  )?;
  Ok(DebtContactSummary {
    id: Uuid::parse_str(&id).unwrap(),
    name,
    notes,
    owed_to_me_cents: owed,
    i_owe_cents: owe,
    created_at: DateTime::parse_from_rfc3339(created_at.as_str())
      .map(|d| d.with_timezone(&Utc))
      .unwrap_or_else(|_| Utc::now()),
  })
}

#[tauri::command]
pub fn list_debt_contacts(state: State<'_, AppState>) -> CmdResult<Vec<DebtContactSummary>> {
  to_cmd_result(list_debt_contacts_inner(state))
}

fn list_debt_contacts_inner(state: State<'_, AppState>) -> AppResult<Vec<DebtContactSummary>> {
  let conn = state.conn.lock().unwrap();
  let mut stmt = conn.prepare("SELECT id, name, notes, created_at FROM debt_contacts ORDER BY name ASC")?;
  let ids: Vec<(String, String, Option<String>, String)> = stmt
    .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
    .collect::<Result<Vec<_>, _>>()?;
  let mut out = Vec::new();
  for (id, name, notes, created_at) in ids {
    out.push(debt_contact_summary_from_row(id, name, notes, created_at, &conn)?);
  }
  Ok(out)
}

#[tauri::command]
pub fn get_debt_contact(state: State<'_, AppState>, id: String) -> CmdResult<DebtContactDetail> {
  to_cmd_result(get_debt_contact_inner(state, id))
}

fn get_debt_contact_inner(state: State<'_, AppState>, id: String) -> AppResult<DebtContactDetail> {
  let conn = state.conn.lock().unwrap();
  let row: Option<(String, String, Option<String>, String)> = conn
    .query_row(
      "SELECT id, name, notes, created_at FROM debt_contacts WHERE id = ?1",
      params![id],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .optional()?;
  let (cid, name, notes, created_at) = row.ok_or_else(|| AppError::Invalid("contact not found".into()))?;
  let contact = debt_contact_summary_from_row(cid.clone(), name, notes, created_at, &conn)?;

  let mut stmt = conn.prepare(
    "SELECT id, contact_id, date, amount_cents, direction, title, notes, created_at FROM debt_transactions WHERE contact_id = ?1 ORDER BY date DESC, created_at DESC",
  )?;
  let transactions = stmt
    .query_map(params![cid], |r| {
      Ok(DebtTransaction {
        id: Uuid::parse_str(r.get::<_, String>(0)?.as_str()).unwrap(),
        contact_id: Uuid::parse_str(r.get::<_, String>(1)?.as_str()).unwrap(),
        date: r.get(2)?,
        amount_cents: r.get(3)?,
        direction: r.get(4)?,
        title: r.get(5)?,
        notes: r.get(6)?,
        created_at: DateTime::parse_from_rfc3339(r.get::<_, String>(7)?.as_str())
          .map(|d| d.with_timezone(&Utc))
          .unwrap_or_else(|_| Utc::now()),
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;

  Ok(DebtContactDetail { contact, transactions })
}

#[tauri::command]
pub fn get_debt_summary(state: State<'_, AppState>) -> CmdResult<DebtSummary> {
  to_cmd_result(get_debt_summary_inner(state))
}

fn get_debt_summary_inner(state: State<'_, AppState>) -> AppResult<DebtSummary> {
  let conn = state.conn.lock().unwrap();
  let owed: i64 = conn.query_row(
    "SELECT COALESCE(SUM(amount_cents),0) FROM debt_transactions WHERE direction = 'owed_to_me'",
    [],
    |r| r.get(0),
  )?;
  let owe: i64 = conn.query_row(
    "SELECT COALESCE(SUM(amount_cents),0) FROM debt_transactions WHERE direction = 'i_owe'",
    [],
    |r| r.get(0),
  )?;
  Ok(DebtSummary {
    owed_to_me_cents: owed,
    i_owe_cents: owe,
  })
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDebtContactInput {
  pub name: String,
  pub notes: Option<String>,
}

#[tauri::command]
pub fn create_debt_contact(state: State<'_, AppState>, input: CreateDebtContactInput) -> CmdResult<String> {
  to_cmd_result(create_debt_contact_inner(state, input))
}

fn create_debt_contact_inner(state: State<'_, AppState>, input: CreateDebtContactInput) -> AppResult<String> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "INSERT INTO debt_contacts (id, name, notes, created_at) VALUES (?1, ?2, ?3, ?4)",
    params![id, input.name.trim(), input.notes, now],
  )?;
  Ok(id)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDebtContactInput {
  pub id: String,
  pub name: String,
  pub notes: Option<String>,
}

#[tauri::command]
pub fn update_debt_contact(state: State<'_, AppState>, input: UpdateDebtContactInput) -> CmdResult<()> {
  to_cmd_result(update_debt_contact_inner(state, input))
}

fn update_debt_contact_inner(state: State<'_, AppState>, input: UpdateDebtContactInput) -> AppResult<()> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "UPDATE debt_contacts SET name = ?2, notes = ?3 WHERE id = ?1",
    params![input.id, input.name.trim(), input.notes],
  )?;
  Ok(())
}

#[tauri::command]
pub fn delete_debt_contact(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_debt_contact_inner(state, id))
}

fn delete_debt_contact_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  conn.execute("DELETE FROM debt_transactions WHERE contact_id = ?1", params![id])?;
  conn.execute("DELETE FROM debt_contacts WHERE id = ?1", params![id])?;
  Ok(())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDebtTransactionInput {
  pub contact_id: String,
  pub date: String,
  pub amount_cents: i64,
  pub direction: String,
  pub title: Option<String>,
  pub notes: Option<String>,
}

#[tauri::command]
pub fn create_debt_transaction(state: State<'_, AppState>, input: CreateDebtTransactionInput) -> CmdResult<()> {
  to_cmd_result(create_debt_transaction_inner(state, input))
}

fn create_debt_transaction_inner(state: State<'_, AppState>, input: CreateDebtTransactionInput) -> AppResult<()> {
  if crate::models::parse_iso_date(&input.date).is_none() {
    return Err(AppError::Invalid("date must be YYYY-MM-DD".into()));
  }
  if input.amount_cents <= 0 {
    return Err(AppError::Invalid("amount must be positive".into()));
  }
  if input.direction != "owed_to_me" && input.direction != "i_owe" {
    return Err(AppError::Invalid("direction invalid".into()));
  }
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "INSERT INTO debt_transactions (id, contact_id, date, amount_cents, direction, title, notes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    params![id, input.contact_id, input.date, input.amount_cents, input.direction, input.title, input.notes, now],
  )?;
  Ok(())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDebtTransactionInput {
  pub id: String,
  pub date: String,
  pub amount_cents: i64,
  pub direction: String,
  pub title: Option<String>,
  pub notes: Option<String>,
}

#[tauri::command]
pub fn update_debt_transaction(state: State<'_, AppState>, input: UpdateDebtTransactionInput) -> CmdResult<()> {
  to_cmd_result(update_debt_transaction_inner(state, input))
}

fn update_debt_transaction_inner(state: State<'_, AppState>, input: UpdateDebtTransactionInput) -> AppResult<()> {
  if crate::models::parse_iso_date(&input.date).is_none() {
    return Err(AppError::Invalid("date must be YYYY-MM-DD".into()));
  }
  if input.amount_cents <= 0 {
    return Err(AppError::Invalid("amount must be positive".into()));
  }
  if input.direction != "owed_to_me" && input.direction != "i_owe" {
    return Err(AppError::Invalid("direction invalid".into()));
  }
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "UPDATE debt_transactions SET date = ?2, amount_cents = ?3, direction = ?4, title = ?5, notes = ?6 WHERE id = ?1",
    params![input.id, input.date, input.amount_cents, input.direction, input.title, input.notes],
  )?;
  Ok(())
}

#[tauri::command]
pub fn delete_debt_transaction(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_debt_transaction_inner(state, id))
}

fn delete_debt_transaction_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  conn.execute("DELETE FROM debt_transactions WHERE id = ?1", params![id])?;
  Ok(())
}
