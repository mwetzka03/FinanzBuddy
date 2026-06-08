use crate::error::{AppError, AppResult};

use rusqlite::{params, OptionalExtension};

use std::collections::HashMap;



const MAIN_ACCOUNT_SETTINGS_KEY: &str = "main_account_id";
pub const DASHBOARD_PERIOD_MODE_KEY: &str = "dashboard_period_mode";
pub const IS_TIMEFRAME_MONTH_KEY: &str = "is_timeframe_month";
pub const INCOME_DATE_KEY: &str = "income_date";
pub const PRIMARY_INCOME_FORECAST_ID_KEY: &str = "primary_income_forecast_id";
pub const PRIMARY_INCOME_EMPLOYER_IBAN_KEY: &str = "primary_income_employer_iban";
pub const PRIMARY_INCOME_ANCHOR_DATE_KEY: &str = "primary_income_anchor_date";



pub fn normalize_iban(raw: &str) -> Option<String> {

  let cleaned: String = raw.chars().filter(|c| !c.is_whitespace()).collect();

  if cleaned.len() < 8 {

    return None;

  }

  Some(cleaned.to_uppercase())

}



pub fn load_account_iban_map(conn: &rusqlite::Connection) -> AppResult<HashMap<String, String>> {

  let mut stmt = conn.prepare("SELECT id, iban FROM accounts WHERE iban IS NOT NULL AND TRIM(iban) != ''")?;

  let rows = stmt

    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?

    .collect::<Result<Vec<_>, _>>()?;

  let mut map = HashMap::new();

  for (id, iban) in rows {

    if let Some(normalized) = normalize_iban(&iban) {

      map.insert(normalized, id);

    }

  }

  Ok(map)

}



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



pub fn get_account_balance_source(conn: &rusqlite::Connection, account_id: &str) -> AppResult<String> {

  conn

    .query_row(

      "SELECT COALESCE(balance_source, 'ledger') FROM accounts WHERE id = ?1",

      params![account_id],

      |r| r.get(0),

    )

    .map_err(Into::into)

}



pub fn is_savings_pot_kind(kind: &str) -> bool {
  kind == "spartopf" || kind == "oberspartopf"
}

pub fn effective_account_kind(kind: &str, balance_source: &str) -> String {

  if balance_source == "stock_portfolio" || kind == "depot" {

    "depot".into()

  } else {

    kind.to_string()

  }

}



