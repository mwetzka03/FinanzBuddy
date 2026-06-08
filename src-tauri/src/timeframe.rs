use crate::error::{AppError, AppResult};
use crate::logic::generate_occurrences_with_due_rule_rp;

pub const INCOME_DATE_FIRST_BUSINESS_DAY: i32 = 0;
pub const INCOME_DATE_LAST_BUSINESS_DAY: i32 = 99;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeframeConfig {
  pub is_timeframe_month: bool,
  pub income_date: i32,
}

pub fn is_valid_income_date(income_date: i32) -> bool {
  income_date == INCOME_DATE_FIRST_BUSINESS_DAY
    || income_date == INCOME_DATE_LAST_BUSINESS_DAY
    || (1..=31).contains(&income_date)
}

pub fn income_date_is_first_business_day(income_date: i32) -> bool {
  income_date == INCOME_DATE_FIRST_BUSINESS_DAY
}

pub fn income_date_is_last_business_day(income_date: i32) -> bool {
  income_date == INCOME_DATE_LAST_BUSINESS_DAY
}

pub fn income_date_is_calendar_day(income_date: i32) -> bool {
  (1..=31).contains(&income_date)
}

pub fn due_rule_from_income_date(income_date: i32) -> AppResult<(&'static str, Option<u32>)> {
  if income_date_is_first_business_day(income_date) {
    return Ok(("first_business_day", None));
  }
  if income_date_is_last_business_day(income_date) {
    return Ok(("last_business_day", None));
  }
  if income_date_is_calendar_day(income_date) {
    return Ok(("calendar_day", Some(income_date as u32)));
  }
  Err(AppError::Invalid(format!("income_date invalid: {income_date}")))
}

pub fn income_date_from_due_rule(due_rule: &str, day_of_month: Option<i64>) -> i32 {
  match due_rule {
    "first_business_day" => INCOME_DATE_FIRST_BUSINESS_DAY,
    "last_business_day" => INCOME_DATE_LAST_BUSINESS_DAY,
    "calendar_day" => day_of_month
      .and_then(|d| (1..=31).contains(&d).then_some(d as i32))
      .unwrap_or(1),
    _ => INCOME_DATE_LAST_BUSINESS_DAY,
  }
}

pub fn generate_income_boundary_dates(
  range_start: &str,
  range_end: &str,
  income_date: i32,
) -> AppResult<Vec<String>> {
  let (due_rule, day_of_month) = due_rule_from_income_date(income_date)?;
  Ok(generate_occurrences_with_due_rule_rp(
    range_start,
    "monthly",
    due_rule,
    day_of_month,
    range_start,
    range_end,
    50,
    None,
  ))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn maps_due_rules_to_income_date() {
    assert_eq!(income_date_from_due_rule("first_business_day", None), 0);
    assert_eq!(income_date_from_due_rule("last_business_day", None), 99);
    assert_eq!(income_date_from_due_rule("calendar_day", Some(15)), 15);
  }

  #[test]
  fn last_business_day_boundaries_match_salary_periods() {
    let boundaries = generate_income_boundary_dates("2026-03-31", "2026-08-31", 99).unwrap();
    assert_eq!(boundaries[0], "2026-03-31");
    assert_eq!(boundaries[1], "2026-04-30");
    assert_eq!(boundaries[2], "2026-05-29");
  }
}
