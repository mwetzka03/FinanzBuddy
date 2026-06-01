use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::stocks;
use rusqlite::{params, OptionalExtension};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub const REFRESH_INTERVAL: Duration = Duration::from_secs(10 * 60);

const SETTINGS_KEY_CENTS: &str = "stock_portfolio_total_cents";
const SETTINGS_KEY_UPDATED_AT: &str = "stock_portfolio_updated_at";

#[derive(Debug, Default)]
pub struct StockPortfolioCache {
  pub total_cents: Option<i64>,
}

pub fn load_from_db(conn: &rusqlite::Connection, cache: &Mutex<StockPortfolioCache>) -> AppResult<()> {
  let cents: Option<String> = conn
    .query_row(
      "SELECT value FROM app_settings WHERE key = ?1",
      params![SETTINGS_KEY_CENTS],
      |r| r.get(0),
    )
    .optional()?;
  if let Some(raw) = cents {
    if let Ok(parsed) = raw.parse::<i64>() {
      cache.lock().unwrap().total_cents = Some(parsed);
    }
  }
  Ok(())
}

fn save_to_db(conn: &rusqlite::Connection, cents: i64) -> AppResult<()> {
  let now = chrono::Utc::now().to_rfc3339();
  conn.execute(
    "INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params![SETTINGS_KEY_CENTS, cents.to_string()],
  )?;
  conn.execute(
    "INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params![SETTINGS_KEY_UPDATED_AT, now],
  )?;
  Ok(())
}

pub fn cached_total_cents(state: &AppState) -> Option<i64> {
  state.stock_portfolio_cache.lock().unwrap().total_cents
}

fn any_stock_portfolio_account(conn: &rusqlite::Connection) -> AppResult<bool> {
  let n: i64 = conn.query_row(
    "SELECT COUNT(*) FROM accounts WHERE balance_source = 'stock_portfolio'",
    [],
    |r| r.get(0),
  )?;
  Ok(n > 0)
}

pub fn refresh_now(state: &AppState) -> AppResult<()> {
  let linked = {
    let conn = state.conn.lock().unwrap();
    any_stock_portfolio_account(&conn)?
  };
  if !linked {
    return Ok(());
  }

  let cents = stocks::fetch_portfolio_total_cents(state)?;
  {
    let conn = state.conn.lock().unwrap();
    save_to_db(&conn, cents)?;
  }
  state.stock_portfolio_cache.lock().unwrap().total_cents = Some(cents);
  Ok(())
}

pub fn spawn_refresh_loop(app: AppHandle) {
  std::thread::spawn(move || {
    if let Err(e) = refresh_once(&app) {
      eprintln!("Depot-Saldo: Start-Abgleich fehlgeschlagen: {e}");
    }
    loop {
      std::thread::sleep(REFRESH_INTERVAL);
      if let Err(e) = refresh_once(&app) {
        eprintln!("Depot-Saldo: Auto-Abgleich fehlgeschlagen: {e}");
      }
    }
  });
}

pub fn spawn_refresh_async(app: AppHandle) {
  std::thread::spawn(move || {
    if let Err(e) = refresh_once(&app) {
      eprintln!("Depot-Saldo: Hintergrund-Abgleich fehlgeschlagen: {e}");
    }
  });
}

fn refresh_once(app: &AppHandle) -> AppResult<()> {
  let state = app
    .try_state::<AppState>()
    .ok_or_else(|| AppError::Invalid("AppState nicht verfügbar".into()))?;
  refresh_now(&state)
}
