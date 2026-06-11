use super::forecast_fixed::push_fixed_cost_events_for_range;
use super::forecast_income::{materialize_due_income_forecasts, push_unbooked_income_events_for_range};
use super::forecast_variable::{
  load_variable_cost_templates, variable_cost_effective_amount, variable_costs_active_month,
};
use super::helpers::{
  account_balance_source, account_filter_scope, account_liquid_map, account_name_map, account_name_of,
  cached_stock_portfolio_cents_if_needed, event_matches_account, iso_date, to_cmd_result, CmdResult,
};
use super::prognostic::{
  kontostand_total_cents, prognostic_liquid_cents, prognostic_total_cents, push_depot_stock_purchase_events,
};
use crate::accounts::get_main_account_id;
use crate::error::{AppError, AppResult};
use crate::logic::last_day_of_month_iso;
use crate::models::{DayView, TimelineEvent};
use crate::state::AppState;
use rusqlite::params;
use tauri::State;

// ---- Day view ----

#[tauri::command]
pub fn get_day_view(state: State<'_, AppState>, date: String, account_id: Option<String>) -> CmdResult<DayView> {
  to_cmd_result(get_day_view_inner(state, date, account_id))
}

fn get_day_view_inner(state: State<'_, AppState>, date: String, account_id: Option<String>) -> AppResult<DayView> {
  {
    let conn = state.conn.lock().unwrap();
    crate::setup::assert_setup_completed(&conn)?;
  }
  if crate::models::parse_iso_date(&date).is_none() {
    return Err(AppError::Invalid("date must be YYYY-MM-DD".into()));
  }
  {
    let conn = state.conn.lock().unwrap();
    materialize_due_income_forecasts(&conn)?;
  }

  let conn = state.conn.lock().unwrap();
  let stock_portfolio_cents = cached_stock_portfolio_cents_if_needed(&state, &conn, &account_id)?;
  let names = account_name_map(&conn)?;
  let liquid_flags = account_liquid_map(&conn)?;
  let main_id = get_main_account_id(&conn)?;
  let filter_scope = account_filter_scope(&conn, &account_id)?;

  let total = prognostic_total_cents(
    &conn,
    &date,
    &account_id,
    &main_id,
    stock_portfolio_cents,
    true,
  )?;
  let liquid = prognostic_liquid_cents(
    &conn,
    &date,
    &account_id,
    &main_id,
    stock_portfolio_cents,
    true,
  )?;

  let mut events: Vec<TimelineEvent> = Vec::new();

  // Ledger postings on this day
  {
    let mut stmt = conn.prepare(
      "SELECT id, kind, title, amount_cents, account_id, from_account_id, to_account_id, variable_cost_id FROM ledger_transactions WHERE date = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![date.clone()], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, String>(2)?,
        r.get::<_, i64>(3)?,
        r.get::<_, Option<String>>(4)?,
        r.get::<_, Option<String>>(5)?,
        r.get::<_, Option<String>>(6)?,
        r.get::<_, Option<String>>(7)?,
      ))
    })?;
    for row in rows {
      let (id, kind, title, amount_cents, acc, from_id, to_id, _variable_cost_id) = row?;
      let (ev_acc_id, ev_acc_name, mapped_amount) = if kind == "transfer" {
        let from = from_id.as_deref().unwrap_or("");
        let to = to_id.as_deref().unwrap_or("");
        if let Some(ref fid) = account_id {
          if fid == from {
            (Some(from.to_string()), account_name_of(&names, from), -amount_cents)
          } else if fid == to {
            (Some(to.to_string()), account_name_of(&names, to), amount_cents)
          } else {
            continue;
          }
        } else {
          let from_liquid = liquid_flags.get(from).copied().unwrap_or(false);
          let to_liquid = liquid_flags.get(to).copied().unwrap_or(false);
          let (flow_amount, mapped_account, display_amount) = match (from_liquid, to_liquid) {
            (true, false) => (-amount_cents, Some(from.to_string()), amount_cents.abs()),
            (false, true) => (amount_cents, Some(to.to_string()), amount_cents.abs()),
            (true, true) | (false, false) => (0i64, None, amount_cents.abs()),
          };
          (
            mapped_account,
            format!("{} → {}", account_name_of(&names, from), account_name_of(&names, to)),
            if flow_amount == 0 {
              display_amount
            } else {
              flow_amount
            },
          )
        }
      } else {
        let aid = acc.clone().unwrap_or_default();
        if !event_matches_account(&filter_scope, &main_id, Some(aid.as_str())) {
          continue;
        }
        (acc.clone(), account_name_of(&names, &aid), amount_cents)
      };
      events.push(TimelineEvent {
        id: format!("ledger:{}:{}", kind, id),
        r#type: kind.clone(),
        date: date.clone(),
        title,
        amount_cents: mapped_amount,
        account_id: ev_acc_id,
        account_name: Some(ev_acc_name),
        internal_transfer: kind == "transfer",
        fixed_cost_id: None,
      variable_cost_id: None,
      buy_item_id: None,
      buy_item_group_id: None,
      notes: None,
      });
    }
  }

  // Fixed costs on this day
  {
    let mut fixed_costs_day = 0i64;
    push_fixed_cost_events_for_range(
      &conn,
      &names,
      &date,
      &date,
      &account_id,
      &main_id,
      &mut events,
      &mut fixed_costs_day,
      1,
    )?;
  }

  // Income forecast on this day (unbooked only)
  if event_matches_account(&filter_scope, &main_id, Some(main_id.as_str())) {
    let mut income_sum = 0i64;
    push_unbooked_income_events_for_range(
      &conn,
      &date,
      &date,
      if date.len() >= 7 { &date[..7] } else { &date },
      &main_id,
      &account_name_of(&names, &main_id),
      &mut events,
      &mut income_sum,
    )?;
  }

  // Variable costs on this day (Hauptkonto, monthly templates)
  if event_matches_account(&filter_scope, &main_id, Some(main_id.as_str())) {
    let month = if date.len() >= 7 { &date[..7] } else { &date };
    if variable_costs_active_month(month) {
      for t in load_variable_cost_templates(&conn)? {
        let charge_date = last_day_of_month_iso(month).unwrap_or_else(|| date.clone());
        if charge_date != date {
          continue;
        }
        let (amount, is_actual) = variable_cost_effective_amount(&conn, &t, month)?;
        if is_actual {
          continue;
        }
        events.push(TimelineEvent {
          id: format!("variable_cost:{}:{}", t.id, date),
          r#type: "variable_cost".into(),
          date: date.clone(),
          title: format!("{} (Prognose)", t.name),
          amount_cents: -amount,
          account_id: Some(main_id.clone()),
          account_name: Some(account_name_of(&names, &main_id)),
          internal_transfer: false,
          fixed_cost_id: None,
      variable_cost_id: None,
      buy_item_id: None,
      buy_item_group_id: None,
      notes: None,
        });
      }
    }
  }

  if let Some(ref fid) = account_id {
    if account_balance_source(&conn, fid)? == "stock_portfolio" {
      push_depot_stock_purchase_events(&conn, &names, fid, &date, &date, &mut events, false, &mut 0)?;
    }
  }

  events.sort_by(|a, b| a.title.cmp(&b.title));

  let kontostand = kontostand_total_cents(
    &conn,
    &date,
    &account_id,
    stock_portfolio_cents,
    false,
  )?;
  let prev_date = crate::models::parse_iso_date(&date)
    .and_then(|d| d.pred_opt())
    .map(iso_date)
    .unwrap_or_else(|| date.clone());
  let prev_kontostand = kontostand_total_cents(
    &conn,
    &prev_date,
    &account_id,
    stock_portfolio_cents,
    true,
  )?;

  Ok(DayView {
    date,
    total_cents: total,
    liquid_cents: liquid,
    kontostand_cents: kontostand,
    prev_kontostand_cents: prev_kontostand,
    events,
  })
}
