use crate::db::{app_db_path, ensure_default_account_and_migrate_legacy, migrate, open_db};
use crate::error::AppResult;
use crate::news_cache;
use crate::portfolio_cache::{self, StockPortfolioCache};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::AppHandle;

pub struct AppState {
  pub conn: Mutex<Connection>,
  pub stock_portfolio_cache: Mutex<StockPortfolioCache>,
  pub news_cache: Mutex<news_cache::NewsCache>,
}

impl AppState {
  pub fn init(app: &AppHandle) -> AppResult<Self> {
    let db_path = app_db_path(app)?;
    let conn = open_db(&db_path)?;
    migrate(&conn)?;
    ensure_default_account_and_migrate_legacy(&conn)?;
    let stock_portfolio_cache = Mutex::new(StockPortfolioCache::default());
    portfolio_cache::load_from_db(&conn, &stock_portfolio_cache)?;
    let news_cache = Mutex::new(news_cache::NewsCache::default());
    news_cache::load_from_db(&conn, &news_cache)?;
    Ok(Self {
      conn: Mutex::new(conn),
      stock_portfolio_cache,
      news_cache,
    })
  }
}