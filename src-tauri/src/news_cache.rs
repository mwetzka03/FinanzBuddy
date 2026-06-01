use crate::error::{AppError, AppResult};
use crate::models::NewsArticle;
use crate::news::{fetch_depot_news, fetch_market_news};
use crate::state::AppState;
use chrono::{DateTime, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub const REFRESH_INTERVAL: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsCacheEntry {
  pub depot: Vec<NewsArticle>,
  pub market: Vec<NewsArticle>,
  pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockNewsListResponse {
  pub depot_articles: Vec<NewsArticle>,
  pub market_articles: Vec<NewsArticle>,
  pub cached_at: Option<String>,
  pub refreshing: bool,
}

#[derive(Debug, Default)]
pub struct NewsCache {
  entries: HashMap<String, NewsCacheEntry>,
}

pub(crate) fn cache_key(depot_account_id: Option<&str>) -> String {
  depot_account_id.unwrap_or("all").to_string()
}

fn settings_key(depot_account_id: Option<&str>) -> String {
  format!("news_cache:{}", cache_key(depot_account_id))
}

pub fn load_from_db(conn: &rusqlite::Connection, cache: &Mutex<NewsCache>) -> AppResult<()> {
  let mut stmt = conn.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'news_cache:%'")?;
  let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
  let mut map = HashMap::new();
  for row in rows {
    let (key, value) = row?;
    let suffix = key.strip_prefix("news_cache:").unwrap_or(&key).to_string();
    if let Ok(entry) = serde_json::from_str::<NewsCacheEntry>(&value) {
      map.insert(suffix, entry);
    }
  }
  cache.lock().unwrap().entries = map;
  Ok(())
}

pub(crate) fn save_to_db(conn: &rusqlite::Connection, depot_account_id: Option<&str>, entry: &NewsCacheEntry) -> AppResult<()> {
  let key = settings_key(depot_account_id);
  let value = serde_json::to_string(entry).map_err(|e| AppError::Invalid(e.to_string()))?;
  conn.execute(
    "INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params![key, value],
  )?;
  Ok(())
}

fn is_stale(updated_at: &str) -> bool {
  let Ok(parsed) = DateTime::parse_from_rfc3339(updated_at) else {
    return true;
  };
  let age = Utc::now().signed_duration_since(parsed.with_timezone(&Utc));
  age > chrono::Duration::from_std(REFRESH_INTERVAL).unwrap_or(chrono::Duration::minutes(15))
}

pub fn list_cached(
  state: &AppState,
  depot_account_id: Option<String>,
) -> AppResult<(StockNewsListResponse, bool)> {
  let key = cache_key(depot_account_id.as_deref());
  let entry = state.news_cache.lock().unwrap().entries.get(&key).cloned();
  let needs_refresh = entry
    .as_ref()
    .map(|e| is_stale(&e.updated_at))
    .unwrap_or(true);

  let response = if let Some(entry) = entry {
    StockNewsListResponse {
      depot_articles: entry.depot,
      market_articles: entry.market,
      cached_at: Some(entry.updated_at),
      refreshing: needs_refresh,
    }
  } else {
    StockNewsListResponse {
      depot_articles: vec![],
      market_articles: vec![],
      cached_at: None,
      refreshing: true,
    }
  };

  Ok((response, needs_refresh))
}

pub fn find_article(state: &AppState, depot_account_id: Option<String>, id: &str) -> Option<NewsArticle> {
  let key = cache_key(depot_account_id.as_deref());
  let cache = state.news_cache.lock().unwrap();
  if let Some(entry) = cache.entries.get(&key) {
    if let Some(found) = entry
      .depot
      .iter()
      .chain(entry.market.iter())
      .find(|a| a.id == id)
    {
      return Some(found.clone());
    }
  }
  for entry in cache.entries.values() {
    if let Some(found) = entry
      .depot
      .iter()
      .chain(entry.market.iter())
      .find(|a| a.id == id)
    {
      return Some(found.clone());
    }
  }
  None
}

pub fn refresh_now(state: &AppState, depot_account_id: Option<String>) -> AppResult<NewsCacheEntry> {
  let conn = state.conn.lock().unwrap();
  let mut depot = fetch_depot_news(&conn, depot_account_id.as_deref())?;
  let mut market = fetch_market_news()?;
  let mut seen = std::collections::HashSet::new();
  depot.retain(|a| seen.insert(a.id.clone()));
  market.retain(|a| seen.insert(a.id.clone()));
  depot.sort_by(|a, b| b.published_at.cmp(&a.published_at));
  market.sort_by(|a, b| b.published_at.cmp(&a.published_at));

  let entry = NewsCacheEntry {
    depot,
    market,
    updated_at: Utc::now().to_rfc3339(),
  };

  save_to_db(&conn, depot_account_id.as_deref(), &entry)?;
  drop(conn);

  let key = cache_key(depot_account_id.as_deref());
  state.news_cache.lock().unwrap().entries.insert(key, entry.clone());
  Ok(entry)
}

pub fn spawn_refresh_async(app: AppHandle, depot_account_id: Option<String>) {
  std::thread::spawn(move || {
    if let Err(e) = refresh_once(&app, depot_account_id) {
      eprintln!("News: Hintergrund-Aktualisierung fehlgeschlagen: {e}");
    }
  });
}

pub fn spawn_refresh_loop(app: AppHandle) {
  std::thread::spawn(move || {
    loop {
      std::thread::sleep(REFRESH_INTERVAL);
      if let Err(e) = refresh_all_keys(&app) {
        eprintln!("News: Auto-Aktualisierung fehlgeschlagen: {e}");
      }
    }
  });
}

fn refresh_all_keys(app: &AppHandle) -> AppResult<()> {
  let state = app
    .try_state::<AppState>()
    .ok_or_else(|| AppError::Invalid("AppState nicht verfügbar".into()))?;
  let keys: Vec<String> = state.news_cache.lock().unwrap().entries.keys().cloned().collect();
  if keys.is_empty() {
    refresh_once(app, None)?;
    return Ok(());
  }
  for key in keys {
    let depot_id = if key == "all" { None } else { Some(key) };
    refresh_once(app, depot_id)?;
  }
  Ok(())
}

fn refresh_once(app: &AppHandle, depot_account_id: Option<String>) -> AppResult<()> {
  let state = app
    .try_state::<AppState>()
    .ok_or_else(|| AppError::Invalid("AppState nicht verfügbar".into()))?;
  refresh_now(&state, depot_account_id)?;
  Ok(())
}
