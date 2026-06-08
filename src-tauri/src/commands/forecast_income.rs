use crate::accounts::get_main_account_id;
use crate::error::AppResult;
use crate::income_actuals::{
  actual_amount_for_occurrence, effective_income_amount, income_forecast_source_id,
  is_prognostic_income_ledger,
};
use crate::logic::generate_occurrences_with_due_rule_rp;
use crate::models::TimelineEvent;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use super::dashboard_events::primary_employer_ledger_exists_near_date;

pub(crate) fn income_occurrence_booked(conn: &rusqlite::Connection, forecast_id: &str, occurrence_date: &str) -> AppResult<bool> {
  if actual_amount_for_occurrence(conn, forecast_id, occurrence_date)?.is_some() {
    return Ok(true);
  }
  let linked: i64 = conn.query_row(
    "SELECT COUNT(*) FROM income_forecast_actuals
     WHERE income_forecast_id = ?1 AND occurrence_date = ?2 AND ledger_transaction_id IS NOT NULL",
    params![forecast_id, occurrence_date],
    |r| r.get(0),
  )?;
  if linked > 0 {
    return Ok(true);
  }
  let source_id = income_forecast_source_id(forecast_id, occurrence_date);
  let ledger_row: Option<(String, String)> = conn
    .query_row(
      "SELECT id, source_id FROM ledger_transactions WHERE source_id = ?1 LIMIT 1",
      params![source_id],
      |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?;
  if let Some((_ledger_id, sid)) = ledger_row {
    if crate::accounts::get_primary_income_forecast_id(conn)?.as_deref() == Some(forecast_id) {
      return Ok(true);
    }
    return Ok(!is_prognostic_income_ledger(conn, &sid)?);
  }
  if crate::accounts::get_primary_income_forecast_id(conn)?.as_deref() == Some(forecast_id)
    && primary_employer_ledger_exists_near_date(conn, occurrence_date)?
  {
    return Ok(true);
  }
  let legacy: i64 = conn.query_row(
    "SELECT COUNT(*) FROM ledger_transactions WHERE source_id = ?1 AND date = ?2",
    params![forecast_id, occurrence_date],
    |r| r.get(0),
  )?;
  Ok(legacy > 0)
}

pub(crate) struct IncomeForecastTemplate {
  id: String,
  name: String,
  amount_cents: i64,
  cadence: String,
  first_charge_date: String,
  due_rule: String,
  day_of_month: Option<i64>,
  end_charge_date: Option<String>,
}

pub(crate) fn load_income_forecast_templates(conn: &rusqlite::Connection) -> AppResult<Vec<IncomeForecastTemplate>> {
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents, cadence, first_charge_date, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date
     FROM income_forecasts WHERE COALESCE(active, 1) = 1",
  )?;
  let rows = stmt
    .query_map([], |r| {
      Ok(IncomeForecastTemplate {
        id: r.get(0)?,
        name: r.get(1)?,
        amount_cents: r.get(2)?,
        cadence: r.get(3)?,
        first_charge_date: r.get(4)?,
        due_rule: r.get(5)?,
        day_of_month: r.get(6)?,
        end_charge_date: r.get(7)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

pub(crate) fn income_forecast_occurrences(
  template: &IncomeForecastTemplate,
  range_start: &str,
  range_end: &str,
  limit: usize,
) -> Vec<String> {
  generate_occurrences_with_due_rule_rp(
    &template.first_charge_date,
    &template.cadence,
    &template.due_rule,
    template.day_of_month.and_then(|x| if x > 0 { Some(x as u32) } else { None }),
    range_start,
    range_end,
    limit,
    template.end_charge_date.as_deref().filter(|s| !s.is_empty()),
  )
}

pub(crate) fn materialize_due_income_forecasts(conn: &rusqlite::Connection) -> AppResult<()> {
  let main_id = get_main_account_id(conn)?;
  let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();

  for t in load_income_forecast_templates(conn)? {
    let occ = income_forecast_occurrences(&t, &t.first_charge_date, &today, 5000);
    for date in occ {
      if date.as_str() > today.as_str() {
        continue;
      }
      if income_occurrence_booked(conn, &t.id, &date)? {
        continue;
      }
      let (amount, is_actual) = effective_income_amount(conn, &t.id, &date, t.amount_cents)?;
      let ledger_id = Uuid::new_v4().to_string();
      let now = Utc::now().to_rfc3339();
      let title = if is_actual {
        if t.name.trim().is_empty() {
          "Einnahme (Ist)".into()
        } else {
          t.name.clone()
        }
      } else {
        income_forecast_title(&t.name)
      };
      let source_id = income_forecast_source_id(&t.id, &date);
      conn.execute(
        "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'income', ?5, NULL, ?6, ?7)",
        params![ledger_id, date, amount.abs(), main_id, title, source_id, now],
      )?;
    }
  }
  Ok(())
}

pub(crate) fn income_forecasts_forecast_until(conn: &rusqlite::Connection, cutoff_inclusive: &str) -> AppResult<i64> {
  let mut sum: i64 = 0;
  for t in load_income_forecast_templates(conn)? {
    let occ = income_forecast_occurrences(&t, &t.first_charge_date, cutoff_inclusive, 5000);
    for date in occ {
      if date.as_str() > cutoff_inclusive {
        continue;
      }
      if !income_occurrence_booked(conn, &t.id, &date)? {
        let (amount, _) = effective_income_amount(conn, &t.id, &date, t.amount_cents)?;
        sum += amount;
      }
    }
  }
  Ok(sum)
}

pub(crate) fn push_unbooked_income_events_for_range(
  conn: &rusqlite::Connection,
  range_start: &str,
  range_end: &str,
  _accounting_month: &str,
  main_id: &str,
  main_name: &str,
  events: &mut Vec<TimelineEvent>,
  income_sum: &mut i64,
) -> AppResult<()> {
  for t in load_income_forecast_templates(conn)? {
    let occ = income_forecast_occurrences(&t, range_start, range_end, 500);
    for ev_date in occ {
      if income_occurrence_booked(conn, &t.id, &ev_date)? {
        continue;
      }
      let event_id = format!("income:{}:{}", t.id, ev_date);
      if events.iter().any(|e| e.id == event_id) {
        continue;
      }
      let (amount, is_actual) = effective_income_amount(conn, &t.id, &ev_date, t.amount_cents)?;
      if ev_date.as_str() >= range_start && ev_date.as_str() <= range_end {
        *income_sum += amount;
      }
      events.push(TimelineEvent {
        id: event_id,
        r#type: "income".into(),
        date: ev_date,
        title: if is_actual {
          if t.name.trim().is_empty() {
            "Einnahmen (Ist)".into()
          } else {
            t.name.clone()
          }
        } else if t.name.trim().is_empty() {
          "Einnahmen (Prognose)".into()
        } else {
          format!("{} (Prognose)", t.name)
        },
        amount_cents: amount,
        account_id: Some(main_id.to_string()),
        account_name: Some(main_name.to_string()),
        internal_transfer: false,
      });
    }
  }
  Ok(())
}

pub(crate) fn income_forecast_title(name: &str) -> String {
  if name.trim().is_empty() {
    "Einnahme (Prognose)".into()
  } else {
    name.to_string()
  }
}

