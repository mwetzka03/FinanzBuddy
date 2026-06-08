use crate::calc_log::calc_log;
use crate::dashboard_flow::{aggregate_liquid_flows, aggregate_period_flows, end_balance_from_start, PeriodFlowTotals};
use crate::dashboard_period::{
  balance_scope_account_ids, dashboard_min_month, setup_opening_balance_total_cents,
  setup_opening_liquid_total_cents,
};
use crate::error::AppResult;
use crate::logic::month_add_iso;
use crate::models::TimelineEvent;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct DashboardMonthBalances {
  pub start_balance_cents: i64,
  pub start_liquid_cents: i64,
}

pub struct MonthPeriodInput {
  pub month: String,
  pub period_start: String,
  pub period_end: String,
  pub events: Vec<TimelineEvent>,
}

pub fn compute_dashboard_chain(
  conn: &Connection,
  from_month: &str,
  to_month: &str,
  account_filter: &Option<String>,
  filter_scope: &Option<crate::accounts::AccountFilterScope>,
  liquid_account_ids: &HashSet<String>,
  months: &[MonthPeriodInput],
) -> AppResult<HashMap<String, DashboardMonthBalances>> {
  let scope_ids = balance_scope_account_ids(conn, account_filter, filter_scope)?;
  let all_accounts = account_filter.is_none();
  let setup_start = setup_opening_balance_total_cents(conn, &scope_ids)?;
  let setup_liquid = setup_opening_liquid_total_cents(conn, &scope_ids)?;

  let mut results = HashMap::new();
  let mut prev_end: Option<i64> = None;
  let mut prev_liquid_end: Option<i64> = None;
  let min_month = dashboard_min_month(conn)?;

  for input in months {
    if input.month.as_str() < from_month || input.month.as_str() > to_month {
      continue;
    }

    let is_first = input.month == min_month;
    let include_transfers = !all_accounts;
    let flows = aggregate_period_flows(
      &input.events,
      &input.period_start,
      &input.period_end,
      include_transfers,
    );

    let (start_balance, start_liquid) = if is_first {
      (setup_start, setup_liquid)
    } else {
      (
        prev_end.unwrap_or(setup_start),
        prev_liquid_end.unwrap_or(setup_liquid),
      )
    };

    let end_balance = end_balance_from_start(start_balance, &flows);

    let liquid_flows = if all_accounts {
      aggregate_liquid_flows(
        &input.events,
        &input.period_start,
        &input.period_end,
        liquid_account_ids,
        true,
      )
    } else {
      PeriodFlowTotals::default()
    };
    let end_liquid = if all_accounts {
      end_balance_from_start(start_liquid, &liquid_flows)
    } else {
      0
    };

    let snapshot = DashboardMonthBalances {
      start_balance_cents: start_balance,
      start_liquid_cents: if all_accounts { start_liquid } else { 0 },
    };

    prev_end = Some(end_balance);
    prev_liquid_end = Some(end_liquid);
    results.insert(input.month.clone(), snapshot);
    calc_log!(
      "dashboard_compute",
      "compute_dashboard_chain",
      "month={}, period={}..{}, start_balance={}, end_balance={}, income={}, expense={}",
      input.month,
      input.period_start,
      input.period_end,
      start_balance,
      end_balance,
      flows.income_cents,
      flows.expense_cents
    );
  }

  calc_log!(
    "dashboard_compute",
    "compute_dashboard_chain",
    "from_month={}, to_month={}, results={}",
    from_month,
    to_month,
    results.len()
  );
  Ok(results)
}

/// Saldo-Kette entlang eindeutiger Gehaltszeiträume (Schlüssel = period_start).
pub fn compute_salary_period_chain(
  conn: &Connection,
  to_period_start: &str,
  account_filter: &Option<String>,
  filter_scope: &Option<crate::accounts::AccountFilterScope>,
  liquid_account_ids: &HashSet<String>,
  inputs: &[MonthPeriodInput],
) -> AppResult<HashMap<String, DashboardMonthBalances>> {
  let scope_ids = balance_scope_account_ids(conn, account_filter, filter_scope)?;
  let all_accounts = account_filter.is_none();
  let setup_start = setup_opening_balance_total_cents(conn, &scope_ids)?;
  let setup_liquid = setup_opening_liquid_total_cents(conn, &scope_ids)?;

  let mut results = HashMap::new();
  let mut prev_end: Option<i64> = None;
  let mut prev_liquid_end: Option<i64> = None;
  let first_start = inputs.first().map(|i| i.period_start.as_str()).unwrap_or("");

  for input in inputs {
    if input.period_start.as_str() > to_period_start {
      continue;
    }

    let is_first = input.period_start == first_start;
    let include_transfers = !all_accounts;
    let flows = aggregate_period_flows(
      &input.events,
      &input.period_start,
      &input.period_end,
      include_transfers,
    );

    let (start_balance, start_liquid) = if is_first {
      (setup_start, setup_liquid)
    } else {
      (
        prev_end.unwrap_or(setup_start),
        prev_liquid_end.unwrap_or(setup_liquid),
      )
    };

    let end_balance = end_balance_from_start(start_balance, &flows);

    let liquid_flows = if all_accounts {
      aggregate_liquid_flows(
        &input.events,
        &input.period_start,
        &input.period_end,
        liquid_account_ids,
        true,
      )
    } else {
      PeriodFlowTotals::default()
    };
    let end_liquid = if all_accounts {
      end_balance_from_start(start_liquid, &liquid_flows)
    } else {
      0
    };

    let snapshot = DashboardMonthBalances {
      start_balance_cents: start_balance,
      start_liquid_cents: if all_accounts { start_liquid } else { 0 },
    };

    prev_end = Some(end_balance);
    prev_liquid_end = Some(end_liquid);
    results.insert(input.period_start.clone(), snapshot);
    calc_log!(
      "dashboard_compute",
      "compute_salary_period_chain",
      "period_start={}, period={}..{}, start_balance={}, end_balance={}, income={}, expense={}",
      input.period_start,
      input.period_start,
      input.period_end,
      start_balance,
      end_balance,
      flows.income_cents,
      flows.expense_cents
    );
  }

  calc_log!(
    "dashboard_compute",
    "compute_salary_period_chain",
    "to_period_start={}, results={}",
    to_period_start,
    results.len()
  );
  Ok(results)
}

pub fn months_from_to(from: &str, to: &str) -> Vec<String> {
  let mut out = Vec::new();
  let mut current = from.to_string();
  loop {
    out.push(current.clone());
    if current == to {
      break;
    }
    current = month_add_iso(&current, 1).unwrap_or(current);
    if out.len() > 600 {
      break;
    }
  }
  out
}
