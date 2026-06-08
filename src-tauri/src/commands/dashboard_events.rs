use super::forecast_fixed::push_fixed_cost_events_for_range;
use super::forecast_income::push_unbooked_income_events_for_range;
use super::forecast_variable::{
  push_variable_cost_events_for_period, should_hide_categorized_variable_cost_event,
};
use super::helpers::{
  account_balance_source, account_filter_scope, account_liquid_map, account_name_map, account_name_of,
  event_matches_account,
};
use super::prognostic::{ledger_transfers_in_range, push_depot_stock_purchase_events};
use crate::accounts::{
  get_main_account_id, get_primary_income_employer_iban, get_primary_income_forecast_id,
};
use crate::calc_log::calc_log;
use crate::dashboard_period::primary_income_occurrence_for_date;
use crate::income_actuals::parse_income_forecast_source_id;
use crate::dashboard_period::DashboardPeriod;
use crate::error::AppResult;
use crate::logic::month_add_iso;
use crate::models::TimelineEvent;
use rusqlite::{params, Connection, OptionalExtension};

pub(crate) struct DashboardEventBuild {
  pub events: Vec<TimelineEvent>,
  pub income_sum: i64,
  pub fixed_costs_sum: i64,
  pub variable_costs_sum: i64,
  pub buys_sum: i64,
  pub transfers_sum: i64,
}

/// Automatisch materialisierte Prognose-Doppelbuchung (ohne Ist-Wert) — nicht als reelle Einnahme zählen.
fn should_skip_prognostic_income_ledger(
  conn: &Connection,
  kind: &str,
  source_id: Option<&str>,
  ledger_id: &str,
  _notes: Option<&str>,
) -> AppResult<bool> {
  if kind != "income" {
    return Ok(false);
  }
  let linked: i64 = conn.query_row(
    "SELECT COUNT(*) FROM income_forecast_actuals WHERE ledger_transaction_id = ?1",
    params![ledger_id],
    |r| r.get(0),
  )?;
  if linked > 0 {
    return Ok(false);
  }
  let Some(sid) = source_id else {
    return Ok(false);
  };
  if !sid.starts_with("income_forecast:") {
    return Ok(false);
  }
  crate::income_actuals::is_prognostic_income_ledger(conn, sid)
}

