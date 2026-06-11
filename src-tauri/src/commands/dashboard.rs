use super::dashboard_events::{
  booked_fixed_costs_in_range, booked_variable_costs_in_range, build_dashboard_month_events,
};
use super::forecast_income::materialize_due_income_forecasts;
use super::forecast_variable::finalize_all_variable_cost_months;
use super::forecast_variable_events::{remaining_fixed_costs_cents, remaining_variable_costs_cents};
use super::helpers::{
  account_balance_source, account_filter_scope, cached_stock_portfolio_cents_if_needed, iso_date,
  to_cmd_result, CmdResult,
};
use super::prognostic::kontostand_total_cents;
use crate::accounts::get_main_account_id;
use crate::calc_log::calc_log;
use crate::dashboard_cache;
use crate::dashboard_compute::{compute_dashboard_chain, compute_salary_period_chain, months_from_to, MonthPeriodInput};
use crate::dashboard_flow::{
  aggregate_all_accounts_card_flows, aggregate_liquid_flows, aggregate_period_flows, aggregate_real_period_flows,
  end_balance_from_start,
};
use crate::dashboard_period::{current_salary_period, list_salary_periods, salary_period_dashboard};
use crate::error::{AppError, AppResult};
use crate::logic::{month_add_iso, month_bounds};
use crate::models::{DashboardPeriodNavItem, MonthView};
use crate::state::AppState;
use chrono::Utc;
use std::collections::HashSet;
use tauri::{Manager, State};

#[tauri::command]
pub fn get_dashboard_settings(state: State<'_, AppState>) -> CmdResult<serde_json::Value> {
  to_cmd_result(get_dashboard_settings_inner(state))
}

fn get_dashboard_settings_inner(state: State<'_, AppState>) -> AppResult<serde_json::Value> {
  let conn = state.conn.lock().unwrap();
  crate::setup::assert_setup_completed(&conn)?;
  let period_mode = crate::accounts::get_dashboard_period_mode(&conn)?;
  let primary_income_forecast_id = crate::accounts::get_primary_income_forecast_id(&conn)?;
  let min_month = crate::dashboard_period::dashboard_min_month(&conn)?;
  let current_period_start = if period_mode == "since_last_salary" {
    current_salary_period(&conn).ok().map(|p| p.period_start)
  } else {
    None
  };
  let min_period_start = if period_mode == "since_last_salary" {
    crate::dashboard_period::min_salary_period_start(&conn)?
  } else {
    None
  };
  let timeframe = crate::accounts::get_timeframe_config(&conn)?;
  Ok(serde_json::json!({
    "periodMode": period_mode,
    "isTimeframeMonth": timeframe.is_timeframe_month,
    "incomeDate": timeframe.income_date,
    "primaryIncomeForecastId": primary_income_forecast_id,
    "minMonth": min_month,
    "currentPeriodStart": current_period_start,
    "minPeriodStart": min_period_start,
  }))
}

#[tauri::command]
pub fn list_dashboard_periods(state: State<'_, AppState>) -> CmdResult<Vec<DashboardPeriodNavItem>> {
  to_cmd_result(list_dashboard_periods_inner(state))
}

fn list_dashboard_periods_inner(state: State<'_, AppState>) -> AppResult<Vec<DashboardPeriodNavItem>> {
  let conn = state.conn.lock().unwrap();
  crate::setup::assert_setup_completed(&conn)?;
  let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();
  Ok(list_salary_periods(&conn)?
    .into_iter()
    .map(|p| {
      let is_current = today.as_str() >= p.period_start.as_str() && today.as_str() <= p.period_end.as_str();
      DashboardPeriodNavItem {
        period_start: p.period_start,
        period_end: p.period_end,
        is_current,
      }
    })
    .collect())
}

