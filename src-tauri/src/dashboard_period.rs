use crate::accounts::{
  get_income_date, get_is_timeframe_month, get_primary_income_forecast_id, get_main_account_id,
  get_timeframe_config,
};
use crate::calc_log::calc_log;
use crate::error::{AppError, AppResult};
use crate::logic::{generate_occurrences_with_due_rule_rp, month_add_iso};
use crate::setup::get_setup_mode;
use crate::timeframe::{due_rule_from_income_date, generate_income_boundary_dates};
use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{params, OptionalExtension};

pub struct DashboardPeriod {
  pub mode: String,
  pub period_start: String,
  pub period_end: String,
  pub salary_cutoff_date: Option<String>,
}

fn parse_iso(s: &str) -> Option<NaiveDate> {
  NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

fn iso_date(d: NaiveDate) -> String {
  d.format("%Y-%m-%d").to_string()
}

pub fn day_before(iso: &str) -> AppResult<String> {
  let d = parse_iso(iso).ok_or_else(|| AppError::Invalid("invalid date".into()))?;
  Ok(iso_date(d - Duration::days(1)))
}

pub fn month_bounds(month: &str) -> Option<(NaiveDate, NaiveDate)> {
  if month.len() != 7 {
    return None;
  }
  let year: i32 = month[..4].parse().ok()?;
  let mon: u32 = month[5..7].parse().ok()?;
  let start = NaiveDate::from_ymd_opt(year, mon, 1)?;
  let end = if mon == 12 {
    NaiveDate::from_ymd_opt(year + 1, 1, 1)?.pred_opt()?
  } else {
    NaiveDate::from_ymd_opt(year, mon + 1, 1)?.pred_opt()?
  };
  Some((start, end))
}

fn extract_iban_from_ledger_notes(notes: &str) -> Option<String> {
  for part in notes.split('\n') {
    let trimmed = part.trim();
    if let Some(rest) = trimmed.strip_prefix("IBAN:") {
      if let Some(iban) = crate::accounts::normalize_iban(rest.trim()) {
        return Some(iban);
      }
    }
  }
  None
}

fn load_salary_dates(conn: &rusqlite::Connection, main_id: &str) -> AppResult<Vec<String>> {
  let mut dates: Vec<String> = Vec::new();
  if let Some(forecast_id) = get_primary_income_forecast_id(conn)? {
    let mut stmt = conn.prepare(
      "SELECT occurrence_date FROM income_forecast_actuals
       WHERE income_forecast_id = ?1 AND ledger_transaction_id IS NOT NULL
       ORDER BY occurrence_date ASC",
    )?;
    for row in stmt.query_map(params![forecast_id], |r| r.get::<_, String>(0))? {
      dates.push(row?);
    }
    let mut stmt2 = conn.prepare(
      "SELECT date FROM ledger_transactions
       WHERE kind = 'income' AND account_id = ?1
         AND source_id LIKE ?2
       ORDER BY date ASC",
    )?;
    let pattern = format!("income_forecast:{}:%", forecast_id);
    for row in stmt2.query_map(params![main_id, pattern], |r| r.get::<_, String>(0))? {
      let d = row?;
      if !dates.contains(&d) {
        dates.push(d);
      }
    }
    let amount: Option<i64> = conn
      .query_row(
        "SELECT amount_cents FROM income_forecasts WHERE id = ?1",
        params![forecast_id],
        |r| r.get(0),
      )
      .optional()?;
    if let Some(amount_cents) = amount {
      let mut stmt3 = conn.prepare(
        "SELECT date FROM ledger_transactions
         WHERE kind = 'income' AND account_id = ?1 AND amount_cents = ?2
           AND COALESCE(source_id, '') LIKE 'bank_import:%'
         ORDER BY date ASC",
      )?;
      for row in stmt3.query_map(params![main_id, amount_cents], |r| r.get::<_, String>(0))? {
        let d = row?;
        if !dates.contains(&d) {
          dates.push(d);
        }
      }
    }
    if let Some(employer_iban) = crate::accounts::get_primary_income_employer_iban(conn)? {
      let mut stmt4 = conn.prepare(
        "SELECT date, notes FROM ledger_transactions
         WHERE kind = 'income' AND account_id = ?1
           AND COALESCE(source_id, '') LIKE 'bank_import:%'
         ORDER BY date ASC",
      )?;
      for row in stmt4.query_map(params![main_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
      })? {
        let (date, notes) = row?;
        let matches = notes
          .as_deref()
          .and_then(extract_iban_from_ledger_notes)
          .as_deref()
          == Some(employer_iban.as_str());
        if matches && !dates.contains(&date) {
          dates.push(date);
        }
      }
    }
  }
  dates.sort();
  dates.dedup();
  if let Some(anchor) = crate::accounts::get_primary_income_anchor_date(conn)? {
    if !dates.contains(&anchor) {
      dates.push(anchor);
      dates.sort();
      dates.dedup();
    }
  }
  Ok(dates)
}

fn last_salary_before(dates: &[String], before_exclusive: &str) -> Option<String> {
  dates
    .iter()
    .rev()
    .find(|d| d.as_str() < before_exclusive)
    .cloned()
}

fn primary_forecast_generation_start(conn: &rusqlite::Connection) -> AppResult<String> {
  if let Some(forecast_id) = get_primary_income_forecast_id(conn)? {
    if let Some(first) = conn
      .query_row(
        "SELECT first_charge_date FROM income_forecasts WHERE id = ?1",
        params![forecast_id],
        |r| r.get::<_, String>(0),
      )
      .optional()?
    {
      return Ok(first);
    }
  }
  if let Some(anchor) = crate::accounts::get_primary_income_anchor_date(conn)? {
    return Ok(anchor);
  }
  Ok("2020-01-01".to_string())
}

fn period_mode_label(is_timeframe_month: bool) -> &'static str {
  if is_timeframe_month {
    "calendar_month"
  } else {
    "since_last_salary"
  }
}

