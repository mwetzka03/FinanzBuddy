use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::Path;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn to_cmd_result<T>(r: AppResult<T>) -> CmdResult<T> {
  r.map_err(|e| e.to_string())
}

const BACKUP_VERSION: u32 = 1;

const TABLE_NAMES: &[&str] = &[
  "app_settings",
  "accounts",
  "ledger_transactions",
  "balance_entries",
  "fixed_costs",
  "buy_items",
  "income_forecasts",
  "income_forecast_actuals",
  "variable_costs",
  "variable_cost_actuals",
  "expense_groups",
  "expense_group_lines",
  "debt_contacts",
  "debt_transactions",
  "stock_holdings",
  "stock_lots",
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataBackupResult {
  pub file_path: String,
  pub table_count: u32,
  pub row_count: u32,
  pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct DataBackupFile {
  version: u32,
  exported_at: String,
  tables: Map<String, Value>,
}

#[tauri::command]
pub fn export_user_data(state: State<'_, AppState>, file_path: String) -> CmdResult<DataBackupResult> {
  to_cmd_result(export_user_data_inner(state, file_path))
}

fn export_user_data_inner(state: State<'_, AppState>, file_path: String) -> AppResult<DataBackupResult> {
  if file_path.trim().is_empty() {
    return Err(AppError::Invalid("filePath required".into()));
  }
  let conn = state.conn.lock().unwrap();
  let mut tables = Map::new();
  let mut row_count = 0u32;
  for table in TABLE_NAMES {
    let rows = export_table(&conn, table)?;
    row_count += rows.len() as u32;
    tables.insert(table.to_string(), Value::Array(rows));
  }
  let backup = DataBackupFile {
    version: BACKUP_VERSION,
    exported_at: chrono::Utc::now().to_rfc3339(),
    tables,
  };
  let json = serde_json::to_string_pretty(&backup)
    .map_err(|e| AppError::Invalid(format!("Export serialisieren: {e}")))?;
  std::fs::write(&file_path, json).map_err(|e| AppError::Invalid(format!("Export speichern: {e}")))?;
  Ok(DataBackupResult {
    file_path: file_path.clone(),
    table_count: TABLE_NAMES.len() as u32,
    row_count,
    message: format!("{row_count} Datensätze nach {} exportiert.", file_path),
  })
}

#[tauri::command]
pub fn import_user_data(state: State<'_, AppState>, file_path: String) -> CmdResult<DataBackupResult> {
  to_cmd_result(import_user_data_inner(state, file_path))
}

fn import_user_data_inner(state: State<'_, AppState>, file_path: String) -> AppResult<DataBackupResult> {
  if file_path.trim().is_empty() {
    return Err(AppError::Invalid("filePath required".into()));
  }
  let path = Path::new(&file_path);
  if !path.exists() {
    return Err(AppError::Invalid("Datei nicht gefunden".into()));
  }
  let raw = std::fs::read_to_string(path).map_err(|e| AppError::Invalid(format!("Datei lesen: {e}")))?;
  let backup: DataBackupFile = serde_json::from_str(&raw)
    .map_err(|e| AppError::Invalid(format!("Backup ungültig: {e}")))?;
  if backup.version > BACKUP_VERSION {
    return Err(AppError::Invalid(
      "Backup stammt aus einer neueren App-Version.".into(),
    ));
  }
  let conn = state.conn.lock().unwrap();
  let tx = conn.unchecked_transaction()?;
  for table in TABLE_NAMES {
    tx.execute(&format!("DELETE FROM {table}"), [])?;
  }
  let mut row_count = 0u32;
  for table in TABLE_NAMES {
    let Some(Value::Array(rows)) = backup.tables.get(*table) else {
      continue;
    };
    for row in rows {
      if let Value::Object(obj) = row {
        insert_row(&tx, table, obj)?;
        row_count += 1;
      }
    }
  }
  tx.commit()?;
  drop(conn);
  let conn = state.conn.lock().unwrap();
  db::ensure_default_account_and_migrate_legacy(&conn)?;
  Ok(DataBackupResult {
    file_path: file_path.clone(),
    table_count: TABLE_NAMES.len() as u32,
    row_count,
    message: format!("{row_count} Datensätze aus {} importiert.", file_path),
  })
}

fn export_table(conn: &Connection, table: &str) -> AppResult<Vec<Value>> {
  let sql = format!("SELECT * FROM {table}");
  let mut stmt = conn.prepare(&sql)?;
  let col_count = stmt.column_count();
  let col_names: Vec<String> = (0..col_count)
    .map(|i| stmt.column_name(i).unwrap_or("").to_string())
    .collect();
  let rows = stmt
    .query_map([], |row| {
      let mut obj = Map::new();
      for (i, name) in col_names.iter().enumerate() {
        let value: Value = match row.get_ref(i)? {
          rusqlite::types::ValueRef::Null => Value::Null,
          rusqlite::types::ValueRef::Integer(v) => Value::from(v),
          rusqlite::types::ValueRef::Real(v) => {
            Value::from(serde_json::Number::from_f64(v).unwrap_or(serde_json::Number::from(0)))
          }
          rusqlite::types::ValueRef::Text(v) => {
            Value::String(String::from_utf8_lossy(v).into_owned())
          }
          rusqlite::types::ValueRef::Blob(v) => {
            Value::String(base64_encode(v))
          }
        };
        obj.insert(name.clone(), value);
      }
      Ok(Value::Object(obj))
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

fn insert_row(conn: &Connection, table: &str, row: &Map<String, Value>) -> AppResult<()> {
  if row.is_empty() {
    return Ok(());
  }
  let columns: Vec<&str> = row.keys().map(String::as_str).collect();
  let placeholders: Vec<String> = (1..=columns.len()).map(|i| format!("?{i}")).collect();
  let sql = format!(
    "INSERT INTO {table} ({}) VALUES ({})",
    columns.join(", "),
    placeholders.join(", ")
  );
  let values: Vec<rusqlite::types::Value> = columns.iter().map(|col| json_to_sql_value(&row[*col])).collect();
  let params: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
  conn.execute(&sql, params.as_slice())?;
  Ok(())
}

fn json_to_sql_value(value: &Value) -> rusqlite::types::Value {
  match value {
    Value::Null => rusqlite::types::Value::Null,
    Value::String(s) => rusqlite::types::Value::Text(s.clone()),
    Value::Number(n) => {
      if let Some(i) = n.as_i64() {
        rusqlite::types::Value::Integer(i)
      } else if let Some(f) = n.as_f64() {
        rusqlite::types::Value::Real(f)
      } else {
        rusqlite::types::Value::Text(n.to_string())
      }
    }
    Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
    other => rusqlite::types::Value::Text(other.to_string()),
  }
}

fn base64_encode(bytes: &[u8]) -> String {
  const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let mut out = String::new();
  for chunk in bytes.chunks(3) {
    let b0 = chunk[0] as u32;
    let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
    let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
    let triple = (b0 << 16) | (b1 << 8) | b2;
    out.push(TABLE[((triple >> 18) & 63) as usize] as char);
    out.push(TABLE[((triple >> 12) & 63) as usize] as char);
    out.push(if chunk.len() > 1 {
      TABLE[((triple >> 6) & 63) as usize] as char
    } else {
      '='
    });
    out.push(if chunk.len() > 2 {
      TABLE[(triple & 63) as usize] as char
    } else {
      '='
    });
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn roundtrip_json_value() {
    assert!(matches!(json_to_sql_value(&Value::from(42)), rusqlite::types::Value::Integer(42)));
  }
}