/// Entfernt nur Prognose-Doppler zu bereits gebuchten Ledger-Einnahmen — nie echte Import-Zeilen.
fn dedupe_income_events(events: &mut Vec<TimelineEvent>) {
  use std::collections::HashSet;

  let mut ledger_keys: HashSet<(String, i64, String)> = HashSet::new();
  for ev in events.iter() {
    if ev.id.starts_with("ledger:income:") {
      ledger_keys.insert((
        ev.date.clone(),
        ev.amount_cents,
        ev.account_id.clone().unwrap_or_default(),
      ));
    }
  }

  events.retain(|ev| {
    if !(ev.id.starts_with("income:") || ev.id.starts_with("income_actual:")) {
      return true;
    }
    let key = (
      ev.date.clone(),
      ev.amount_cents,
      ev.account_id.clone().unwrap_or_default(),
    );
    !ledger_keys.contains(&key)
  });
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

fn ledger_matches_primary_employer(
  conn: &Connection,
  notes: Option<&str>,
  source_id: Option<&str>,
) -> AppResult<bool> {
  let Some(employer_iban) = get_primary_income_employer_iban(conn)? else {
    return Ok(false);
  };
  if notes
    .and_then(|n| extract_iban_from_ledger_notes(n))
    .as_deref()
    == Some(employer_iban.as_str())
  {
    return Ok(true);
  }
  if let Some(sid) = source_id {
    if let Some((forecast_id, _)) = parse_income_forecast_source_id(sid) {
      if get_primary_income_forecast_id(conn)?.as_deref() == Some(forecast_id.as_str()) {
        return Ok(true);
      }
    }
  }
  Ok(false)
}

/// Gibt es eine gebuchte Haupteinnahme (Arbeitgeber-IBAN) nahe dem Prognose-Termin?
pub(crate) fn primary_employer_ledger_exists_near_date(
  conn: &Connection,
  occurrence_date: &str,
) -> AppResult<bool> {
  if get_primary_income_forecast_id(conn)?.is_none() {
    return Ok(false);
  }
  if get_primary_income_employer_iban(conn)?.is_none() {
    return Ok(false);
  }
  let main_id = get_main_account_id(conn)?;
  let window_start = crate::dashboard_period::day_before(occurrence_date)
    .unwrap_or_else(|_| occurrence_date.to_string());
  let mut stmt = conn.prepare(
    "SELECT notes, source_id FROM ledger_transactions
     WHERE kind = 'income' AND account_id = ?1 AND amount_cents > 0
       AND date >= ?2 AND date <= ?3",
  )?;
  for row in stmt.query_map(params![main_id, window_start, occurrence_date], |r| {
    Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
  })? {
    let (notes, source_id) = row?;
    if ledger_matches_primary_employer(conn, notes.as_deref(), source_id.as_deref())? {
      return Ok(true);
    }
  }
  Ok(false)
}

fn primary_income_occurrence_for_ledger(
  conn: &Connection,
  ledger_id: &str,
  ledger_date: &str,
  source_id: Option<&str>,
  notes: Option<&str>,
) -> AppResult<Option<String>> {
  if !ledger_matches_primary_employer(conn, notes, source_id)? {
    return Ok(None);
  }
  if let Some(sid) = source_id {
    if let Some((forecast_id, occ)) = parse_income_forecast_source_id(sid) {
      if get_primary_income_forecast_id(conn)?.as_deref() == Some(forecast_id.as_str()) {
        return Ok(Some(occ));
      }
    }
  }
  let linked: Option<String> = conn
    .query_row(
      "SELECT occurrence_date FROM income_forecast_actuals WHERE ledger_transaction_id = ?1",
      params![ledger_id],
      |r| r.get(0),
    )
    .optional()?;
  if let Some(occ) = linked {
    return Ok(Some(occ));
  }
  primary_income_occurrence_for_date(conn, ledger_date)
}

fn income_event_date_in_period(
  conn: &Connection,
  ledger_id: &str,
  ledger_date: &str,
  source_id: Option<&str>,
  notes: Option<&str>,
  period_start: &str,
  period_end: &str,
) -> AppResult<Option<String>> {
  if ledger_date < period_start || ledger_date > period_end {
    return Ok(None);
  }
  let display_date = primary_income_occurrence_for_ledger(conn, ledger_id, ledger_date, source_id, notes)?
    .filter(|occ| occ.as_str() >= period_start && occ.as_str() <= period_end)
    .unwrap_or_else(|| ledger_date.to_string());
  Ok(Some(display_date))
}

/// Haupteinnahme vom Arbeitgeber (IBAN), noch nicht als Ledger-Ereignis im Zeitraum.
fn append_primary_employer_income_for_range(
  conn: &Connection,
  range_start: &str,
  range_end: &str,
  filter_scope: &Option<crate::accounts::AccountFilterScope>,
  main_id: &str,
  names: &std::collections::HashMap<String, String>,
  events: &mut Vec<TimelineEvent>,
) -> AppResult<()> {
  if !event_matches_account(filter_scope, main_id, Some(main_id)) {
    return Ok(());
  }
  let has_employer = get_primary_income_employer_iban(conn)?.is_some();
  let has_primary_forecast = get_primary_income_forecast_id(conn)?.is_some();
  if !has_employer && !has_primary_forecast {
    return Ok(());
  }
  let lookback = crate::dashboard_period::day_before(range_start).unwrap_or_else(|_| range_start.to_string());
  let mut stmt = conn.prepare(
    "SELECT id, title, amount_cents, date, notes, source_id
     FROM ledger_transactions
     WHERE kind = 'income' AND account_id = ?1 AND amount_cents > 0
       AND date >= ?2 AND date <= ?3",
  )?;
  let rows = stmt.query_map(params![main_id, lookback, range_end], |r| {
    Ok((
      r.get::<_, String>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, i64>(2)?,
      r.get::<_, String>(3)?,
      r.get::<_, Option<String>>(4)?,
      r.get::<_, Option<String>>(5)?,
    ))
  })?;
  for row in rows {
    let (id, title, amount_cents, ledger_date, notes, source_id) = row?;
    let event_id = format!("ledger:income:{id}");
    if events.iter().any(|e| e.id == event_id) {
      continue;
    }
    if !ledger_matches_primary_employer(conn, notes.as_deref(), source_id.as_deref())? {
      continue;
    }
    let Some(event_date) = income_event_date_in_period(
      conn,
      &id,
      &ledger_date,
      source_id.as_deref(),
      notes.as_deref(),
      range_start,
      range_end,
    )?
    else {
      continue;
    };
    events.push(TimelineEvent {
      id: event_id,
      r#type: "income".into(),
      date: event_date,
      title,
      amount_cents,
      account_id: Some(main_id.to_string()),
      account_name: Some(account_name_of(names, main_id)),
      internal_transfer: false,
    });
  }
  Ok(())
}

/// Ist-Einnahmen aus income_forecast_actuals — nach occurrence_date im Zeitraum.
fn append_booked_income_actuals_for_range(
  conn: &Connection,
  range_start: &str,
  range_end: &str,
  filter_scope: &Option<crate::accounts::AccountFilterScope>,
  main_id: &str,
  names: &std::collections::HashMap<String, String>,
  events: &mut Vec<TimelineEvent>,
) -> AppResult<()> {
  let mut stmt = conn.prepare(
    "SELECT a.income_forecast_id, a.occurrence_date, a.amount_cents, a.ledger_transaction_id,
            COALESCE(lt.title, f.name), COALESCE(lt.account_id, f.account_id, ?1)
     FROM income_forecast_actuals a
     INNER JOIN income_forecasts f ON f.id = a.income_forecast_id
     LEFT JOIN ledger_transactions lt ON lt.id = a.ledger_transaction_id
     WHERE a.amount_cents > 0
       AND a.occurrence_date >= ?2 AND a.occurrence_date <= ?3",
  )?;
  let rows = stmt.query_map(params![main_id, range_start, range_end], |r| {
    Ok((
      r.get::<_, String>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, i64>(2)?,
      r.get::<_, Option<String>>(3)?,
      r.get::<_, String>(4)?,
      r.get::<_, String>(5)?,
    ))
  })?;
  for row in rows {
    let (forecast_id, occurrence_date, amount_cents, ledger_id, title, account_id) = row?;
    if !event_matches_account(filter_scope, main_id, Some(account_id.as_str())) {
      continue;
    }
    let event_id = if let Some(ref lid) = ledger_id {
      format!("ledger:income:{lid}")
    } else {
      format!("income_actual:{forecast_id}:{occurrence_date}")
    };
    if events.iter().any(|e| e.id == event_id) {
      continue;
    }
    events.push(TimelineEvent {
      id: event_id,
      r#type: "income".into(),
      date: occurrence_date,
      title,
      amount_cents,
      account_id: Some(account_id.clone()),
      account_name: Some(account_name_of(names, &account_id)),
      internal_transfer: false,
    });
  }
  Ok(())
}

pub(crate) fn build_dashboard_month_events(
  conn: &Connection,
  month: &str,
  account_id: &Option<String>,
  period: &DashboardPeriod,
  cal_range_start: &str,
  cal_range_end: &str,
) -> AppResult<DashboardEventBuild> {
  let event_start = period.period_start.clone();
  let event_end = period.period_end.clone();
  let names = account_name_map(conn)?;
  let liquid_flags = account_liquid_map(conn)?;
  let main_id = get_main_account_id(conn)?;
  let main_name = account_name_of(&names, &main_id);
  let filter_scope = account_filter_scope(conn, account_id)?;

  let mut out = DashboardEventBuild {
    events: Vec::new(),
    income_sum: 0,
    fixed_costs_sum: 0,
    variable_costs_sum: 0,
    buys_sum: 0,
    transfers_sum: 0,
  };

  let ledger_start = crate::dashboard_period::day_before(&event_start)
    .unwrap_or_else(|_| event_start.clone());
  let mut stmt = conn.prepare(
    "SELECT id, kind, title, amount_cents, date, account_id, from_account_id, to_account_id, variable_cost_id, source_id, notes, internal_transfer
     FROM ledger_transactions WHERE date >= ?1 AND date <= ?2 ORDER BY date ASC",
  )?;
  let rows = stmt.query_map(params![ledger_start.clone(), event_end.clone()], |r| {
    Ok((
      r.get::<_, String>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, String>(2)?,
      r.get::<_, i64>(3)?,
      r.get::<_, String>(4)?,
      r.get::<_, Option<String>>(5)?,
      r.get::<_, Option<String>>(6)?,
      r.get::<_, Option<String>>(7)?,
      r.get::<_, Option<String>>(8)?,
      r.get::<_, Option<String>>(9)?,
      r.get::<_, Option<String>>(10)?,
      r.get::<_, i64>(11)?,
    ))
  })?;
  for row in rows {
    let (id, kind, title, amount_cents, ev_date, acc, from_id, to_id, variable_cost_id, source_id, notes, internal_transfer) = row?;
    if kind == "adjustment" {
      continue;
    }
    if kind == "expense"
      && should_hide_categorized_variable_cost_event(variable_cost_id.as_deref(), &ev_date)?
    {
      continue;
    }
    let aid = acc.as_deref().unwrap_or("");
    if should_skip_prognostic_income_ledger(&conn, &kind, source_id.as_deref(), &id, notes.as_deref())? {
      continue;
    }
    if kind == "transfer" || internal_transfer != 0 {
      let from = from_id.as_deref().unwrap_or("");
      let to = to_id.as_deref().unwrap_or("");
      let transfer_title = format!(
        "Transfer: {} → {}",
        account_name_of(&names, from),
        account_name_of(&names, to),
      );
      if filter_scope.is_some() {
        if crate::accounts::scope_contains(&filter_scope, from) {
          out.events.push(TimelineEvent {
            id: format!("ledger:transfer:{}", id),
            r#type: "transfer".into(),
            date: ev_date,
            title: transfer_title.clone(),
            amount_cents: -amount_cents,
            account_id: Some(from.to_string()),
            account_name: Some(account_name_of(&names, from)),
            internal_transfer: true,
          });
        } else if crate::accounts::scope_contains(&filter_scope, to) {
          out.events.push(TimelineEvent {
            id: format!("ledger:transfer:{}", id),
            r#type: "transfer".into(),
            date: ev_date,
            title: transfer_title,
            amount_cents,
            account_id: Some(to.to_string()),
            account_name: Some(account_name_of(&names, to)),
            internal_transfer: true,
          });
        }
      } else {
        let from_liquid = liquid_flags.get(from).copied().unwrap_or(false);
        let to_liquid = liquid_flags.get(to).copied().unwrap_or(false);
        let (flow_amount, mapped_account, display_amount) = match (from_liquid, to_liquid) {
          (true, false) => (-amount_cents, Some(from.to_string()), amount_cents.abs()),
          (false, true) => (amount_cents, Some(to.to_string()), amount_cents.abs()),
          (true, true) | (false, false) => (0i64, None, amount_cents.abs()),
        };
        out.events.push(TimelineEvent {
          id: format!("ledger:transfer:{}", id),
          r#type: "transfer".into(),
          date: ev_date,
          title: transfer_title,
          amount_cents: if flow_amount == 0 {
            display_amount
          } else {
            flow_amount
          },
          account_id: mapped_account,
          account_name: Some(format!("{} → {}", account_name_of(&names, from), account_name_of(&names, to))),
          internal_transfer: true,
        });
      }
      continue;
    }
    if !event_matches_account(&filter_scope, &main_id, Some(aid)) {
      continue;
    }
    if kind == "buy_apply" {
      out.buys_sum += amount_cents.abs();
    }
    if kind == "income" {
      let Some(event_date) = income_event_date_in_period(
        conn,
        &id,
        &ev_date,
        source_id.as_deref(),
        notes.as_deref(),
        &event_start,
        &event_end,
      )?
      else {
        continue;
      };
      out.events.push(TimelineEvent {
        id: format!("ledger:{}:{}", kind, id),
        r#type: kind,
        date: event_date,
        title,
        amount_cents,
        account_id: acc.clone(),
        account_name: Some(account_name_of(&names, aid)),
        internal_transfer: false,
      });
      continue;
    }
    if ev_date.as_str() < event_start.as_str() || ev_date.as_str() > event_end.as_str() {
      continue;
    }
    out.events.push(TimelineEvent {
      id: format!("ledger:{}:{}", kind, id),
      r#type: kind,
      date: ev_date,
      title,
      amount_cents,
      account_id: acc.clone(),
      account_name: Some(account_name_of(&names, aid)),
      internal_transfer: false,
    });
  }

  append_primary_employer_income_for_range(
    &conn,
    &event_start,
    &event_end,
    &filter_scope,
    &main_id,
    &names,
    &mut out.events,
  )?;

  append_booked_income_actuals_for_range(
    &conn,
    &event_start,
    &event_end,
    &filter_scope,
    &main_id,
    &names,
    &mut out.events,
  )?;

  if event_matches_account(&filter_scope, &main_id, Some(main_id.as_str())) {
    push_unbooked_income_events_for_range(
      conn,
      &event_start,
      &event_end,
      month,
      &main_id,
      &main_name,
      &mut out.events,
      &mut out.income_sum,
    )?;
  }

  push_fixed_cost_events_for_range(
    conn,
    &names,
    &event_start,
    &event_end,
    account_id,
    &main_id,
    &mut out.events,
    &mut out.fixed_costs_sum,
    200,
  )?;

  if event_matches_account(&filter_scope, &main_id, Some(main_id.as_str())) {
    push_variable_cost_events_for_period(
      conn,
      &event_start,
      &event_end,
      &main_id,
      &main_name,
      &mut out.events,
      &mut out.variable_costs_sum,
    )?;

    let mut month_cursor = event_start[..7].to_string();
    let end_month = event_end[..7].to_string();
    loop {
      let mut stmt2 = conn.prepare(
        "SELECT id, name, amount_cents FROM buy_items WHERE status='parked' AND planned_month = ?1",
      )?;
      for row in stmt2.query_map(params![month_cursor.clone()], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
      })? {
        let (id, name, amount_cents) = row?;
        out.buys_sum += amount_cents;
        out.events.push(TimelineEvent {
          id: format!("buy_planned:{}:{}", id, month_cursor),
          r#type: "buy_planned".into(),
          date: format!("{}-01", month_cursor),
          title: format!("{name} (geplant)"),
          amount_cents: -amount_cents,
          account_id: Some(main_id.clone()),
          account_name: Some(main_name.clone()),
          internal_transfer: false,
        });
      }
      if month_cursor >= end_month {
        break;
      }
      month_cursor = month_add_iso(&month_cursor, 1).unwrap_or(month_cursor);
    }
  }

  if let Some(ref fid) = account_id {
    if account_balance_source(conn, fid)? == "stock_portfolio" {
      push_depot_stock_purchase_events(
        conn,
        &names,
        fid,
        cal_range_start,
        cal_range_end,
        &mut out.events,
        true,
        &mut out.buys_sum,
      )?;
    }
  }

  out.events.sort_by(|a, b| a.date.cmp(&b.date).then(a.title.cmp(&b.title)));
  dedupe_income_events(&mut out.events);
  out.transfers_sum = ledger_transfers_in_range(conn, &event_start, &event_end)?;
  calc_log!(
    "dashboard_events",
    "build_dashboard_month_events",
    "month={}, period={}..{}, events={}, income_sum={}, fixed={}, variable={}, buys={}, transfers={}",
    month,
    event_start,
    event_end,
    out.events.len(),
    out.income_sum,
    out.fixed_costs_sum,
    out.variable_costs_sum,
    out.buys_sum,
    out.transfers_sum
  );
  Ok(out)
}