fn load_configured_income_boundary_dates(
  conn: &rusqlite::Connection,
  through_inclusive: &str,
) -> AppResult<Vec<String>> {
  let config = get_timeframe_config(conn)?;
  if config.is_timeframe_month {
    calc_log!(
      "dashboard_period",
      "load_configured_income_boundary_dates",
      "is_timeframe_month=true → keine Gehaltsgrenzen, through={through_inclusive}"
    );
    return Ok(Vec::new());
  }
  let from = primary_forecast_generation_start(conn)?;
  let boundaries = generate_income_boundary_dates(&from, through_inclusive, config.income_date)?;
  calc_log!(
    "dashboard_period",
    "load_configured_income_boundary_dates",
    "income_date={}, from={}, through={}, boundaries={:?}",
    config.income_date,
    from,
    through_inclusive,
    boundaries
  );
  Ok(boundaries)
}

fn resolve_salary_period_start(boundaries: &[String], range_start: &str, range_end: &str) -> String {
  if let Some(cutoff) = last_salary_before(boundaries, range_start) {
    return cutoff;
  }
  boundaries
    .iter()
    .find(|d| d.as_str() >= range_start && d.as_str() <= range_end)
    .cloned()
    .unwrap_or_else(|| range_start.to_string())
}

/// Kalendermonat → Gehaltszeitraum: startet mit dem Gehaltstermin in diesem Monat (wenn schon fällig),
/// sonst mit dem laufenden Zeitraum (Gehaltstermin liegt noch in der Zukunft).
fn resolve_period_start_for_month(
  boundaries: &[String],
  range_start: &str,
  range_end: &str,
  today: &str,
) -> String {
  let in_month: Vec<&String> = boundaries
    .iter()
    .filter(|d| d.as_str() >= range_start && d.as_str() <= range_end)
    .collect();
  if let Some(salary) = in_month.last() {
    if salary.as_str() <= today {
      return (*salary).clone();
    }
  }
  resolve_salary_period_start(boundaries, range_start, range_end)
}

fn next_forecast_salary_after(boundaries: &[String], after: &str) -> Option<String> {
  boundaries.iter().find(|d| d.as_str() > after).cloned()
}

/// Ein Gehaltszeitraum: letzter Bankarbeitstag → Tag vor dem nächsten Gehaltstermin.
#[derive(Debug, Clone)]
pub struct SalaryPeriod {
  pub period_start: String,
  pub period_end: String,
}

