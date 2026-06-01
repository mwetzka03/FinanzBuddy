use crate::error::{AppError, AppResult};
use rusqlite::{params, OptionalExtension};

const MAIN_ACCOUNT_SETTINGS_KEY: &str = "main_account_id";

pub fn get_main_account_id(conn: &rusqlite::Connection) -> AppResult<String> {
  if let Some(id) = conn
    .query_row(
      "SELECT value FROM app_settings WHERE key = ?1",
      params![MAIN_ACCOUNT_SETTINGS_KEY],
      |r| r.get::<_, String>(0),
    )
    .optional()?
  {
    let id = id.trim();
    if !id.is_empty() {
      let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM accounts WHERE id = ?1",
        params![id],
        |r| r.get(0),
      )?;
      if exists > 0 {
        return Ok(id.to_string());
      }
    }
  }

  if let Ok(id) = conn.query_row(
    "SELECT id FROM accounts WHERE name = 'Hauptkonto' ORDER BY created_at ASC LIMIT 1",
    [],
    |r| r.get::<_, String>(0),
  ) {
    return Ok(id);
  }

  conn
    .query_row(
      "SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1",
      [],
      |r| r.get(0),
    )
    .map_err(Into::into)
}

pub fn set_main_account_id(conn: &rusqlite::Connection, account_id: &str) -> AppResult<()> {
  let source: String = conn.query_row(
    "SELECT COALESCE(balance_source, 'ledger') FROM accounts WHERE id = ?1",
    params![account_id],
    |r| r.get(0),
  )?;
  if source == "stock_portfolio" {
    return Err(AppError::Invalid(
      "Aktien-Depot kann nicht Hauptkonto sein".into(),
    ));
  }
  conn.execute(
    "INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params![MAIN_ACCOUNT_SETTINGS_KEY, account_id],
  )?;
  Ok(())
}

pub fn get_trade_republic_account_id(conn: &rusqlite::Connection) -> AppResult<String> {
  conn
    .query_row(
      "SELECT id FROM accounts WHERE name LIKE 'TradeRepublic%' ORDER BY created_at ASC LIMIT 1",
      [],
      |r| r.get(0),
    )
    .map_err(|_| AppError::Invalid("Konto TradeRepublic nicht gefunden".into()))
}

pub fn migrate_main_account_setting(conn: &rusqlite::Connection) -> AppResult<()> {
  let existing: Option<String> = conn
    .query_row(
      "SELECT value FROM app_settings WHERE key = ?1",
      params![MAIN_ACCOUNT_SETTINGS_KEY],
      |r| r.get(0),
    )
    .optional()?;
  if existing.is_some() {
    return Ok(());
  }
  if let Ok(id) = conn.query_row(
    "SELECT id FROM accounts WHERE name = 'Hauptkonto' ORDER BY created_at ASC LIMIT 1",
    [],
    |r| r.get::<_, String>(0),
  ) {
    set_main_account_id(conn, &id)?;
  }
  Ok(())
}
