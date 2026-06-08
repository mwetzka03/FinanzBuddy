use super::forecast_fixed::{fixed_cost_occurrence_booked, load_active_fixed_costs};
use super::forecast_variable::{
  load_variable_cost_templates, sum_categorized_transactions_for_month, variable_costs_active_month,
};
use super::helpers::{account_filter_scope, event_matches_account, iso_date};
use crate::error::{AppError, AppResult};
use crate::logic::{generate_occurrences_with_due_rule_rp, month_bounds};
use rusqlite::Connection;

pub(crate) fn remaining_variable_costs_cents(
  conn: &Connection,
  month: &str,
  account_filter: &Option<String>,
  main_id: &str,
) -> AppResult<i64> {
  if !variable_costs_active_month(month) {
    return Ok(0);
  }
  let scope = account_filter_scope(conn, account_filter)?;
  let mut total = 0i64;
  for t in load_variable_cost_templates(conn)? {
    if !event_matches_account(&scope, main_id, Some(t.account_id.as_str())) {
      continue;
    }
    let spent = sum_categorized_transactions_for_month(conn, &t.id, month)?;
    total += (t.amount_cents - spent).max(0);
  }
  Ok(total)
}

pub(crate) fn remaining_fixed_costs_cents(
  conn: &Connection,
  month: &str,
  account_filter: &Option<String>,
  main_id: &str,
) -> AppResult<i64> {
  let (start, end) = month_bounds(month).ok_or_else(|| AppError::Invalid("invalid month".into()))?;
  let range_start = iso_date(start);
  let range_end = iso_date(end);
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
      &range_start,
      &range_end,
      200,
      end_charge_date.as_deref(),
    );
    for d in occ {
      if fixed_cost_occurrence_booked(conn, &id, &d, &cadence)? {
        continue;
      }
      total += amount_cents;
    }
  }
  Ok(total)
}
