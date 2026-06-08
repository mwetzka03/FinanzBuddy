use crate::accounts::{get_app_setting, set_app_setting};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};

pub const SETUP_COMPLETED_KEY: &str = "setup_completed";
pub const SETUP_MODE_KEY: &str = "setup_mode";

pub fn is_setup_completed(conn: &Connection) -> AppResult<bool> {
  Ok(get_app_setting(conn, SETUP_COMPLETED_KEY)?.as_deref() == Some("1"))
}

pub fn get_setup_mode(conn: &Connection) -> AppResult<Option<String>> {
  Ok(get_app_setting(conn, SETUP_MODE_KEY)?.filter(|s| !s.is_empty()))
}

pub fn complete_setup(conn: &Connection, mode: &str) -> AppResult<()> {
  if mode != "manual" && mode != "bank_import" {
    return Err(AppError::Invalid("setup mode invalid".into()));
  }
  set_app_setting(conn, SETUP_MODE_KEY, mode)?;
  set_app_setting(conn, SETUP_COMPLETED_KEY, "1")?;
  Ok(())
}

pub fn clear_setup_state(conn: &Connection) -> AppResult<()> {
  conn.execute(
    "DELETE FROM app_settings WHERE key IN (?1, ?2, ?3, ?4, ?5)",
    params![
      SETUP_COMPLETED_KEY,
      SETUP_MODE_KEY,
      crate::accounts::DASHBOARD_PERIOD_MODE_KEY,
      crate::accounts::IS_TIMEFRAME_MONTH_KEY,
      crate::accounts::INCOME_DATE_KEY,
    ],
  )?;
  crate::dashboard_cache::invalidate(conn)?;
  Ok(())
}

pub fn ensure_setup_migrated(conn: &Connection) -> AppResult<()> {
  if get_app_setting(conn, SETUP_COMPLETED_KEY)?.is_some() {
    return Ok(());
  }
  let ledger_count: i64 = conn.query_row(
    "SELECT COUNT(*) FROM ledger_transactions",
    [],
    |r| r.get(0),
  )?;
  if ledger_count > 0 {
    set_app_setting(conn, SETUP_COMPLETED_KEY, "1")?;
    if get_app_setting(conn, SETUP_MODE_KEY)?.is_none() {
      set_app_setting(conn, SETUP_MODE_KEY, "bank_import")?;
    }
  }
  Ok(())
}

pub fn assert_bank_import_allowed(conn: &Connection) -> AppResult<()> {
  if !is_setup_completed(conn)? {
    return Ok(());
  }
  if get_setup_mode(conn)?.as_deref() == Some("manual") {
    return Err(AppError::Invalid(
      "Bankimport ist bei manueller Einrichtung nicht verfügbar.".into(),
    ));
  }
  Ok(())
}

pub fn assert_period_mode_change_allowed(conn: &Connection) -> AppResult<()> {
  if is_setup_completed(conn)? {
    return Err(AppError::Invalid(
      "Der Dashboard-Zeitraum kann nach der Einrichtung nicht mehr geändert werden.".into(),
    ));
  }
  Ok(())
}

pub fn assert_setup_completed(conn: &Connection) -> AppResult<()> {
  if !is_setup_completed(conn)? {
    return Err(AppError::Invalid(
      "Dashboard-Berechnungen sind erst nach der Einrichtung verfügbar.".into(),
    ));
  }
  Ok(())
}
