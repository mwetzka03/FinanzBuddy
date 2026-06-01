use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn app_db_path(app: &AppHandle) -> AppResult<PathBuf> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
  std::fs::create_dir_all(&base)?;
  let new_path = base.join("finanzbuddy.sqlite3");
  let legacy_path = base.join("finanzhelfer.sqlite3");
  if !new_path.exists() && legacy_path.exists() {
    std::fs::rename(&legacy_path, &new_path)?;
  }
  Ok(new_path)
}

pub fn open_db(path: &PathBuf) -> AppResult<Connection> {
  let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
    | OpenFlags::SQLITE_OPEN_CREATE
    | OpenFlags::SQLITE_OPEN_FULL_MUTEX;
  Ok(Connection::open_with_flags(path, flags)?)
}

pub fn migrate(conn: &Connection) -> AppResult<()> {
  conn.execute_batch(
    r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  is_liquid INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  account_id TEXT,
  from_account_id TEXT,
  to_account_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balance_entries (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fixed_costs (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  cadence TEXT NOT NULL,
  first_charge_date TEXT NOT NULL,
  active INTEGER NOT NULL,
  notes TEXT,
  due_rule TEXT,
  day_of_month INTEGER,
  end_charge_date TEXT
);

CREATE TABLE IF NOT EXISTS buy_items (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  applied_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS income_forecasts (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  ledger_transaction_id TEXT
);

CREATE TABLE IF NOT EXISTS variable_costs (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  charge_day INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS variable_cost_actuals (
  variable_cost_id TEXT NOT NULL,
  month TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  ledger_transaction_id TEXT,
  PRIMARY KEY (variable_cost_id, month)
);

CREATE TABLE IF NOT EXISTS expense_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_group_lines (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS debt_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS debt_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  contact_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  direction TEXT NOT NULL,
  title TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS income_forecast_actuals (
  income_forecast_id TEXT NOT NULL,
  occurrence_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  ledger_transaction_id TEXT,
  PRIMARY KEY (income_forecast_id, occurrence_date)
);

CREATE TABLE IF NOT EXISTS stock_holdings (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  buy_date TEXT NOT NULL,
  buy_price_cents INTEGER NOT NULL,
  shares REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_lots (
  id TEXT PRIMARY KEY NOT NULL,
  holding_id TEXT NOT NULL,
  buy_date TEXT NOT NULL,
  buy_price_cents INTEGER NOT NULL,
  shares REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (holding_id) REFERENCES stock_holdings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_stock_lots_holding ON stock_lots(holding_id);
"#,
  )?;

  // Backfill columns for older DBs (CREATE TABLE IF NOT EXISTS won't alter existing).
  try_add_column(conn, "fixed_costs", "due_rule", "TEXT")?;
  try_add_column(conn, "fixed_costs", "day_of_month", "INTEGER")?;
  try_add_column(conn, "fixed_costs", "end_charge_date", "TEXT")?;
  try_add_column(conn, "buy_items", "planned_month", "TEXT")?;
  try_add_column(conn, "income_forecasts", "date", "TEXT")?;
  try_add_column(conn, "income_forecasts", "name", "TEXT")?;
  try_add_column(conn, "income_forecasts", "ledger_transaction_id", "TEXT")?;
  migrate_income_forecasts_v2(conn)?;
  migrate_income_forecasts_v3(conn)?;
  migrate_income_forecasts_v4(conn)?;
  try_add_column(conn, "variable_costs", "charge_day", "INTEGER")?;
  try_add_column(conn, "variable_costs", "date", "TEXT")?;
  conn.execute(
    "UPDATE variable_costs SET charge_day = CAST(substr(date, 9, 2) AS INTEGER) WHERE charge_day IS NULL AND date IS NOT NULL",
    [],
  )?;
  conn.execute(
    "UPDATE variable_costs SET charge_day = 1 WHERE charge_day IS NULL",
    [],
  )?;
  conn.execute(
    "UPDATE fixed_costs SET due_rule = COALESCE(due_rule, 'calendar_day')",
    [],
  )?;
  conn.execute(
    "UPDATE fixed_costs SET day_of_month = CAST(substr(first_charge_date, 9, 2) AS INTEGER) WHERE due_rule = 'calendar_day' AND day_of_month IS NULL",
    [],
  )?;
  conn.execute(
    "UPDATE fixed_costs SET day_of_month = CAST(substr(first_charge_date, 9, 2) AS INTEGER) WHERE due_rule = 'calendar_day' AND day_of_month = 1 AND CAST(substr(first_charge_date, 9, 2) AS INTEGER) != 1",
    [],
  )?;

  migrate_stock_lots(conn)?;
  migrate_stock_accounts(conn)?;
  migrate_stock_lot_transfers(conn)?;
  migrate_pre_tracking_income_to_adjustments(conn)?;
  migrate_adjustments_to_absolute_balance(conn)?;
  crate::accounts::migrate_main_account_setting(conn)?;
  migrate_remove_depot_ledger_entries(conn)?;
  try_add_column(conn, "accounts", "balance_source", "TEXT")?;
  conn.execute(
    "UPDATE accounts SET balance_source = 'ledger' WHERE balance_source IS NULL",
    [],
  )?;
  conn.execute(
    "UPDATE accounts SET balance_source = 'stock_portfolio' WHERE name = 'TradeRepublic ETFs & Aktien' AND balance_source = 'ledger'",
    [],
  )?;
  try_add_column(conn, "fixed_costs", "account_id", "TEXT")?;
  conn.execute(
    "UPDATE fixed_costs SET account_id = (
      SELECT id FROM accounts WHERE name = 'Hauptkonto' ORDER BY created_at ASC LIMIT 1
    ) WHERE account_id IS NULL",
    [],
  )?;
  conn.execute(
    "UPDATE fixed_costs SET account_id = (
      SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1
    ) WHERE account_id IS NULL",
    [],
  )?;
  try_add_column(conn, "ledger_transactions", "variable_cost_id", "TEXT")?;
  try_add_column(conn, "variable_cost_actuals", "actual_source", "TEXT")?;
  try_add_column(conn, "variable_costs", "icon", "TEXT")?;
  try_add_column(conn, "variable_costs", "color", "TEXT")?;
  try_add_column(conn, "buy_items", "icon", "TEXT")?;
  try_add_column(conn, "buy_items", "color", "TEXT")?;
  try_add_column(conn, "ledger_transactions", "icon", "TEXT")?;
  try_add_column(conn, "ledger_transactions", "color", "TEXT")?;
  conn.execute("UPDATE variable_costs SET icon = 'wallet' WHERE icon IS NULL OR icon = ''", [])?;
  conn.execute("UPDATE variable_costs SET color = '#6366f1' WHERE color IS NULL OR color = ''", [])?;
  conn.execute("UPDATE buy_items SET icon = 'shop' WHERE icon IS NULL OR icon = ''", [])?;
  conn.execute("UPDATE buy_items SET color = '#ec4899' WHERE color IS NULL OR color = ''", [])?;
  conn.execute("UPDATE ledger_transactions SET icon = 'banknote' WHERE icon IS NULL OR icon = '' AND kind = 'income'", [])?;
  conn.execute("UPDATE ledger_transactions SET icon = 'shop' WHERE icon IS NULL OR icon = '' AND kind IN ('expense', 'buy_apply', 'buy_planned')", [])?;
  conn.execute("UPDATE ledger_transactions SET icon = 'wallet' WHERE icon IS NULL OR icon = '' AND kind = 'transfer'", [])?;
  conn.execute("UPDATE ledger_transactions SET icon = 'calendar' WHERE icon IS NULL OR icon = '' AND kind = 'fixed_cost'", [])?;
  conn.execute("UPDATE ledger_transactions SET icon = 'target' WHERE icon IS NULL OR icon = ''", [])?;
  conn.execute("UPDATE ledger_transactions SET color = '#6366f1' WHERE color IS NULL OR color = ''", [])?;

  // Ensure settings exist
  conn.execute(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('holiday_state', 'RP')",
    [],
  )?;

  // Migrate income month -> date (legacy index removed in v2 migration)
  conn.execute("DROP INDEX IF EXISTS idx_income_forecasts_date", [])?;

  Ok(())
}

fn migrate_stock_lots(conn: &Connection) -> AppResult<()> {
  conn.execute_batch(
    r#"
CREATE TABLE IF NOT EXISTS stock_lots (
  id TEXT PRIMARY KEY NOT NULL,
  holding_id TEXT NOT NULL,
  buy_date TEXT NOT NULL,
  buy_price_cents INTEGER NOT NULL,
  shares REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (holding_id) REFERENCES stock_holdings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_stock_lots_holding ON stock_lots(holding_id);
"#,
  )?;

  let mut stmt = conn.prepare(
    "SELECT id, buy_date, buy_price_cents, shares, created_at FROM stock_holdings",
  )?;
  let rows = stmt
    .query_map([], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, i64>(2)?,
        r.get::<_, f64>(3)?,
        r.get::<_, String>(4)?,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;

  for (holding_id, buy_date, buy_price_cents, shares, created_at) in rows {
    let lot_count: i64 = conn.query_row(
      "SELECT COUNT(*) FROM stock_lots WHERE holding_id = ?1",
      rusqlite::params![holding_id],
      |r| r.get(0),
    )?;
    if lot_count > 0 {
      continue;
    }
    let lot_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
      "INSERT INTO stock_lots (id, holding_id, buy_date, buy_price_cents, shares, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      rusqlite::params![lot_id, holding_id, buy_date, buy_price_cents, shares, created_at],
    )?;
  }

  Ok(())
}

fn migrate_stock_accounts(conn: &Connection) -> AppResult<()> {
  try_add_column(conn, "stock_holdings", "depot_account_id", "TEXT")?;
  try_add_column(conn, "stock_lots", "payment_account_id", "TEXT")?;

  let default_depot: Option<String> = conn
    .query_row(
      "SELECT id FROM accounts WHERE balance_source = 'stock_portfolio' ORDER BY created_at ASC LIMIT 1",
      [],
      |r| r.get(0),
    )
    .optional()?;

  let default_payment: Option<String> = conn
    .query_row(
      "SELECT id FROM accounts WHERE name LIKE 'TradeRepublic%' ORDER BY created_at ASC LIMIT 1",
      [],
      |r| r.get(0),
    )
    .optional()?;

  if let Some(depot_id) = default_depot.as_deref() {
    conn.execute(
      "UPDATE stock_holdings SET depot_account_id = ?1 WHERE depot_account_id IS NULL",
      rusqlite::params![depot_id],
    )?;
  }
  if let Some(payment_id) = default_payment.as_deref() {
    conn.execute(
      "UPDATE stock_lots SET payment_account_id = ?1 WHERE payment_account_id IS NULL",
      rusqlite::params![payment_id],
    )?;
  }

  Ok(())
}

fn migrate_stock_lot_transfers(conn: &Connection) -> AppResult<()> {
  try_add_column(conn, "stock_lots", "is_transfer", "INTEGER NOT NULL DEFAULT 0")?;
  let done: Option<String> = conn
    .query_row(
      "SELECT value FROM app_settings WHERE key = 'stock_lot_transfers_v1'",
      [],
      |r| r.get(0),
    )
    .optional()?;
  if done.is_some() {
    return Ok(());
  }
  conn.execute("UPDATE stock_lots SET is_transfer = 1", [])?;
  conn.execute(
    "DELETE FROM ledger_transactions WHERE source_id LIKE 'stock_lot:%'",
    [],
  )?;
  conn.execute(
    "INSERT INTO app_settings (key, value) VALUES ('stock_lot_transfers_v1', '1')",
    [],
  )?;
  Ok(())
}

fn migrate_pre_tracking_income_to_adjustments(conn: &Connection) -> AppResult<()> {
  conn.execute(
    "UPDATE ledger_transactions SET kind = 'adjustment' WHERE kind = 'income' AND date < '2026-05-29'",
    [],
  )?;
  Ok(())
}

fn migrate_adjustments_to_absolute_balance(conn: &Connection) -> AppResult<()> {
  conn.execute(
    "UPDATE ledger_transactions SET amount_cents = ABS(amount_cents) WHERE kind = 'adjustment'",
    [],
  )?;
  Ok(())
}

fn migrate_remove_depot_ledger_entries(conn: &Connection) -> AppResult<()> {
  conn.execute(
    "DELETE FROM ledger_transactions
     WHERE account_id IN (SELECT id FROM accounts WHERE balance_source = 'stock_portfolio')",
    [],
  )?;
  Ok(())
}

pub fn ensure_default_account_and_migrate_legacy(conn: &Connection) -> AppResult<()> {
  // Create default account if none exist.
  let count: i64 = conn.query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))?;
  if count == 0 {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
      "INSERT INTO accounts (id, name, is_liquid, created_at) VALUES (?1, 'Hauptkonto', 1, ?2)",
      rusqlite::params![id, now],
    )?;
  }

  // If ledger is empty but legacy balance_entries exist, migrate latest balance entry to an adjustment.
  let ledger_count: i64 = conn.query_row("SELECT COUNT(*) FROM ledger_transactions", [], |r| r.get(0))?;
  if ledger_count > 0 {
    return Ok(());
  }

  let legacy: Option<(String, i64)> = conn
    .query_row(
      "SELECT date, amount_cents FROM balance_entries ORDER BY date DESC LIMIT 1",
      [],
      |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?;

  if let Some((date, amount_cents)) = legacy {
    let account_id: String = conn.query_row("SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1", [], |r| r.get(0))?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
      "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'adjustment', 'Startsaldo (migriert)', NULL, NULL, ?5)",
      rusqlite::params![id, date, amount_cents, account_id, now],
    )?;
  }

  Ok(())
}

fn migrate_income_forecasts_v2(conn: &Connection) -> AppResult<()> {
  let done: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM app_settings WHERE key = 'income_forecasts_v2'",
      [],
      |r| r.get(0),
    )
    .unwrap_or(0);
  if done > 0 {
    return Ok(());
  }

  let has_month: i64 = conn.query_row(
    "SELECT COUNT(*) FROM pragma_table_info('income_forecasts') WHERE name = 'month'",
    [],
    |r| r.get(0),
  )?;

  if has_month > 0 {
    conn.execute_batch(
      r#"
DROP INDEX IF EXISTS idx_income_forecasts_date;
CREATE TABLE income_forecasts_new (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  ledger_transaction_id TEXT
);
INSERT INTO income_forecasts_new (id, name, date, amount_cents, ledger_transaction_id)
SELECT id,
       '',
       COALESCE(date, month || '-01'),
       amount_cents,
       NULL
FROM income_forecasts;
DROP TABLE income_forecasts;
ALTER TABLE income_forecasts_new RENAME TO income_forecasts;
"#,
    )?;
  }

  conn.execute("DROP INDEX IF EXISTS idx_income_forecasts_date", [])?;
  conn.execute(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('income_forecasts_v2', '1')",
    [],
  )?;
  Ok(())
}

fn migrate_income_forecasts_v3(conn: &Connection) -> AppResult<()> {
  let done: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM app_settings WHERE key = 'income_forecasts_v3'",
      [],
      |r| r.get(0),
    )
    .unwrap_or(0);
  if done > 0 {
    return Ok(());
  }

  try_add_column(conn, "income_forecasts", "cadence", "TEXT")?;
  try_add_column(conn, "income_forecasts", "first_charge_date", "TEXT")?;
  try_add_column(conn, "income_forecasts", "due_rule", "TEXT")?;
  try_add_column(conn, "income_forecasts", "day_of_month", "INTEGER")?;
  try_add_column(conn, "income_forecasts", "end_charge_date", "TEXT")?;
  try_add_column(conn, "income_forecasts", "active", "INTEGER")?;

  conn.execute(
    "UPDATE income_forecasts SET
       first_charge_date = COALESCE(first_charge_date, date),
       cadence = COALESCE(cadence, 'monthly'),
       due_rule = COALESCE(due_rule, 'calendar_day'),
       day_of_month = COALESCE(day_of_month, CAST(substr(COALESCE(date, first_charge_date), 9, 2) AS INTEGER)),
       end_charge_date = COALESCE(end_charge_date, date),
       active = COALESCE(active, 1)",
    [],
  )?;

  conn.execute(
    "UPDATE ledger_transactions
     SET source_id = (
       SELECT 'income_forecast:' || id || ':' || date
       FROM income_forecasts
       WHERE income_forecasts.ledger_transaction_id = ledger_transactions.id
     )
     WHERE id IN (SELECT ledger_transaction_id FROM income_forecasts WHERE ledger_transaction_id IS NOT NULL)",
    [],
  )?;

  conn.execute(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('income_forecasts_v3', '1')",
    [],
  )?;
  Ok(())
}

fn migrate_income_forecasts_v4(conn: &Connection) -> AppResult<()> {
  let done: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM app_settings WHERE key = 'income_forecasts_v4'",
      [],
      |r| r.get(0),
    )
    .unwrap_or(0);
  if done > 0 {
    return Ok(());
  }
  conn.execute(
    "UPDATE income_forecasts SET cadence = 'once', end_charge_date = NULL WHERE end_charge_date = first_charge_date",
    [],
  )?;
  conn.execute(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('income_forecasts_v4', '1')",
    [],
  )?;
  Ok(())
}

fn try_add_column(conn: &Connection, table: &str, column: &str, ty: &str) -> AppResult<()> {
  let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {ty}");
  match conn.execute(&sql, []) {
    Ok(_) => Ok(()),
    Err(rusqlite::Error::SqliteFailure(_, Some(msg)))
      if msg.to_ascii_lowercase().contains("duplicate column") =>
    {
      Ok(())
    }
    Err(e) => Err(e.into()),
  }
}

