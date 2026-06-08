use crate::error::{AppError, AppResult};
use crate::models::MonthView;
use rusqlite::{params, Connection, OptionalExtension};

const INVALIDATION_TABLES: &[&str] = &[
  "ledger_transactions",
  "fixed_costs",
  "buy_items",
  "income_forecasts",
  "income_forecast_actuals",
  "variable_costs",
  "variable_cost_actuals",
];

const INVALIDATION_EVENTS: &[&str] = &["insert", "update", "delete"];

pub fn ensure_schema(conn: &Connection) -> AppResult<()> {
  conn.execute_batch(
    r#"
CREATE TABLE IF NOT EXISTS dashboard_month_view_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  computed_at TEXT NOT NULL
);
"#,
  )?;

  for table in INVALIDATION_TABLES {
    for event in INVALIDATION_EVENTS {
      let trigger_name = format!("trg_invalidate_dashboard_cache_{table}_{event}");
      let sql = format!(
        "CREATE TRIGGER IF NOT EXISTS {trigger_name}
         AFTER {event} ON {table}
         BEGIN
           DELETE FROM dashboard_month_view_cache;
         END;"
      );
      conn.execute_batch(&sql)?;
    }
  }

  Ok(())
}

pub fn cache_key(month: &str, account_id: &Option<String>, period_start: &Option<String>) -> String {
  format!(
    "{}|{}|{}",
    month,
    account_id.as_deref().unwrap_or("_all_"),
    period_start.as_deref().unwrap_or("_none_")
  )
}

pub fn get(conn: &Connection, key: &str) -> AppResult<Option<MonthView>> {
  let json: Option<String> = conn
    .query_row(
      "SELECT payload_json FROM dashboard_month_view_cache WHERE cache_key = ?1",
      params![key],
      |r| r.get(0),
    )
    .optional()?;
  match json {
    Some(raw) => Ok(Some(
      serde_json::from_str(&raw).map_err(|e| AppError::Invalid(e.to_string()))?,
    )),
    None => Ok(None),
  }
}

pub fn put(conn: &Connection, key: &str, view: &MonthView) -> AppResult<()> {
  let json = serde_json::to_string(view).map_err(|e| AppError::Invalid(e.to_string()))?;
  let now = chrono::Utc::now().to_rfc3339();
  conn.execute(
    "INSERT INTO dashboard_month_view_cache (cache_key, payload_json, computed_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, computed_at = excluded.computed_at",
    params![key, json, now],
  )?;
  Ok(())
}

pub fn invalidate(conn: &Connection) -> AppResult<()> {
  conn.execute("DELETE FROM dashboard_month_view_cache", [])?;
  Ok(())
}
