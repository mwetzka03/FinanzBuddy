use crate::cost_assignment::count_fixed_cost_bookings_in_range;
use super::helpers::{account_filter_scope, account_name_of, event_matches_account, iso_date, month_from_date};
use crate::error::{AppError, AppResult};
use crate::logic::{generate_occurrences_with_due_rule_rp, month_bounds};
use crate::models::TimelineEvent;
use rusqlite::{params, Connection};

pub(crate) fn load_active_fixed_costs(
  conn: &rusqlite::Connection,
  main_id: &str,
) -> AppResult<
  Vec<(
    String,
    String,
    i64,
    String,
    String,
    String,
    Option<i64>,
    Option<String>,
    String,
  )>,
> {
  let mut stmt = conn.prepare(
    "SELECT id, name, amount_cents, cadence, first_charge_date, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date, COALESCE(account_id, ?1) FROM fixed_costs WHERE active = 1",
  )?;
  let rows = stmt
    .query_map(params![main_id], |r| {
      Ok((
        r.get(0)?,
        r.get(1)?,
        r.get(2)?,
        r.get(3)?,
        r.get(4)?,
        r.get(5)?,
        r.get::<_, Option<i64>>(6)?,
        r.get::<_, Option<String>>(7)?,
        r.get(8)?,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

pub(crate) fn sum_remaining_fixed_costs_in_range(
  conn: &rusqlite::Connection,
  range_start: &str,
  range_end: &str,
  account_filter: &Option<String>,
  main_id: &str,
  max_occurrences: usize,
) -> AppResult<i64> {
  let scope = account_filter_scope(conn, account_filter)?;
  let mut total = 0i64;
  for row in load_active_fixed_costs(conn, main_id)? {
    let (
      id,
      _name,
      amount_cents,
      cadence,
      first_charge_date,
      due_rule,
      day_of_month,
      end_charge_date,
      fc_account_id,
    ) = row;
    if !event_matches_account(&scope, main_id, Some(fc_account_id.as_str())) {
      continue;
    }
    let occ = generate_occurrences_with_due_rule_rp(
      &first_charge_date,
      &cadence,
      &due_rule,
      day_of_month.and_then(|x| if x > 0 { Some(x as u32) } else { None }),
      range_start,
      range_end,
      max_occurrences,
      end_charge_date.as_deref(),
    );
    let booked_in_range = if cadence == "weekly" || cadence == "biweekly" {
      count_fixed_cost_bookings_in_range(conn, &id, range_start, range_end)?
    } else {
      0
    };
    for (idx, d) in occ.iter().enumerate() {
      if cadence == "weekly" || cadence == "biweekly" {
        if idx < booked_in_range {
          continue;
        }
      } else if fixed_cost_occurrence_booked(conn, &id, d, &cadence)? {
        continue;
      }
      total += amount_cents;
    }
  }
  Ok(total)
}

pub(crate) fn push_fixed_cost_events_for_range(
  conn: &rusqlite::Connection,
  names: &std::collections::HashMap<String, String>,
  range_start: &str,
  range_end: &str,
  account_filter: &Option<String>,
  main_id: &str,
  events: &mut Vec<TimelineEvent>,
  total: &mut i64,
  max_occurrences: usize,
) -> AppResult<()> {
  let scope = account_filter_scope(conn, account_filter)?;
  for row in load_active_fixed_costs(conn, main_id)? {
    let (
      id,
      name,
      amount_cents,
      cadence,
      first_charge_date,
      due_rule,
      day_of_month,
      end_charge_date,
      fc_account_id,
    ) = row;
    if !event_matches_account(&scope, main_id, Some(fc_account_id.as_str())) {
      continue;
    }
    let occ = generate_occurrences_with_due_rule_rp(
      &first_charge_date,
      &cadence,
      &due_rule,
      day_of_month.and_then(|x| if x > 0 { Some(x as u32) } else { None }),
      range_start,
      range_end,
      max_occurrences,
      end_charge_date.as_deref(),
    );
    let booked_in_range = if cadence == "weekly" || cadence == "biweekly" {
      count_fixed_cost_bookings_in_range(conn, &id, range_start, range_end)?
    } else {
      0
    };
    for (idx, d) in occ.iter().enumerate() {
      if cadence == "weekly" || cadence == "biweekly" {
        if idx < booked_in_range {
          continue;
        }
      } else if fixed_cost_occurrence_booked(conn, &id, d, &cadence)? {
        continue;
      }
      *total += amount_cents;
      events.push(TimelineEvent {
        id: format!("fixed_cost:{}:{}", id, d),
        r#type: "fixed_cost".into(),
        date: d.clone(),
        title: name.clone(),
        amount_cents: -amount_cents,
        account_id: Some(fc_account_id.clone()),
        account_name: Some(account_name_of(names, &fc_account_id)),
        internal_transfer: false,
        fixed_cost_id: None,
      variable_cost_id: None,
      buy_item_id: None,
      notes: None,
      });
    }
  }
  Ok(())
}

pub(crate) fn fixed_cost_occurrences_until(conn: &rusqlite::Connection, cutoff_inclusive: &str) -> AppResult<i64> {
  let mut sum: i64 = 0;
  let mut stmt = conn.prepare(
    "SELECT amount_cents, cadence, first_charge_date, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date FROM fixed_costs WHERE active = 1",
  )?;
  let rows = stmt.query_map([], |r| {
    Ok((
      r.get::<_, i64>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, String>(2)?,
      r.get::<_, String>(3)?,
      r.get::<_, Option<i64>>(4)?,
      r.get::<_, Option<String>>(5)?,
    ))
  })?;
  for row in rows {
    let (amount_cents, cadence, first_charge_date, due_rule, day_of_month, end_charge_date) = row?;
    let occ = generate_occurrences_with_due_rule_rp(
      &first_charge_date,
      &cadence,
      &due_rule,
      day_of_month.and_then(|x| if x > 0 { Some(x as u32) } else { None }),
      &first_charge_date,
      cutoff_inclusive,
      5000,
      end_charge_date.as_deref(),
    );
    sum += amount_cents * occ.len() as i64;
  }
  Ok(sum)
}

pub(crate) fn sum_fixed_cost_bookings_for_month(
  conn: &Connection,
  fixed_cost_id: &str,
  month: &str,
) -> AppResult<i64> {
  let (start, end) = month_bounds(month).ok_or_else(|| AppError::Invalid("invalid month".into()))?;
  let range_start = iso_date(start);
  let range_end = iso_date(end);
  let sum: i64 = conn.query_row(
    "SELECT COALESCE(SUM(ABS(amount_cents)), 0) FROM ledger_transactions
     WHERE fixed_cost_id = ?1 AND kind = 'expense' AND date >= ?2 AND date <= ?3",
    params![fixed_cost_id, range_start, range_end],
    |r| r.get(0),
  )?;
  Ok(sum)
}

pub(crate) fn fixed_cost_occurrence_booked(
  conn: &Connection,
  fixed_cost_id: &str,
  occurrence_date: &str,
  cadence: &str,
) -> AppResult<bool> {
  if cadence == "monthly" || cadence == "yearly" || cadence == "once" {
    let month = month_from_date(occurrence_date)?;
    return Ok(sum_fixed_cost_bookings_for_month(conn, fixed_cost_id, &month)? > 0);
  }
  let n: i64 = conn.query_row(
    "SELECT COUNT(*) FROM ledger_transactions
     WHERE fixed_cost_id = ?1 AND kind = 'expense' AND date = ?2",
    params![fixed_cost_id, occurrence_date],
    |r| r.get(0),
  )?;
  Ok(n > 0)
}

#[cfg(test)]
mod forecast_fixed_tests {
  use super::*;
  use crate::db::{migrate, open_db};
  use crate::models::TimelineEvent;
  use std::path::PathBuf;

  fn test_conn() -> rusqlite::Connection {
    let path = PathBuf::from(std::env::temp_dir()).join(format!(
      "finanzbuddy-fc-forecast-{}.sqlite3",
      uuid::Uuid::new_v4()
    ));
    let _ = std::fs::remove_file(&path);
    let conn = open_db(&path).unwrap();
    migrate(&conn).unwrap();
    conn
      .execute(
        "INSERT INTO accounts (id, name, is_liquid, created_at) VALUES ('acc1', 'Main', 1, datetime('now'))",
        [],
      )
      .unwrap();
    conn
      .execute(
        "INSERT INTO app_settings (key, value) VALUES ('main_account_id', 'acc1')",
        [],
      )
      .unwrap();
    conn
  }

  #[test]
  fn biweekly_fixed_cost_forecast_reduced_by_one_booking_in_period() {
    let conn = test_conn();
    conn
      .execute(
        "INSERT INTO fixed_costs (id, name, amount_cents, cadence, first_charge_date, active, account_id, due_rule)
         VALUES ('fc1', 'Abo', 1000, 'biweekly', '2026-06-01', 1, 'acc1', 'calendar_day')",
        [],
      )
      .unwrap();
    conn
      .execute(
        "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, kind, title, fixed_cost_id, created_at)
         VALUES ('tx1', '2026-06-05', -1000, 'acc1', 'expense', 'Abo', 'fc1', datetime('now'))",
        [],
      )
      .unwrap();

    let mut events = Vec::<TimelineEvent>::new();
    let mut total = 0i64;
    let names = std::collections::HashMap::from([("acc1".to_string(), "Main".to_string())]);
    push_fixed_cost_events_for_range(
      &conn,
      &names,
      "2026-06-01",
      "2026-06-20",
      &None,
      "acc1",
      &mut events,
      &mut total,
      10,
    )
    .unwrap();

    assert_eq!(events.len(), 1, "expected one remaining biweekly forecast in period");
    assert_eq!(total, 1000);

    let remaining = sum_remaining_fixed_costs_in_range(
      &conn,
      "2026-06-01",
      "2026-06-20",
      &None,
      "acc1",
      10,
    )
    .unwrap();
    assert_eq!(remaining, 1000);
  }
}