pub fn list_salary_periods(conn: &rusqlite::Connection) -> AppResult<Vec<SalaryPeriod>> {
  let config = get_timeframe_config(conn)?;
  if config.is_timeframe_month {
    calc_log!(
      "dashboard_period",
      "list_salary_periods",
      "is_timeframe_month=true → leere Liste"
    );
    return Ok(Vec::new());
  }
  let boundaries = load_configured_income_boundary_dates(conn, "2099-12-31")?;
  let mut out = Vec::with_capacity(boundaries.len());
  for (i, start) in boundaries.iter().enumerate() {
    let Some(next) = boundaries.get(i + 1) else {
      break;
    };
    let period_end = day_before(next)?;
    out.push(SalaryPeriod {
      period_start: start.clone(),
      period_end,
    });
  }
  calc_log!(
    "dashboard_period",
    "list_salary_periods",
    "income_date={}, count={}, periods={:?}",
    config.income_date,
    out.len(),
    out
  );
  Ok(out)
}

pub fn current_salary_period(conn: &rusqlite::Connection) -> AppResult<SalaryPeriod> {
  let today = chrono::Utc::now().date_naive().format("%Y-%m-%d").to_string();
  let periods = list_salary_periods(conn)?;
  if let Some(p) = periods.iter().find(|p| {
    today.as_str() >= p.period_start.as_str() && today.as_str() <= p.period_end.as_str()
  }) {
    return Ok(p.clone());
  }
  periods
    .into_iter()
    .last()
    .ok_or_else(|| AppError::Invalid("no salary periods".into()))
}

pub fn min_salary_period_start(conn: &rusqlite::Connection) -> AppResult<Option<String>> {
  Ok(list_salary_periods(conn)?.first().map(|p| p.period_start.clone()))
}

fn is_first_salary_period_start(conn: &rusqlite::Connection, period_start: &str) -> AppResult<bool> {
  Ok(list_salary_periods(conn)?
    .first()
    .map(|p| p.period_start == period_start)
    .unwrap_or(false))
}

fn apply_first_salary_period_adjustments(
  conn: &rusqlite::Connection,
  mut period: DashboardPeriod,
  period_start: &str,
) -> AppResult<DashboardPeriod> {
  let setup_mode = get_setup_mode(conn)?.unwrap_or_else(|| "manual".to_string());
  let is_timeframe_month = get_is_timeframe_month(conn)?;

  if !is_timeframe_month && setup_mode == "manual" {
    let setup = setup_date(conn).unwrap_or_else(|_| period.period_start.clone());
    period.period_start = setup.clone();
    if let Some(next_salary) = first_forecast_salary_after(conn, &setup)? {
      if next_salary.as_str() > setup.as_str() {
        period.period_end = day_before(&next_salary)?;
      }
    }
    return Ok(period);
  }

  if is_timeframe_month && setup_mode == "manual" {
    let setup = setup_date(conn).unwrap_or_else(|_| period.period_start.clone());
    period.period_start = setup;
    return Ok(period);
  }

  if is_timeframe_month && setup_mode == "bank_import" {
    if let Some(first_cal) = first_calendar_dashboard_month(conn)? {
      let first_period_month = if period_start.len() >= 7 {
        &period_start[..7]
      } else {
        period_start
      };
      if first_cal == first_period_month {
        let (start, end) = month_bounds(&first_cal).ok_or_else(|| AppError::Invalid("invalid month".into()))?;
        period.period_start = iso_date(start);
        period.period_end = iso_date(end);
      }
    }
  }

  Ok(period)
}

pub fn salary_period_dashboard(
  conn: &rusqlite::Connection,
  period_start: &str,
) -> AppResult<DashboardPeriod> {
  let is_timeframe_month = get_is_timeframe_month(conn)?;
  let mode = period_mode_label(is_timeframe_month).to_string();
  let periods = list_salary_periods(conn)?;
  let p = periods
    .iter()
    .find(|p| p.period_start == period_start)
    .ok_or_else(|| AppError::Invalid("unknown salary period".into()))?;
  let boundaries = load_configured_income_boundary_dates(conn, &p.period_end)?;
  let mut period = DashboardPeriod {
    mode,
    period_start: p.period_start.clone(),
    period_end: p.period_end.clone(),
    salary_cutoff_date: last_salary_before(&boundaries, &p.period_start),
  };
  if is_first_salary_period_start(conn, period_start)? {
    period = apply_first_salary_period_adjustments(conn, period, period_start)?;
  }
  calc_log!(
    "dashboard_period",
    "salary_period_dashboard",
    "period_start={} → start={}, end={}, cutoff={:?}",
    period_start,
    period.period_start,
    period.period_end,
    period.salary_cutoff_date
  );
  Ok(period)
}