#[tauri::command]
pub fn set_timeframe_config(
  state: State<'_, AppState>,
  is_timeframe_month: bool,
  income_date: i32,
) -> CmdResult<()> {
  let conn = state.conn.lock().unwrap();
  crate::accounts::set_timeframe_config(&conn, is_timeframe_month, income_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_dashboard_period_mode(state: State<'_, AppState>, mode: String) -> CmdResult<()> {
  let conn = state.conn.lock().unwrap();
  crate::accounts::set_dashboard_period_mode(&conn, &mode).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_primary_income_forecast(
  state: State<'_, AppState>,
  forecast_id: Option<String>,
) -> CmdResult<()> {
  let conn = state.conn.lock().unwrap();
  crate::accounts::set_primary_income_forecast_id(&conn, forecast_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_month_view(
  state: State<'_, AppState>,
  month: String,
  account_id: Option<String>,
  period_start: Option<String>,
) -> CmdResult<MonthView> {
  to_cmd_result(get_month_view_inner(state, month, account_id, period_start))
}

#[tauri::command]
pub fn refresh_dashboard_cache(state: State<'_, AppState>) -> CmdResult<()> {
  to_cmd_result(refresh_dashboard_cache_inner(state))
}

fn refresh_dashboard_cache_inner(state: State<'_, AppState>) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  crate::setup::assert_setup_completed(&conn)?;
  dashboard_cache::invalidate(&conn)?;
  calc_log!(
    "dashboard_cache",
    "refresh_dashboard_cache",
    "cache cleared"
  );
  Ok(())
}

pub fn warm_dashboard_cache(state: &AppState) -> AppResult<()> {
  {
    let conn = state.conn.lock().unwrap();
    if !crate::setup::is_setup_completed(&conn)? {
      return Ok(());
    }
  }

  let (month, period_start) = {
    let conn = state.conn.lock().unwrap();
    let period_mode = crate::accounts::get_dashboard_period_mode(&conn)?;
    if period_mode == "since_last_salary" {
      let period = current_salary_period(&conn)?;
      let month = if period.period_start.len() >= 7 {
        period.period_start[..7].to_string()
      } else {
        crate::dashboard_period::dashboard_min_month(&conn)?
      };
      (month, Some(period.period_start))
    } else {
      let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();
      let month = if today.len() >= 7 {
        today[..7].to_string()
      } else {
        crate::dashboard_period::dashboard_min_month(&conn)?
      };
      (month, None)
    }
  };

  let view = compute_month_view(state, month.clone(), None, period_start.clone())?;
  let conn = state.conn.lock().unwrap();
  let key = dashboard_cache::cache_key(&month, &None, &period_start);
  dashboard_cache::put(&conn, &key, &view)?;
  calc_log!(
    "dashboard_cache",
    "warm_dashboard_cache",
    "month={}, period_start={:?}, cached=true",
    month,
    period_start
  );
  Ok(())
}

pub fn spawn_warm_dashboard_cache(app: tauri::AppHandle) {
  std::thread::spawn(move || {
    let Some(state) = app.try_state::<AppState>() else {
      return;
    };
    if let Err(e) = warm_dashboard_cache(&state) {
      eprintln!("Dashboard-Cache: Start-Berechnung fehlgeschlagen: {e}");
    }
  });
}

fn get_month_view_inner(
  state: State<'_, AppState>,
  month: String,
  account_id: Option<String>,
  period_start: Option<String>,
) -> AppResult<MonthView> {
  {
    let conn = state.conn.lock().unwrap();
    crate::setup::assert_setup_completed(&conn)?;
    let cache_key = dashboard_cache::cache_key(&month, &account_id, &period_start);
    if let Some(cached) = dashboard_cache::get(&conn, &cache_key)? {
      calc_log!(
        "dashboard_cache",
        "get_month_view",
        "cache_hit key={}",
        cache_key
      );
      return Ok(cached);
    }
  }

  let view = compute_month_view(&state, month.clone(), account_id.clone(), period_start.clone())?;
  let conn = state.conn.lock().unwrap();
  let cache_key = dashboard_cache::cache_key(&month, &account_id, &period_start);
  dashboard_cache::put(&conn, &cache_key, &view)?;
  calc_log!(
    "dashboard_cache",
    "get_month_view",
    "cache_miss key={}, stored=true",
    cache_key
  );
  Ok(view)
}

fn compute_month_view(
  state: &AppState,
  month: String,
  account_id: Option<String>,
  period_start: Option<String>,
) -> AppResult<MonthView> {
  {
    let conn = state.conn.lock().unwrap();
    crate::setup::assert_setup_completed(&conn)?;
  }
  {
    let conn = state.conn.lock().unwrap();
    materialize_due_income_forecasts(&conn)?;
    finalize_all_variable_cost_months(&conn)?;
  }

  let conn = state.conn.lock().unwrap();
  let period_mode = crate::accounts::get_dashboard_period_mode(&conn)?;
  let stock_portfolio_cents = cached_stock_portfolio_cents_if_needed(&state, &conn, &account_id)?;
  let liquid_flags = super::helpers::account_liquid_map(&conn)?;
  let main_id = get_main_account_id(&conn)?;
  let filter_scope = account_filter_scope(&conn, &account_id)?;

  let liquid_account_ids: HashSet<String> = liquid_flags
    .iter()
    .filter(|(_, is_liquid)| **is_liquid)
    .map(|(id, _)| id.clone())
    .collect();

  let (view_month, period, prev_range_end, balances) = if period_mode == "since_last_salary" {
    let all_periods = list_salary_periods(&conn)?;
    let selected_start = period_start
      .or_else(|| current_salary_period(&conn).ok().map(|p| p.period_start))
      .ok_or_else(|| AppError::Invalid("no salary period".into()))?;
    let period = salary_period_dashboard(&conn, &selected_start)?;
    let view_month = if selected_start.len() >= 7 {
      selected_start[..7].to_string()
    } else {
      month.clone()
    };

    let mut period_inputs = Vec::new();
    for sp in &all_periods {
      if sp.period_start.as_str() > selected_start.as_str() {
        break;
      }
      let p = salary_period_dashboard(&conn, &sp.period_start)?;
      let chain_month = if sp.period_start.len() >= 7 {
        sp.period_start[..7].to_string()
      } else {
        view_month.clone()
      };
      let (cal_start, cal_end) = month_bounds(&chain_month)
        .ok_or_else(|| AppError::Invalid("invalid month".into()))?;
      let built = build_dashboard_month_events(
        &conn,
        &chain_month,
        &account_id,
        &p,
        &iso_date(cal_start),
        &iso_date(cal_end),
      )?;
      period_inputs.push(MonthPeriodInput {
        month: chain_month,
        period_start: p.period_start.clone(),
        period_end: p.period_end.clone(),
        events: built.events,
      });
    }

    let chain = compute_salary_period_chain(
      &conn,
      &selected_start,
      &account_id,
      &filter_scope,
      &liquid_account_ids,
      &period_inputs,
    )?;
    let balances = chain.get(&selected_start).ok_or_else(|| {
      AppError::Invalid("dashboard chain missing target salary period".into())
    })?;

    let prev_end = all_periods
      .iter()
      .rev()
      .find(|sp| sp.period_start.as_str() < selected_start.as_str())
      .map(|sp| sp.period_end.clone())
      .unwrap_or_else(|| period.period_start.clone());

    (view_month, period, prev_end, balances.clone())
  } else {
    let (start, end) = month_bounds(&month).ok_or_else(|| AppError::Invalid("month must be YYYY-MM".into()))?;
    let range_start = iso_date(start);
    let _range_end = iso_date(end);
    let min_month = crate::dashboard_period::dashboard_min_month(&conn)?;
    let chain_months = months_from_to(&min_month, &month);

    let mut month_inputs = Vec::new();
    for chain_month in &chain_months {
      let (cal_start, cal_end) = month_bounds(chain_month)
        .ok_or_else(|| AppError::Invalid("invalid month".into()))?;
      let p = crate::dashboard_period::effective_period_for_month(&conn, chain_month)?;
      let built = build_dashboard_month_events(
        &conn,
        chain_month,
        &account_id,
        &p,
        &iso_date(cal_start),
        &iso_date(cal_end),
      )?;
      month_inputs.push(MonthPeriodInput {
        month: chain_month.clone(),
        period_start: p.period_start,
        period_end: p.period_end,
        events: built.events,
      });
    }

    let chain = compute_dashboard_chain(
      &conn,
      &min_month,
      &month,
      &account_id,
      &filter_scope,
      &liquid_account_ids,
      &month_inputs,
    )?;
    let balances = chain
      .get(&month)
      .ok_or_else(|| AppError::Invalid("dashboard chain missing target month".into()))?
      .clone();
    let period = crate::dashboard_period::effective_period_for_month(&conn, &month)?;
    let prev_month = month_add_iso(&month, -1).unwrap_or_else(|| month.clone());
    let prev_end = month_bounds(&prev_month)
      .map(|(_, end)| iso_date(end))
      .unwrap_or_else(|| range_start.clone());
    (month.clone(), period, prev_end, balances)
  };

  let period_start = period.period_start.clone();
  let period_end = period.period_end.clone();
  let (cal_start, cal_end) = month_bounds(&view_month)
    .ok_or_else(|| AppError::Invalid("invalid month".into()))?;
  let built = build_dashboard_month_events(
    &conn,
    &view_month,
    &account_id,
    &period,
    &iso_date(cal_start),
    &iso_date(cal_end),
  )?;

  let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();
  let period_is_current = today.as_str() >= period_start.as_str() && today.as_str() <= period_end.as_str();
  let as_of = today.clone();
  let start_kontostand_date = crate::dashboard_period::prognostic_start_balance_date(&conn, &period)?;
  let start_kontostand = kontostand_total_cents(
    &conn,
    &start_kontostand_date,
    &account_id,
    stock_portfolio_cents,
    false,
  )?;
  let prev_kontostand = kontostand_total_cents(
    &conn,
    &prev_range_end,
    &account_id,
    stock_portfolio_cents,
    true,
  )?;

  let remaining_fixed =
    remaining_fixed_costs_cents(&conn, &period_start, &period_end, &account_id, &main_id)?;
  let remaining_variable =
    remaining_variable_costs_cents(&conn, &period_start, &period_end, &account_id, &main_id)?;
  let booked_fixed = booked_fixed_costs_in_range(&conn, &period_start, &period_end, &filter_scope, &main_id)?;
  let booked_variable =
    booked_variable_costs_in_range(&conn, &period_start, &period_end, &filter_scope, &main_id)?;

  let include_transfers = account_id.is_some();
  let period_flows = aggregate_period_flows(
    &built.events,
    &period_start,
    &period_end,
    include_transfers,
  );
  let liquid_card_flows = if account_id.is_none() {
    aggregate_all_accounts_card_flows(&built.events, &period_start, &period_end)
  } else {
    period_flows
  };
  let liquid_end_flows = if account_id.is_none() {
    aggregate_liquid_flows(
      &built.events,
      &period_start,
      &period_end,
      &liquid_account_ids,
      true,
    )
  } else {
    period_flows
  };

  let start_balance_cents = balances.start_balance_cents;
  let start_liquid_cents = balances.start_liquid_cents;

  let real_flows_to_today = aggregate_real_period_flows(
    &built.events,
    &period_start,
    &as_of,
    include_transfers,
  );
  let is_depot_filter = match &account_id {
    Some(aid) => account_balance_source(&conn, aid)? == "stock_portfolio",
    None => false,
  };
  let use_depot_cost_basis = is_depot_filter && (!period_is_current || today.as_str() > period_end.as_str());
  let kontostand_as_of_date = if is_depot_filter {
    if period_is_current {
      as_of.as_str()
    } else {
      period_end.as_str()
    }
  } else {
    as_of.as_str()
  };
  let kontostand = if is_depot_filter {
    kontostand_total_cents(
      &conn,
      kontostand_as_of_date,
      &account_id,
      stock_portfolio_cents,
      use_depot_cost_basis,
    )?
  } else {
    start_balance_cents + real_flows_to_today.net_cents()
  };

  let prognose_end_balance = end_balance_from_start(start_balance_cents, &period_flows);
  let remaining_buys_cents: i64 = built
    .events
    .iter()
    .filter(|ev| ev.r#type == "buy_planned" && ev.date.as_str() >= period_start.as_str() && ev.date.as_str() <= period_end.as_str())
    .map(|ev| ev.amount_cents.abs())
    .sum();

  let end_balance_cents = if is_depot_filter {
    kontostand
  } else if period_is_current
    && remaining_fixed == 0
    && remaining_variable == 0
    && remaining_buys_cents == 0
  {
    kontostand
  } else {
    prognose_end_balance
  };

  let end_liquid_cents = if account_id.is_none() {
    end_balance_from_start(start_liquid_cents, &liquid_end_flows)
  } else {
    0
  };

  let income_cents = if account_id.is_none() {
    liquid_card_flows.income_cents
  } else {
    period_flows.income_cents
  };

  let expense_cents = if account_id.is_none() {
    liquid_card_flows.expense_cents
  } else {
    period_flows.expense_cents
  };

  calc_log!(
    "dashboard",
    "get_month_view",
    "month={}, period={}..{}, period_mode={}, income_cents={}, expense_cents={}, start_balance={}, end_balance={}",
    view_month,
    period_start,
    period_end,
    period_mode,
    income_cents,
    expense_cents,
    start_balance_cents,
    end_balance_cents
  );

  Ok(MonthView {
    month: view_month,
    start_balance_cents,
    income_cents,
    fixed_costs_cents: built.fixed_costs_sum,
    variable_costs_cents: built.variable_costs_sum,
    remaining_fixed_costs_cents: remaining_fixed,
    remaining_variable_costs_cents: remaining_variable,
    applied_buys_cents: built.buys_sum,
    transfers_cents: built.transfers_sum,
    end_balance_cents,
    start_liquid_cents,
    total_liquid_cents: end_liquid_cents,
    kontostand_cents: kontostand,
    kontostand_saldo_cents: kontostand,
    kontostand_as_of: as_of,
    kontostand_start_cents: start_kontostand,
    kontostand_start_saldo_cents: start_kontostand,
    prev_kontostand_cents: prev_kontostand,
    period_mode: period.mode,
    period_start,
    period_end,
    salary_cutoff_date: period.salary_cutoff_date,
    period_is_current,
    booked_fixed_costs_cents: booked_fixed,
    booked_variable_costs_cents: booked_variable,
    events: built.events,
  })
}
