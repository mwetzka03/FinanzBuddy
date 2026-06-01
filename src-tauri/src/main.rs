mod accounts;
mod commands;
mod db;
mod error;
mod extra_commands;
mod income_actuals;
mod logic;
mod models;
mod news;
mod news_cache;
mod portfolio_cache;
mod state;
mod stocks;

use crate::state::AppState;
use tauri::Manager;

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      let state = AppState::init(app.handle())?;
      app.manage(state);
      portfolio_cache::spawn_refresh_loop(app.handle().clone());
      news_cache::spawn_refresh_loop(app.handle().clone());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::list_accounts,
      commands::create_account,
      commands::update_account,
      commands::set_main_account,
      commands::set_account_liquid,
      commands::set_account_balance_source,
      commands::list_ledger_transactions,
      commands::create_ledger_transaction,
      commands::create_transfer,
      commands::delete_transfer,
      commands::get_day_view,
      commands::list_fixed_costs,
      commands::create_fixed_cost,
      commands::update_fixed_cost,
      commands::delete_fixed_cost,
      commands::preview_fixed_cost,
      commands::list_buy_items,
      commands::create_buy_item,
      commands::update_buy_item,
      commands::apply_buy_item,
      commands::unapply_buy_item,
      commands::delete_buy_item,
      commands::list_income_forecasts,
      commands::create_income_forecast,
      commands::update_income_forecast,
      commands::delete_income_forecast,
      commands::preview_income_forecast,
      income_actuals::get_income_forecast_detail,
      income_actuals::set_income_forecast_actual,
      income_actuals::list_income_forecast_occurrences,
      commands::update_ledger_transaction,
      commands::delete_ledger_transaction,
      commands::list_variable_costs,
      commands::get_variable_cost_detail,
      commands::create_variable_cost,
      commands::update_variable_cost,
      commands::set_variable_cost_actual,
      commands::delete_variable_cost,
      commands::get_month_view,
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
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