/// Prognose-Fälligkeit der Haupteinnahme für den Kalendermonat eines Buchungsdatums.
pub fn primary_income_occurrence_for_date(
  conn: &rusqlite::Connection,
  tx_date: &str,
) -> AppResult<Option<String>> {
  if tx_date.len() < 7 {
    return Ok(None);
  }
  let config = get_timeframe_config(conn)?;
  let Some(forecast_id) = get_primary_income_forecast_id(conn)? else {
    return Ok(None);
  };
  let row: Option<(String, String, Option<String>)> = conn
    .query_row(
      "SELECT first_charge_date, cadence, end_charge_date
       FROM income_forecasts WHERE id = ?1 AND COALESCE(active, 1) = 1",
      params![forecast_id],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .optional()?;
  let Some((first, cadence, end_charge)) = row else {
    return Ok(None);
  };
  let (due_rule, day_of_month) = if config.is_timeframe_month {
    let due_row: Option<(String, Option<i64>)> = conn
      .query_row(
        "SELECT COALESCE(due_rule,'calendar_day'), day_of_month FROM income_forecasts WHERE id = ?1",
        params![forecast_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
      )
      .optional()?;
    match due_row {
      Some((rule, dom)) => (rule, dom.and_then(|x| if x > 0 { Some(x as u32) } else { None })),
      None => ("calendar_day".to_string(), None),
    }
  } else {
    let (rule, dom) = due_rule_from_income_date(config.income_date)?;
    (rule.to_string(), dom)
  };
  let month = &tx_date[..7];
  let (start, end) = month_bounds(month).ok_or_else(|| AppError::Invalid("invalid date".into()))?;
  let occ = generate_occurrences_with_due_rule_rp(
    &first,
    &cadence,
    &due_rule,
    day_of_month,
    &iso_date(start),
    &iso_date(end),
    3,
    end_charge.as_deref().filter(|s| !s.is_empty()),
  );
  let result = occ
    .iter()
    .filter(|d| d.as_str() <= tx_date)
    .last()
    .cloned()
    .or_else(|| occ.into_iter().next());
  calc_log!(
    "dashboard_period",
    "primary_income_occurrence_for_date",
    "tx_date={}, income_date={}, occurrence={:?}",
    tx_date,
    config.income_date,
    result
  );
  Ok(result)
}

fn forecast_horizon_end(range_end: &str) -> String {
  if range_end.len() >= 7 {
    month_add_iso(&range_end[..7], 1)
      .and_then(|next_month| month_bounds(&next_month).map(|(_, end)| iso_date(end)))
      .unwrap_or_else(|| range_end.to_string())
  } else {
    range_end.to_string()
  }
}

fn salary_at_period_start(salary_dates: &[String], period_start: &str) -> Option<String> {
  if salary_dates.iter().any(|d| d == period_start) {
    return Some(period_start.to_string());
  }
  None
}

pub fn start_balance_date_for_period(
  salary_dates: &[String],
  period_start: &str,
) -> AppResult<String> {
  if let Some(salary) = salary_at_period_start(salary_dates, period_start) {
    return day_before(&salary);
  }
  day_before(period_start)
}

pub fn setup_opening_balance_total_cents(
  conn: &rusqlite::Connection,
  account_ids: &[String],
) -> AppResult<i64> {
  let mut sum = 0i64;
  for id in account_ids {
    if let Some((cents, _)) = crate::accounts::get_import_balance(conn, id)? {
      sum += cents;
    }
  }
  Ok(sum)
}

pub fn setup_opening_liquid_total_cents(
  conn: &rusqlite::Connection,
  account_ids: &[String],
) -> AppResult<i64> {
  let mut sum = 0i64;
  for id in account_ids {
    let is_liquid: i64 = conn.query_row(
      "SELECT is_liquid FROM accounts WHERE id = ?1",
      params![id],
      |r| r.get(0),
    )?;
    if is_liquid == 0 {
      continue;
    }
    if let Some((cents, _)) = crate::accounts::get_import_balance(conn, id)? {
      sum += cents;
    }
  }
  Ok(sum)
}

pub fn balance_scope_account_ids(
  conn: &rusqlite::Connection,
  _account_filter: &Option<String>,
  filter_scope: &Option<crate::accounts::AccountFilterScope>,
) -> AppResult<Vec<String>> {
  if let Some(scope) = filter_scope {
    return Ok(scope.member_ids.clone());
  }
  let mut stmt = conn.prepare("SELECT id FROM accounts")?;
  let ids = stmt
    .query_map([], |r| r.get::<_, String>(0))?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(ids)
}

pub fn prognostic_start_balance_date(
  conn: &rusqlite::Connection,
  period: &DashboardPeriod,
) -> AppResult<String> {
  if period.mode == "calendar_month" {
    return Ok(period.period_start.clone());
  }
  let boundary_dates = load_configured_income_boundary_dates(conn, &period.period_end)?;
  let result = start_balance_date_for_period(&boundary_dates, &period.period_start)?;
  calc_log!(
    "dashboard_period",
    "prognostic_start_balance_date",
    "period_start={}, period_end={} → balance_date={}",
    period.period_start,
    period.period_end,
    result
  );
  Ok(result)
}

pub fn compute_dashboard_period(
  conn: &rusqlite::Connection,
  month: &str,
) -> AppResult<DashboardPeriod> {
  let is_timeframe_month = get_is_timeframe_month(conn)?;
  let mode = period_mode_label(is_timeframe_month).to_string();
  let (start, end) = month_bounds(month).ok_or_else(|| AppError::Invalid("invalid month".into()))?;
  let range_start = iso_date(start);
  let range_end = iso_date(end);

  if is_timeframe_month {
    let period = DashboardPeriod {
      mode,
      period_start: range_start.clone(),
      period_end: range_end.clone(),
      salary_cutoff_date: None,
    };
    calc_log!(
      "dashboard_period",
      "compute_dashboard_period",
      "month={}, is_timeframe_month=true → start={}, end={}",
      month,
      period.period_start,
      period.period_end
    );
    return Ok(period);
  }

  let forecast_through = forecast_horizon_end(&range_end);
  let boundaries = load_configured_income_boundary_dates(conn, &forecast_through)?;
  let extended = load_configured_income_boundary_dates(conn, "2099-12-31")?;
  let today = chrono::Utc::now().date_naive().format("%Y-%m-%d").to_string();
  let cutoff = last_salary_before(&boundaries, &range_start);
  let period_start = resolve_period_start_for_month(&boundaries, &range_start, &range_end, &today);
  let period_end = match next_forecast_salary_after(&extended, &period_start) {
    Some(next) => day_before(&next)?,
    None => range_end.clone(),
  };

  let period = DashboardPeriod {
    mode,
    period_start: period_start.clone(),
    period_end: period_end.clone(),
    salary_cutoff_date: cutoff,
  };
  calc_log!(
    "dashboard_period",
    "compute_dashboard_period",
    "month={}, is_timeframe_month=false, income_date={} → start={}, end={}, cutoff={:?}",
    month,
    get_income_date(conn)?,
    period.period_start,
    period.period_end,
    period.salary_cutoff_date
  );
  Ok(period)
}

pub fn derive_opening_cutoff_date(
  conn: &rusqlite::Connection,
  balance_as_of: &str,
) -> AppResult<String> {
  let is_timeframe_month = get_is_timeframe_month(conn)?;
  if is_timeframe_month {
    return Ok(balance_as_of.to_string());
  }
  let main_id = get_main_account_id(conn)?;
  let salary_dates = load_salary_dates(conn, &main_id)?;
  if let Some(cutoff) = last_salary_before(&salary_dates, balance_as_of) {
    return Ok(cutoff);
  }
  if let Some(d) = parse_iso(balance_as_of) {
    let month_start = iso_date(NaiveDate::from_ymd_opt(d.year(), d.month(), 1).unwrap());
    if let Some(c) = last_salary_before(&salary_dates, &month_start) {
      return Ok(c);
    }
  }
  Ok(balance_as_of.to_string())
}

/// Frühester Kalendermonat in der Dashboard-Monatsnavigation (YYYY-MM).
pub fn dashboard_min_month(conn: &rusqlite::Connection) -> AppResult<String> {
  let is_timeframe_month = get_is_timeframe_month(conn)?;
  if is_timeframe_month {
    let setup_mode = get_setup_mode(conn)?.unwrap_or_else(|| "manual".to_string());
    if setup_mode == "bank_import" {
      if let Some(m) = first_calendar_dashboard_month(conn)? {
        return Ok(m);
      }
    }
    if let Ok(setup) = setup_date(conn) {
      if setup.len() >= 7 {
        return Ok(setup[..7].to_string());
      }
    }
    return Ok(chrono::Utc::now().format("%Y-%m").to_string());
  }

  let main_id = get_main_account_id(conn)?;
  let dates = load_salary_dates(conn, &main_id)?;
  let Some(first) = dates.first() else {
    if let Some(anchor) = crate::accounts::get_primary_income_anchor_date(conn)? {
      if anchor.len() >= 7 {
        return Ok(anchor[..7].to_string());
      }
    }
    return Ok(chrono::Utc::now().format("%Y-%m").to_string());
  };
  Ok(first[..7].to_string())
}

pub fn opening_balance_date_for_import(
  conn: &rusqlite::Connection,
  balance_as_of: &str,
  earliest_tx_date: &str,
) -> AppResult<String> {
  if get_is_timeframe_month(conn)? {
    return Ok(earliest_tx_date.to_string());
  }
  if let Some(cutoff) = {
    let main_id = get_main_account_id(conn)?;
    let dates = load_salary_dates(conn, &main_id)?;
    last_salary_before(&dates, balance_as_of)
  } {
    return Ok(cutoff);
  }
  Ok(earliest_tx_date.to_string())
}

/// Frühester Anlage- bzw. Import-Stichtag über alle Konten mit Anfangssaldo.
pub fn setup_date(conn: &rusqlite::Connection) -> AppResult<String> {
  let mut stmt = conn.prepare(
    "SELECT id FROM accounts WHERE COALESCE(account_kind, 'standard') != 'oberspartopf'",
  )?;
  let account_ids = stmt
    .query_map([], |r| r.get::<_, String>(0))?
    .collect::<Result<Vec<_>, _>>()?;
  let mut earliest: Option<String> = None;
  for id in account_ids {
    if let Some((_, as_of)) = crate::accounts::get_import_balance(conn, &id)? {
      earliest = Some(match earliest {
        Some(ref e) if as_of.as_str() < e.as_str() => as_of,
        Some(e) => e,
        None => as_of,
      });
    }
  }
  earliest.ok_or_else(|| AppError::Invalid("setup date unknown".into()))
}

fn first_forecast_salary_after(conn: &rusqlite::Connection, on_or_after: &str) -> AppResult<Option<String>> {
  let dates = load_configured_income_boundary_dates(conn, "2099-12-31")?;
  Ok(dates.into_iter().find(|d| d.as_str() >= on_or_after))
}

/// Erster Kalendermonat nach der ersten Haupteinnahme (Bankimport + Kalendermonat).
pub fn first_calendar_dashboard_month(conn: &rusqlite::Connection) -> AppResult<Option<String>> {
  let main_id = get_main_account_id(conn)?;
  let dates = load_salary_dates(conn, &main_id)?;
  let Some(first) = dates.first() else {
    return Ok(None);
  };
  if first.len() < 7 {
    return Ok(None);
  }
  Ok(month_add_iso(&first[..7], 1))
}

pub fn is_first_dashboard_month(conn: &rusqlite::Connection, month: &str) -> AppResult<bool> {
  if !get_is_timeframe_month(conn)? {
    if let Some(min) = min_salary_period_start(conn)? {
      if min.len() >= 7 {
        return Ok(&min[..7] == month);
      }
    }
  }
  Ok(month == dashboard_min_month(conn)?)
}

/// Zeitraumgrenzen inkl. verkürztem Erstzeitraum bei manueller Einrichtung.
pub fn effective_period_for_month(conn: &rusqlite::Connection, month: &str) -> AppResult<DashboardPeriod> {
  let is_timeframe_month = get_is_timeframe_month(conn)?;
  if !is_timeframe_month {
    if let Some(p) = list_salary_periods(conn)?
      .into_iter()
      .find(|p| p.period_start.len() >= 7 && &p.period_start[..7] == month)
    {
      return salary_period_dashboard(conn, &p.period_start);
    }
    let period = compute_dashboard_period(conn, month)?;
    calc_log!(
      "dashboard_period",
      "effective_period_for_month",
      "month={}, income-based fallback → start={}, end={}",
      month,
      period.period_start,
      period.period_end
    );
    return Ok(period);
  }

  let mut period = compute_dashboard_period(conn, month)?;
  if !is_first_dashboard_month(conn, month)? {
    calc_log!(
      "dashboard_period",
      "effective_period_for_month",
      "month={}, monthly → start={}, end={}",
      month,
      period.period_start,
      period.period_end
    );
    return Ok(period);
  }

  let setup_mode = get_setup_mode(conn)?.unwrap_or_else(|| "manual".to_string());

  if is_timeframe_month && setup_mode == "manual" {
    let setup = setup_date(conn).unwrap_or_else(|_| period.period_start.clone());
    period.period_start = setup;
    calc_log!(
      "dashboard_period",
      "effective_period_for_month",
      "month={}, first manual period → start={}, end={}",
      month,
      period.period_start,
      period.period_end
    );
    return Ok(period);
  }

  if is_timeframe_month && setup_mode == "bank_import" {
    if let Some(first_cal) = first_calendar_dashboard_month(conn)? {
      if month == first_cal {
        let (start, end) = month_bounds(month).ok_or_else(|| AppError::Invalid("invalid month".into()))?;
        period.period_start = iso_date(start);
        period.period_end = iso_date(end);
      }
    }
  }

  Ok(period)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::logic::{generate_occurrences_with_due_rule_rp, last_business_day_of_month_rp};

  fn last_bd_boundaries(from: &str, through: &str) -> Vec<String> {
    generate_occurrences_with_due_rule_rp(
      from,
      "monthly",
      "last_business_day",
      None,
      from,
      through,
      50,
      None,
    )
  }

  #[test]
  fn april_view_starts_with_april_salary_when_past() {
    let boundaries = last_bd_boundaries("2026-03-31", "2026-08-31");
    let start = resolve_period_start_for_month(&boundaries, "2026-04-01", "2026-04-30", "2026-06-01");
    assert_eq!(start, "2026-04-30");
  }

  #[test]
  fn salary_period_list_is_unique_by_start_date() {
    let boundaries = last_bd_boundaries("2026-03-31", "2026-08-31");
    let mut starts = Vec::new();
    for i in 0..boundaries.len().saturating_sub(1) {
      starts.push(boundaries[i].clone());
    }
    assert_eq!(starts[0], "2026-03-31");
    assert_eq!(starts[1], "2026-04-30");
    assert_eq!(starts[2], "2026-05-29");
    assert_eq!(
      day_before(&boundaries[1]).unwrap(),
      "2026-04-29",
      "first period ends day before second salary"
    );
    assert_eq!(day_before(&boundaries[2]).unwrap(), "2026-05-28");
  }

  #[test]
  fn salary_period_runs_last_bd_to_day_before_next_last_bd() {
    let first = "2026-04-30";
    let boundaries = last_bd_boundaries(first, "2026-08-31");
    let period_start = resolve_salary_period_start(&boundaries, "2026-05-01", "2026-05-31");
    let may_salary = iso_date(last_business_day_of_month_rp(2026, 5));
    assert_eq!(period_start, "2026-04-30");
    assert_eq!(next_forecast_salary_after(&boundaries, &period_start).as_deref(), Some(may_salary.as_str()));
    assert_eq!(day_before(&may_salary).unwrap(), "2026-05-28");
  }

  #[test]
  fn june_view_after_june_salary_starts_on_june_last_bd() {
    let boundaries = last_bd_boundaries("2026-04-30", "2026-08-31");
    let june_salary = iso_date(last_business_day_of_month_rp(2026, 6));
    let start = resolve_period_start_for_month(&boundaries, "2026-06-01", "2026-06-30", "2026-07-15");
    assert_eq!(start, june_salary);
    assert_eq!(day_before(&iso_date(last_business_day_of_month_rp(2026, 7))).unwrap(), "2026-07-30");
  }
}
