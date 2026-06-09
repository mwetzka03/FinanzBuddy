use super::forecast_fixed::sum_remaining_fixed_costs_in_range;
use super::forecast_variable::sum_variable_cost_prognosis_for_period;
use crate::error::AppResult;
use chrono::Utc;
use rusqlite::Connection;

pub(crate) fn remaining_variable_costs_cents(
  conn: &Connection,
  period_start: &str,
  period_end: &str,
  account_filter: &Option<String>,
  main_id: &str,
) -> AppResult<i64> {
  let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();
  if today.as_str() < period_start || today.as_str() > period_end {
    return Ok(0);
  }
  sum_variable_cost_prognosis_for_period(conn, period_start, period_end, account_filter, main_id, true)
}

pub(crate) fn remaining_fixed_costs_cents(
  conn: &Connection,
  range_start: &str,
  range_end: &str,
  account_filter: &Option<String>,
  main_id: &str,
) -> AppResult<i64> {
  sum_remaining_fixed_costs_in_range(conn, range_start, range_end, account_filter, main_id, 200)
}
