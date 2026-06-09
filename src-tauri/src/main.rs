mod accounts;
mod bank_import;
mod buy_assignment;
mod calc_log;
mod commands;
mod cost_assignment;
mod dashboard_cache;
mod dashboard_compute;
mod dashboard_flow;
mod dashboard_period;
mod timeframe;
mod data_backup;
mod db;
mod error;
mod extra_commands;
mod income_actuals;
mod logic;
mod models;
mod news;
mod news_cache;
mod portfolio_cache;
mod setup;
mod state;
mod stocks;

use crate::state::AppState;
use tauri::Manager;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      let state = AppState::init(app.handle())?;
      app.manage(state);
      calc_log::init_calc_log(app.handle());
      portfolio_cache::spawn_refresh_loop(app.handle().clone());
      news_cache::spawn_refresh_loop(app.handle().clone());
      commands::dashboard::spawn_warm_dashboard_cache(app.handle().clone());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::accounts_cmd::list_accounts,
      commands::accounts_cmd::create_account,
      commands::accounts_cmd::update_account,
      commands::accounts_cmd::set_main_account,
      commands::accounts_cmd::set_account_liquid,
      commands::accounts_cmd::set_account_balance_source,
      commands::ledger::list_ledger_transactions,
      commands::ledger::create_ledger_transaction,
      commands::ledger::create_transfer,
      commands::ledger::delete_transfer,
      commands::day_view::get_day_view,
      commands::fixed_costs::list_fixed_costs,
      commands::fixed_costs::create_fixed_cost,
      commands::fixed_costs::update_fixed_cost,
      commands::fixed_costs::unassign_fixed_cost_transaction,
      commands::fixed_costs::delete_fixed_cost,
      commands::fixed_costs::preview_fixed_cost,
      commands::buy_items::list_buy_items,
      commands::buy_items::create_buy_item,
      commands::buy_items::update_buy_item,
      commands::buy_items::apply_buy_item,
      commands::buy_items::unapply_buy_item,
      commands::buy_items::delete_buy_item,
      commands::income_forecasts_cmd::list_income_forecasts,
      commands::income_forecasts_cmd::create_income_forecast,
      commands::income_forecasts_cmd::update_income_forecast,
      commands::income_forecasts_cmd::delete_income_forecast,
      commands::income_forecasts_cmd::preview_income_forecast,
      income_actuals::get_income_forecast_detail,
      income_actuals::set_income_forecast_actual,
      income_actuals::list_income_forecast_occurrences,
      income_actuals::link_ledger_to_income_forecast,
      commands::ledger::update_ledger_transaction,
      commands::ledger::delete_ledger_transaction,
      commands::variable_costs_cmd::list_variable_costs,
      commands::variable_costs_cmd::get_variable_cost_detail,
      commands::variable_costs_cmd::create_variable_cost,
      commands::variable_costs_cmd::update_variable_cost,
      commands::variable_costs_cmd::set_variable_cost_actual,
      commands::variable_costs_cmd::delete_variable_cost,
      commands::dashboard::get_dashboard_settings,
      commands::dashboard::list_dashboard_periods,
      commands::dashboard::set_dashboard_period_mode,
      commands::dashboard::set_timeframe_config,
      commands::dashboard::set_primary_income_forecast,
      commands::dashboard::get_month_view,
      commands::dashboard::refresh_dashboard_cache,
      commands::setup_cmd::clear_all_transactions,
      commands::setup_cmd::reset_all_user_data,
      commands::setup_cmd::get_setup_state,
      commands::setup_cmd::complete_setup,
      commands::setup_cmd::set_account_opening_balance,
      data_backup::export_user_data,
      data_backup::import_user_data,
      extra_commands::list_expense_groups,
      extra_commands::get_expense_group,
      extra_commands::create_expense_group,
      extra_commands::update_expense_group,
      extra_commands::delete_expense_group,
      extra_commands::list_debt_contacts,
      extra_commands::get_debt_contact,
      extra_commands::get_debt_summary,
      extra_commands::create_debt_contact,
      extra_commands::update_debt_contact,
      extra_commands::delete_debt_contact,
      extra_commands::create_debt_transaction,
      extra_commands::update_debt_transaction,
      extra_commands::delete_debt_transaction,
      stocks::list_stock_portfolio,
      stocks::search_stock_suggestions,
      stocks::create_stock_holding,
      stocks::update_stock_holding,
      stocks::delete_stock_holding,
      stocks::get_stock_position_detail,
      stocks::get_stock_chart,
      stocks::delete_stock_lot,
      news::list_stock_news,
      news::refresh_stock_news,
      news::get_stock_news,
      news::open_external_url,
      bank_import::import_bank_export,
      bank_import::preview_bank_export,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