pub(crate) fn booked_fixed_costs_in_range(
  conn: &Connection,
  range_start: &str,
  range_end: &str,
  filter_scope: &Option<crate::accounts::AccountFilterScope>,
  main_id: &str,
) -> AppResult<i64> {
  let mut stmt = conn.prepare(
    "SELECT amount_cents, account_id FROM ledger_transactions
     WHERE kind = 'expense' AND fixed_cost_id IS NOT NULL AND date >= ?1 AND date <= ?2",
  )?;
  let mut sum = 0i64;
  for row in stmt.query_map(params![range_start, range_end], |r| {
    Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?))
  })? {
    let (amount, account_id) = row?;
    let aid = account_id.as_deref().unwrap_or("");
    if event_matches_account(filter_scope, main_id, Some(aid)) {
      sum += amount.abs();
    }
  }
  Ok(sum)
}

pub(crate) fn booked_variable_costs_in_range(
  conn: &Connection,
  range_start: &str,
  range_end: &str,
  filter_scope: &Option<crate::accounts::AccountFilterScope>,
  main_id: &str,
) -> AppResult<i64> {
  let mut stmt = conn.prepare(
    "SELECT amount_cents, account_id FROM ledger_transactions
     WHERE kind = 'expense' AND variable_cost_id IS NOT NULL AND date >= ?1 AND date <= ?2",
  )?;
  let mut sum = 0i64;
  for row in stmt.query_map(params![range_start, range_end], |r| {
    Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?))
  })? {
    let (amount, account_id) = row?;
    let aid = account_id.as_deref().unwrap_or("");
    if event_matches_account(filter_scope, main_id, Some(aid)) {
      sum += amount.abs();
    }
  }
  Ok(sum)
}
