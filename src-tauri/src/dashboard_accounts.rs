use crate::accounts::{account_included_in_total_kontostand, resolve_account_filter_scope};

use crate::calc_log::calc_log;

use crate::commands::dashboard_events::build_dashboard_month_events;

use crate::commands::forecast_variable_events::{remaining_fixed_costs_cents, remaining_variable_costs_cents};

use crate::commands::helpers::{account_balance_source, account_name_map, account_name_of};

use crate::commands::prognostic::kontostand_total_cents;

use crate::dashboard_compute::{

  compute_dashboard_chain, compute_salary_period_chain, MonthPeriodInput,

};

use crate::dashboard_flow::{aggregate_period_flows, aggregate_real_period_flows, end_balance_from_start, PeriodFlowTotals};

use crate::dashboard_period::{DashboardPeriod, effective_period_for_month, salary_period_dashboard};

use crate::error::{AppError, AppResult};

use crate::models::AccountKontostandRow;

use crate::state::AppState;

use rusqlite::Connection;

use std::collections::HashSet;



pub struct AllAccountsBalanceTotals {

  pub kontostand_rows: Vec<AccountKontostandRow>,

  pub start_rows: Vec<AccountKontostandRow>,

  pub end_rows: Vec<AccountKontostandRow>,

  pub total_kontostand_cents: i64,

  pub total_start_balance_cents: i64,

  pub total_end_balance_cents: i64,

}



fn period_inputs_for_account(

  conn: &Connection,

  account_id: &str,

  period_mode: &str,

  template_inputs: &[MonthPeriodInput],

) -> AppResult<Vec<MonthPeriodInput>> {

  let account_filter = Some(account_id.to_string());

  template_inputs

    .iter()

    .map(|input| {

      let period = if period_mode == "since_last_salary" {

        salary_period_dashboard(conn, &input.period_start)?

      } else {

        effective_period_for_month(conn, &input.month)?

      };

      let built = build_dashboard_month_events(conn, &input.month, &account_filter, &period)?;

      Ok(MonthPeriodInput {

        month: input.month.clone(),

        period_start: input.period_start.clone(),

        period_end: input.period_end.clone(),

        events: built.events,

      })

    })

    .collect()

}



fn chain_start_for_account(

  conn: &Connection,

  account_id: &str,

  scope: &crate::accounts::AccountFilterScope,

  period_mode: &str,

  chain_lookup_key: &str,

  min_month: &str,

  liquid_account_ids: &HashSet<String>,

  account_period_inputs: &[MonthPeriodInput],

) -> AppResult<i64> {

  let account_filter = Some(account_id.to_string());

  let scope_opt = Some(scope.clone());



  let balances = if period_mode == "since_last_salary" {

    compute_salary_period_chain(

      conn,

      chain_lookup_key,

      &account_filter,

      &scope_opt,

      liquid_account_ids,

      account_period_inputs,

    )?

  } else {

    compute_dashboard_chain(

      conn,

      min_month,

      chain_lookup_key,

      &account_filter,

      &scope_opt,

      liquid_account_ids,

      account_period_inputs,

    )?

  };



  balances

    .get(chain_lookup_key)

    .map(|b| b.start_balance_cents)

    .ok_or_else(|| AppError::Invalid(format!("chain missing start for account {account_id}")))

}



fn account_end_balance_cents(

  conn: &Connection,

  account_id: &str,

  chain_start: i64,

  period_flows: &PeriodFlowTotals,

  kontostand: i64,

  period_is_current: bool,

  period_start: &str,

  period_end: &str,

  main_id: &str,

  account_events: &[crate::models::TimelineEvent],

) -> AppResult<i64> {

  let prognose_end = end_balance_from_start(chain_start, period_flows);

  let remaining_fixed =

    remaining_fixed_costs_cents(conn, period_start, period_end, &Some(account_id.to_string()), main_id)?;

  let remaining_variable =

    remaining_variable_costs_cents(conn, period_start, period_end, &Some(account_id.to_string()), main_id)?;

  let remaining_buys_cents: i64 = account_events

    .iter()

    .filter(|ev| {

      ev.r#type == "buy_planned"

        && ev.date.as_str() >= period_start

        && ev.date.as_str() <= period_end

    })

    .map(|ev| ev.amount_cents.abs())

    .sum();



  if period_is_current

    && remaining_fixed == 0

    && remaining_variable == 0

    && remaining_buys_cents == 0

  {

    Ok(kontostand)

  } else {

    Ok(prognose_end)

  }

}