pub fn set_main_account_id(conn: &rusqlite::Connection, account_id: &str) -> AppResult<()> {

  let (source, kind): (String, String) = conn.query_row(

    "SELECT COALESCE(balance_source, 'ledger'), COALESCE(account_kind, 'standard') FROM accounts WHERE id = ?1",

    params![account_id],

    |r| Ok((r.get(0)?, r.get(1)?)),

  )?;

  let kind = effective_account_kind(&kind, &source);

  if kind == "depot" {

    return Err(AppError::Invalid(

      "Aktien-Depot kann nicht Hauptkonto sein".into(),

    ));

  }

  if kind != "standard" {

    return Err(AppError::Invalid(

      "Nur Standard-Girokonten können Hauptkonto sein.".into(),

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



pub fn migrate_depot_account_kind(conn: &rusqlite::Connection) -> AppResult<()> {

  conn.execute(

    "UPDATE accounts SET account_kind = 'depot' WHERE balance_source = 'stock_portfolio'",

    [],

  )?;

  Ok(())

}

#[derive(Debug, Clone)]
pub struct AccountFilterScope {
  pub member_ids: Vec<String>,
}

pub fn resolve_account_filter_scope(
  conn: &rusqlite::Connection,
  account_id: &str,
) -> AppResult<AccountFilterScope> {
  let kind: String = conn.query_row(
    "SELECT COALESCE(account_kind, 'standard') FROM accounts WHERE id = ?1",
    params![account_id],
    |r| r.get(0),
  )?;
  let member_ids = if kind == "oberspartopf" {
    let mut stmt = conn.prepare(
      "SELECT id FROM accounts WHERE parent_account_id = ?1 ORDER BY name ASC",
    )?;
    let children = stmt
      .query_map(params![account_id], |r| r.get::<_, String>(0))?
      .collect::<Result<Vec<_>, _>>()?;
    if children.is_empty() {
      vec![account_id.to_string()]
    } else {
      children
    }
  } else {
    vec![account_id.to_string()]
  };
  Ok(AccountFilterScope { member_ids })
}

pub fn scope_matches_account(
  scope: &Option<AccountFilterScope>,
  main_id: &str,
  event_account_id: Option<&str>,
) -> bool {
  match scope {
    None => true,
    Some(s) => match event_account_id {
      Some(aid) if !aid.is_empty() => s.member_ids.iter().any(|id| id == aid),
      _ => s.member_ids.iter().any(|id| id == main_id),
    },
  }
}

pub fn scope_contains(scope: &Option<AccountFilterScope>, account_id: &str) -> bool {
  match scope {
    None => true,
    Some(s) => s.member_ids.iter().any(|id| id == account_id),
  }
}

fn spartopf_name_match_keys(name: &str) -> Vec<String> {
  let lower = name.trim().to_lowercase();
  let mut keys = Vec::new();
  if lower.is_empty() {
    return keys;
  }
  keys.push(lower.clone());
  if let Some(stripped) = lower.strip_prefix("spartopf ") {
    keys.push(stripped.trim().to_string());
  }
  keys.sort_by(|a, b| b.len().cmp(&a.len()));
  keys.dedup();
  keys
}

pub fn match_spartopf_account_id(
  conn: &rusqlite::Connection,
  oberspartopf_id: &str,
  text: &str,
) -> AppResult<Option<String>> {
  let haystack = text.to_lowercase();
  if haystack.trim().is_empty() {
    return Ok(None);
  }
  let mut stmt = conn.prepare(
    "SELECT id, name FROM accounts WHERE parent_account_id = ?1 AND COALESCE(account_kind, 'standard') = 'spartopf' ORDER BY LENGTH(name) DESC",
  )?;
  let rows = stmt
    .query_map(params![oberspartopf_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
    .collect::<Result<Vec<_>, _>>()?;
  let mut best: Option<(usize, String)> = None;
  for (id, name) in rows {
    for key in spartopf_name_match_keys(&name) {
      if key.len() < 3 {
        continue;
      }
      let matched = haystack.contains(&key)
        || haystack.contains(&format!("//{key}"))
        || haystack.contains(&format!("/ {key}"));
      if matched {
        let score = key.len();
        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
          best = Some((score, id.clone()));
        }
      }
    }
  }
  Ok(best.map(|(_, id)| id))
}

pub fn resolve_transfer_target_account(
  conn: &rusqlite::Connection,
  counterparty_account_id: &str,
  text: &str,
) -> AppResult<String> {
  let kind: String = conn.query_row(
    "SELECT COALESCE(account_kind, 'standard') FROM accounts WHERE id = ?1",
    params![counterparty_account_id],
    |r| r.get(0),
  )?;
  if kind == "oberspartopf" {
    if let Some(child_id) = match_spartopf_account_id(conn, counterparty_account_id, text)? {
      return Ok(child_id);
    }
  }
  Ok(counterparty_account_id.to_string())
}

pub fn get_app_setting(conn: &rusqlite::Connection, key: &str) -> AppResult<Option<String>> {
  conn
    .query_row(
      "SELECT value FROM app_settings WHERE key = ?1",
      params![key],
      |r| r.get(0),
    )
    .optional()
    .map_err(Into::into)
}

pub fn set_app_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> AppResult<()> {
  conn.execute(
    "INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params![key, value],
  )?;
  Ok(())
}

pub fn ensure_timeframe_config_migrated(conn: &rusqlite::Connection) -> AppResult<()> {
  if get_app_setting(conn, IS_TIMEFRAME_MONTH_KEY)?.is_some() {
    return Ok(());
  }
  let mode = get_app_setting(conn, DASHBOARD_PERIOD_MODE_KEY)?
    .unwrap_or_else(|| "calendar_month".into());
  let is_month = mode == "calendar_month";
  let income_date = if is_month {
    0
  } else {
    derive_income_date_from_primary_forecast(conn)?
  };
  set_app_setting(
    conn,
    IS_TIMEFRAME_MONTH_KEY,
    if is_month { "1" } else { "0" },
  )?;
  set_app_setting(conn, INCOME_DATE_KEY, &income_date.to_string())?;
  Ok(())
}

fn derive_income_date_from_primary_forecast(conn: &rusqlite::Connection) -> AppResult<i32> {
  if let Some(id) = get_primary_income_forecast_id(conn)? {
    let row: Option<(String, Option<i64>)> = conn
      .query_row(
        "SELECT COALESCE(due_rule,'calendar_day'), day_of_month FROM income_forecasts WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
      )
      .optional()?;
    if let Some((due_rule, day_of_month)) = row {
      return Ok(crate::timeframe::income_date_from_due_rule(
        &due_rule,
        day_of_month,
      ));
    }
  }
  Ok(crate::timeframe::INCOME_DATE_LAST_BUSINESS_DAY)
}

pub fn get_timeframe_config(conn: &rusqlite::Connection) -> AppResult<crate::timeframe::TimeframeConfig> {
  ensure_timeframe_config_migrated(conn)?;
  let is_timeframe_month =
    get_app_setting(conn, IS_TIMEFRAME_MONTH_KEY)?.as_deref() == Some("1");
  let income_date = get_app_setting(conn, INCOME_DATE_KEY)?
    .and_then(|s| s.parse().ok())
    .unwrap_or(crate::timeframe::INCOME_DATE_LAST_BUSINESS_DAY);
  Ok(crate::timeframe::TimeframeConfig {
    is_timeframe_month,
    income_date,
  })
}

pub fn get_is_timeframe_month(conn: &rusqlite::Connection) -> AppResult<bool> {
  Ok(get_timeframe_config(conn)?.is_timeframe_month)
}

pub fn get_income_date(conn: &rusqlite::Connection) -> AppResult<i32> {
  Ok(get_timeframe_config(conn)?.income_date)
}

pub fn set_timeframe_config(
  conn: &rusqlite::Connection,
  is_timeframe_month: bool,
  income_date: i32,
) -> AppResult<()> {
  crate::setup::assert_period_mode_change_allowed(conn)?;
  if !is_timeframe_month && !crate::timeframe::is_valid_income_date(income_date) {
    return Err(AppError::Invalid("income_date invalid".into()));
  }
  set_app_setting(
    conn,
    IS_TIMEFRAME_MONTH_KEY,
    if is_timeframe_month { "1" } else { "0" },
  )?;
  set_app_setting(conn, INCOME_DATE_KEY, &income_date.to_string())?;
  let mode = if is_timeframe_month {
    "calendar_month"
  } else {
    "since_last_salary"
  };
  set_app_setting(conn, DASHBOARD_PERIOD_MODE_KEY, mode)
}

pub fn get_dashboard_period_mode(conn: &rusqlite::Connection) -> AppResult<String> {
  ensure_timeframe_config_migrated(conn)?;
  Ok(if get_is_timeframe_month(conn)? {
    "calendar_month".into()
  } else {
    "since_last_salary".into()
  })
}

pub fn set_dashboard_period_mode(conn: &rusqlite::Connection, mode: &str) -> AppResult<()> {
  crate::setup::assert_period_mode_change_allowed(conn)?;
  if mode != "calendar_month" && mode != "since_last_salary" {
    return Err(AppError::Invalid("dashboard period mode invalid".into()));
  }
  let is_month = mode == "calendar_month";
  let income_date = if is_month {
    0
  } else {
    derive_income_date_from_primary_forecast(conn)?
  };
  set_timeframe_config(conn, is_month, income_date)
}

pub fn get_primary_income_forecast_id(conn: &rusqlite::Connection) -> AppResult<Option<String>> {
  Ok(get_app_setting(conn, PRIMARY_INCOME_FORECAST_ID_KEY)?
    .filter(|s| !s.trim().is_empty()))
}

pub fn set_primary_income_forecast_id(
  conn: &rusqlite::Connection,
  forecast_id: Option<&str>,
) -> AppResult<()> {
  match forecast_id.filter(|s| !s.trim().is_empty()) {
    Some(id) => set_app_setting(conn, PRIMARY_INCOME_FORECAST_ID_KEY, id),
    None => {
      conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        params![PRIMARY_INCOME_FORECAST_ID_KEY],
      )?;
      Ok(())
    }
  }
}

pub fn get_primary_income_employer_iban(conn: &rusqlite::Connection) -> AppResult<Option<String>> {
  Ok(get_app_setting(conn, PRIMARY_INCOME_EMPLOYER_IBAN_KEY)?
    .and_then(|s| normalize_iban(&s)))
}

pub fn set_primary_income_employer_iban(
  conn: &rusqlite::Connection,
  iban: Option<&str>,
) -> AppResult<()> {
  match iban.and_then(normalize_iban) {
    Some(normalized) => set_app_setting(conn, PRIMARY_INCOME_EMPLOYER_IBAN_KEY, &normalized),
    None => {
      conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        params![PRIMARY_INCOME_EMPLOYER_IBAN_KEY],
      )?;
      Ok(())
    }
  }
}

pub fn get_primary_income_anchor_date(conn: &rusqlite::Connection) -> AppResult<Option<String>> {
  Ok(get_app_setting(conn, PRIMARY_INCOME_ANCHOR_DATE_KEY)?
    .filter(|s| !s.trim().is_empty()))
}

pub fn set_primary_income_anchor_date(
  conn: &rusqlite::Connection,
  date: Option<&str>,
) -> AppResult<()> {
  match date.filter(|s| !s.trim().is_empty()) {
    Some(d) => set_app_setting(conn, PRIMARY_INCOME_ANCHOR_DATE_KEY, d),
    None => {
      conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        params![PRIMARY_INCOME_ANCHOR_DATE_KEY],
      )?;
      Ok(())
    }
  }
}

fn import_balance_cents_key(account_id: &str) -> String {
  format!("import_balance_cents:{account_id}")
}

fn import_balance_as_of_key(account_id: &str) -> String {
  format!("import_balance_as_of:{account_id}")
}

pub fn set_import_balance(
  conn: &rusqlite::Connection,
  account_id: &str,
  balance_cents: i64,
  as_of_date: &str,
) -> AppResult<()> {
  set_app_setting(conn, &import_balance_cents_key(account_id), &balance_cents.to_string())?;
  set_app_setting(conn, &import_balance_as_of_key(account_id), as_of_date)
}

pub fn get_import_balance(
  conn: &rusqlite::Connection,
  account_id: &str,
) -> AppResult<Option<(i64, String)>> {
  let cents = get_app_setting(conn, &import_balance_cents_key(account_id))?
    .and_then(|s| s.parse::<i64>().ok());
  let as_of = get_app_setting(conn, &import_balance_as_of_key(account_id))?;
  match (cents, as_of) {
    (Some(c), Some(d)) if !d.trim().is_empty() => Ok(Some((c, d))),
    _ => Ok(None),
  }
}

/// Erkennt interne Umbuchungen nur über eine bekannte Gegenkonto-IBAN (Einrichtung).
pub fn resolve_internal_transfer_counterparty(
  conn: &rusqlite::Connection,
  iban_map: &HashMap<String, String>,
  counterparty_iban: Option<&str>,
  match_text: &str,
) -> Option<String> {
  let iban = counterparty_iban.and_then(normalize_iban)?;
  let id = iban_map.get(&iban)?.clone();
  let kind: String = conn
    .query_row(
      "SELECT COALESCE(account_kind, 'standard') FROM accounts WHERE id = ?1",
      params![id],
      |r| r.get(0),
    )
    .unwrap_or_else(|_| "standard".into());
  if kind == "oberspartopf" {
    if let Ok(Some(child_id)) = match_spartopf_account_id(conn, &id, match_text) {
      return Some(child_id);
    }
  }
  Some(id)
}

