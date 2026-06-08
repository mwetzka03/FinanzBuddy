use super::helpers::{to_cmd_result, CmdResult};
use crate::error::AppResult;
use crate::state::AppState;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn clear_all_transactions(state: State<'_, AppState>) -> CmdResult<()> {
  to_cmd_result(clear_all_transactions_inner(state))
}

fn clear_all_transactions_inner(state: State<'_, AppState>) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  let tx = conn.unchecked_transaction()?;
  tx.execute("DELETE FROM ledger_transactions", [])?;
  tx.execute("DELETE FROM income_forecast_actuals", [])?;
  tx.execute("DELETE FROM income_forecasts", [])?;
  tx.execute("DELETE FROM variable_cost_actuals", [])?;
  tx.execute("DELETE FROM variable_costs", [])?;
  tx.execute("DELETE FROM fixed_costs", [])?;
  tx.execute("DELETE FROM buy_items", [])?;
  tx.execute("DELETE FROM expense_group_lines", [])?;
  tx.execute("DELETE FROM expense_groups", [])?;
  tx.execute("DELETE FROM debt_transactions", [])?;
  tx.execute("DELETE FROM debt_contacts", [])?;
  tx.execute("DELETE FROM stock_lots", [])?;
  tx.execute("DELETE FROM stock_holdings", [])?;
  tx.execute("DELETE FROM balance_entries", [])?;
  tx.execute(
    "DELETE FROM app_settings WHERE key LIKE 'import_balance_%' OR key IN (?1, ?2, ?3) OR key LIKE 'portfolio_cache:%'",
    params![
      crate::accounts::PRIMARY_INCOME_FORECAST_ID_KEY,
      crate::accounts::PRIMARY_INCOME_EMPLOYER_IBAN_KEY,
      crate::accounts::PRIMARY_INCOME_ANCHOR_DATE_KEY,
    ],
  )?;
  tx.commit()?;
  Ok(())
}

#[tauri::command]
pub fn reset_all_user_data(state: State<'_, AppState>) -> CmdResult<()> {
  to_cmd_result(reset_all_user_data_inner(state))
}

fn reset_all_user_data_inner(state: State<'_, AppState>) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  let tx = conn.unchecked_transaction()?;
  tx.execute("DELETE FROM ledger_transactions", [])?;
  tx.execute("DELETE FROM income_forecast_actuals", [])?;
  tx.execute("DELETE FROM income_forecasts", [])?;
  tx.execute("DELETE FROM variable_cost_actuals", [])?;
  tx.execute("DELETE FROM variable_costs", [])?;
  tx.execute("DELETE FROM fixed_costs", [])?;
  tx.execute("DELETE FROM buy_items", [])?;
  tx.execute("DELETE FROM expense_group_lines", [])?;
  tx.execute("DELETE FROM expense_groups", [])?;
  tx.execute("DELETE FROM debt_transactions", [])?;
  tx.execute("DELETE FROM debt_contacts", [])?;
  tx.execute("DELETE FROM stock_lots", [])?;
  tx.execute("DELETE FROM stock_holdings", [])?;
  tx.execute("DELETE FROM balance_entries", [])?;
  tx.execute("DELETE FROM accounts", [])?;
  tx.execute(
    "DELETE FROM app_settings WHERE key LIKE 'import_balance_%' OR key IN (?1, ?2, ?3) OR key LIKE 'portfolio_cache:%'",
    params![
      crate::accounts::PRIMARY_INCOME_FORECAST_ID_KEY,
      crate::accounts::PRIMARY_INCOME_EMPLOYER_IBAN_KEY,
      crate::accounts::PRIMARY_INCOME_ANCHOR_DATE_KEY,
    ],
  )?;
  crate::setup::clear_setup_state(&tx)?;
  tx.commit()?;
  drop(conn);
  let conn = state.conn.lock().unwrap();
  crate::db::ensure_default_account_and_migrate_legacy(&conn)?;
  Ok(())
}

#[tauri::command]
pub fn get_setup_state(state: State<'_, AppState>) -> CmdResult<serde_json::Value> {
  to_cmd_result(get_setup_state_inner(state))
}

fn get_setup_state_inner(state: State<'_, AppState>) -> AppResult<serde_json::Value> {
  let conn = state.conn.lock().unwrap();
  Ok(serde_json::json!({
    "completed": crate::setup::is_setup_completed(&conn)?,
    "mode": crate::setup::get_setup_mode(&conn)?,
  }))
}

#[tauri::command]
pub fn complete_setup(state: State<'_, AppState>, mode: String) -> CmdResult<()> {
  let conn = state.conn.lock().unwrap();
  crate::setup::complete_setup(&conn, &mode).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_opening_balance(
  state: State<'_, AppState>,
  account_id: String,
  amount_cents: i64,
  as_of_date: String,
) -> CmdResult<()> {
  let conn = state.conn.lock().unwrap();
  crate::accounts::set_import_balance(&conn, &account_id, amount_cents, &as_of_date).map_err(|e| e.to_string())?;
  crate::dashboard_cache::invalidate(&conn).map_err(|e| e.to_string())
}