/// Salden pro Konto wie in der Einzelansicht; Summe ergibt die Alle-Konten-Kacheln.

pub fn compute_all_accounts_balance_totals(

  conn: &Connection,

  _state: &AppState,

  main_id: &str,

  period_mode: &str,

  chain_lookup_key: &str,

  min_month: &str,

  period_inputs: &[MonthPeriodInput],

  view_month: &str,

  current_period: &DashboardPeriod,

  prev_range_end: &str,

  period_start: &str,

  period_end: &str,

  as_of: &str,

  period_is_current: bool,

  liquid_account_ids: &HashSet<String>,

  stock_portfolio_cents: Option<i64>,

) -> AppResult<AllAccountsBalanceTotals> {

  let names = account_name_map(conn)?;

  let mut stmt = conn.prepare("SELECT id FROM accounts ORDER BY name ASC")?;

  let account_ids: Vec<String> = stmt

    .query_map([], |r| r.get(0))?

    .collect::<Result<_, _>>()?;



  let mut kontostand_rows = Vec::new();

  let mut start_rows = Vec::new();

  let mut end_rows = Vec::new();

  let mut total_kontostand = 0i64;

  let mut total_start = 0i64;

  let mut total_end = 0i64;



  for account_id in account_ids {

    if !account_included_in_total_kontostand(conn, &account_id)? {

      continue;

    }

    let scope = resolve_account_filter_scope(conn, &account_id)?;

    let account_filter = Some(account_id.clone());

    let is_depot = account_balance_source(conn, &account_id)? == "stock_portfolio";

    let chain_start = if is_depot {
      kontostand_total_cents(
        conn,
        prev_range_end,
        &account_filter,
        None,
        true,
      )?
    } else {
      let account_period_inputs =
        period_inputs_for_account(conn, &account_id, period_mode, period_inputs)?;
      chain_start_for_account(
        conn,
        &account_id,
        &scope,
        period_mode,
        chain_lookup_key,
        min_month,
        liquid_account_ids,
        &account_period_inputs,
      )?
    };

    let built = build_dashboard_month_events(conn, view_month, &account_filter, current_period)?;

    let account_events = &built.events;

    let real_flows = aggregate_real_period_flows(account_events, period_start, as_of, true);

    let period_flows = aggregate_period_flows(account_events, period_start, period_end, true);

    let use_depot_cost_basis = is_depot && (!period_is_current || as_of > period_end);



    let kontostand = if is_depot {

      kontostand_total_cents(

        conn,

        if period_is_current {

          as_of

        } else {

          period_end

        },

        &account_filter,

        stock_portfolio_cents,

        use_depot_cost_basis,

      )?

    } else {

      chain_start + real_flows.net_cents()

    };



    let end_balance = if is_depot {

      kontostand

    } else {

      account_end_balance_cents(

        conn,

        &account_id,

        chain_start,

        &period_flows,

        kontostand,

        period_is_current,

        period_start,

        period_end,

        main_id,

        account_events,

      )?

    };



    let row = |cents: i64| AccountKontostandRow {

      account_id: account_id.clone(),

      account_name: account_name_of(&names, &account_id),

      balance_cents: cents,

    };



    kontostand_rows.push(row(kontostand));

    start_rows.push(row(chain_start));

    end_rows.push(row(end_balance));

    total_kontostand += kontostand;

    total_start += chain_start;

    total_end += end_balance;

  }



  calc_log!(

    "dashboard_accounts",

    "compute_all_accounts_balance_totals",

    "accounts={}, total_kontostand={}, total_start={}, total_end={}",

    kontostand_rows.len(),

    total_kontostand,

    total_start,

    total_end

  );



  Ok(AllAccountsBalanceTotals {

    kontostand_rows,

    start_rows,

    end_rows,

    total_kontostand_cents: total_kontostand,

    total_start_balance_cents: total_start,

    total_end_balance_cents: total_end,

  })

}


