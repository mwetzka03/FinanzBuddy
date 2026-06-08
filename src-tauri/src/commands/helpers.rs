pub(crate) type CmdResult<T> = Result<T, String>;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use chrono::NaiveDate;
use rusqlite::params;

pub(crate) fn to_cmd_result<T>(res: AppResult<T>) -> CmdResult<T> {
  res.map_err(|e| e.to_string())
}

pub(crate) fn default_icon_for_kind(kind: &str) -> &'static str {
  match kind {
    "income" => "banknote",
    "expense" | "buy_apply" | "buy_planned" => "shop",
    "transfer" => "wallet",
    "fixed_cost" => "calendar",
    "adjustment" => "target",
    "forecast" => "trending",
    _ => "target",
  }
}

pub(crate) fn default_color_for_kind(kind: &str) -> &'static str {
  match kind {
    "income" => "#10b981",
    "expense" | "buy_apply" | "buy_planned" => "#ec4899",
    "transfer" => "#6366f1",
    "fixed_cost" => "#8b5cf6",
    "adjustment" => "#64748b",
    "forecast" => "#3b82f6",
    _ => "#6366f1",
  }
}

pub(crate) fn normalize_icon(icon: Option<String>, fallback: &str) -> String {
  icon.filter(|s| !s.trim().is_empty())
    .unwrap_or_else(|| fallback.to_string())
}

pub(crate) fn normalize_color(color: Option<String>, fallback: &str) -> String {
  color.filter(|s| !s.trim().is_empty())
    .unwrap_or_else(|| fallback.to_string())
}

pub(crate) fn account_liquid_map(conn: &rusqlite::Connection) -> AppResult<std::collections::HashMap<String, bool>> {
  let mut map = std::collections::HashMap::new();
  let mut stmt = conn.prepare("SELECT id, is_liquid FROM accounts")?;
  let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)))?;
  for row in rows {
    let (id, is_liquid) = row?;
    map.insert(id, is_liquid);
  }
  Ok(map)
}

pub(crate) fn account_name_map(conn: &rusqlite::Connection) -> AppResult<std::collections::HashMap<String, String>> {
  let mut map = std::collections::HashMap::new();
  let mut stmt = conn.prepare("SELECT id, name FROM accounts")?;
  let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
  for row in rows {
    let (id, name) = row?;
    map.insert(id, name);
  }
  Ok(map)
}

pub(crate) fn account_name_of(map: &std::collections::HashMap<String, String>, id: &str) -> String {
  map.get(id).cloned().unwrap_or_else(|| "Unbekannt".into())
}

pub(crate) fn account_filter_scope(
  conn: &rusqlite::Connection,
  account_filter: &Option<String>,
) -> AppResult<Option<crate::accounts::AccountFilterScope>> {
  match account_filter {
    None => Ok(None),
    Some(id) => Ok(Some(crate::accounts::resolve_account_filter_scope(conn, id)?)),
  }
}

pub(crate) fn event_matches_account(
  scope: &Option<crate::accounts::AccountFilterScope>,
  main_id: &str,
  event_account_id: Option<&str>,
) -> bool {
  crate::accounts::scope_matches_account(scope, main_id, event_account_id)
}

pub(crate) fn forecasts_apply(account_filter: &Option<String>, main_id: &str) -> bool {
  match account_filter {
    None => true,
    Some(aid) => aid == main_id,
  }
}
pub(crate) fn month_from_date(date: &str) -> AppResult<String> {
  if date.len() < 7 {
    return Err(AppError::Invalid("date must be YYYY-MM-DD".into()));
  }
  Ok(date[..7].to_string())
}
pub(crate) fn account_balance_source(conn: &rusqlite::Connection, account_id: &str) -> AppResult<String> {
  conn
    .query_row(
      "SELECT COALESCE(balance_source, 'ledger') FROM accounts WHERE id = ?1",
      params![account_id],
      |r| r.get(0),
    )
    .map_err(Into::into)
}

pub(crate) fn needs_stock_portfolio_value(
  conn: &rusqlite::Connection,
  account_filter: &Option<String>,
) -> AppResult<bool> {
  match account_filter {
    None => {
      let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM accounts WHERE balance_source = 'stock_portfolio'",
        [],
        |r| r.get(0),
      )?;
      Ok(n > 0)
    }
    Some(id) => Ok(account_balance_source(conn, id)? == "stock_portfolio"),
  }
}

pub(crate) fn cached_stock_portfolio_cents_if_needed(
  state: &AppState,
  conn: &rusqlite::Connection,
  account_filter: &Option<String>,
) -> AppResult<Option<i64>> {
  if !needs_stock_portfolio_value(conn, account_filter)? {
    return Ok(None);
  }
  match account_filter {
    Some(id) => Ok(Some(crate::stocks::portfolio_balance_cents_for_dashboard(
      conn,
      state,
      id.as_str(),
    )?)),
    None => Ok(crate::portfolio_cache::cached_total_cents(state)),
  }
}

pub(crate) fn iso_date(d: NaiveDate) -> String {
  d.format("%Y-%m-%d").to_string()
}
