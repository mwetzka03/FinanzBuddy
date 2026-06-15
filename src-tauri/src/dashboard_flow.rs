use crate::calc_log::calc_log;
use crate::commands::forecast_variable::variable_cost_ledger_excluded_from_flow_totals;
use crate::models::TimelineEvent;
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, Default)]
pub struct PeriodFlowTotals {
  pub income_cents: i64,
  pub expense_cents: i64,
}

impl PeriodFlowTotals {
  pub fn net_cents(&self) -> i64 {
    self.income_cents - self.expense_cents
  }
}

fn event_in_range(date: &str, start: &str, end: &str) -> bool {
  date >= start && date <= end
}

fn is_flow_event(ev: &TimelineEvent) -> bool {
  ev.r#type != "adjustment" && ev.r#type != "stock_purchase"
}

fn is_transfer_flow_event(ev: &TimelineEvent) -> bool {
  ev.internal_transfer || ev.r#type == "transfer"
}

fn skips_flow_total(ev: &TimelineEvent) -> bool {
  if ev.r#type != "expense" || ev.variable_cost_id.is_none() {
    return false;
  }
  variable_cost_ledger_excluded_from_flow_totals(ev.variable_cost_id.as_deref(), &ev.date).unwrap_or(false)
}

/// Prognose-Ereignisse (Fix/Var/Buy-Plan, ungebuchte Einnahmen-Prognose) — nicht für Kontostand.
fn is_prognostic_flow_event(ev: &TimelineEvent) -> bool {
  matches!(
    ev.r#type.as_str(),
    "fixed_cost" | "variable_cost" | "buy_planned"
  ) || (ev.r#type == "income" && !ev.id.starts_with("ledger:"))
}

fn is_real_flow_event(ev: &TimelineEvent) -> bool {
  is_flow_event(ev) && !is_prognostic_flow_event(ev)
}

/// Einnahmen/Ausgaben im Zeitraum. Bei `include_transfers = false` (Alle Konten) zählen
/// Umbuchungen nicht — sie verschieben nur Liquidität bzw. Saldo pro Einzelkonto.
pub fn aggregate_period_flows(
  events: &[TimelineEvent],
  range_start: &str,
  range_end: &str,
  include_transfers: bool,
) -> PeriodFlowTotals {
  let mut totals = PeriodFlowTotals::default();
  for ev in events {
    if !event_in_range(&ev.date, range_start, range_end) {
      continue;
    }
    if !is_flow_event(ev) {
      continue;
    }
    if skips_flow_total(ev) {
      continue;
    }
    if is_transfer_flow_event(ev) {
      if !include_transfers {
        continue;
      }
      if ev.account_id.is_none() {
        continue;
      }
    }
    if ev.amount_cents > 0 {
      totals.income_cents += ev.amount_cents;
    } else if ev.amount_cents < 0 {
      totals.expense_cents += ev.amount_cents.abs();
    }
  }
  calc_log!(
    "dashboard_flow",
    "aggregate_period_flows",
    "range={}..{}, events={}, income_cents={}, expense_cents={}, net_cents={}",
    range_start,
    range_end,
    events.len(),
    totals.income_cents,
    totals.expense_cents,
    totals.net_cents()
  );
  totals
}

/// Reelle Flows im Zeitraum (Ledger + Transfers, ohne Prognosen) — für Kontostand.
pub fn aggregate_real_period_flows(
  events: &[TimelineEvent],
  range_start: &str,
  range_end: &str,
  include_transfers: bool,
) -> PeriodFlowTotals {
  let mut totals = PeriodFlowTotals::default();
  for ev in events {
    if !event_in_range(&ev.date, range_start, range_end) {
      continue;
    }
    if !is_real_flow_event(ev) {
      continue;
    }
    if is_transfer_flow_event(ev) {
      if !include_transfers {
        continue;
      }
      if ev.account_id.is_none() {
        continue;
      }
    }
    if ev.amount_cents > 0 {
      totals.income_cents += ev.amount_cents;
    } else if ev.amount_cents < 0 {
      totals.expense_cents += ev.amount_cents.abs();
    }
  }
  calc_log!(
    "dashboard_flow",
    "aggregate_real_period_flows",
    "range={}..{}, income_cents={}, expense_cents={}",
    range_start,
    range_end,
    totals.income_cents,
    totals.expense_cents
  );
  totals
}

/// Aktienkäufe im Zeitraum (negative Beträge als Ausgaben).
pub fn stock_purchase_expense_cents(
  events: &[TimelineEvent],
  range_start: &str,
  range_end: &str,
) -> i64 {
  events
    .iter()
    .filter(|ev| ev.r#type == "stock_purchase" && event_in_range(&ev.date, range_start, range_end))
    .map(|ev| ev.amount_cents.abs())
    .sum()
}

/// Einnahmen/Ausgaben-Kacheln bei „Alle Konten“ — reale Flows ohne Umbuchungen; Prognose-Einnahmen zählen mit.
pub fn aggregate_all_accounts_card_flows(
  events: &[TimelineEvent],
  range_start: &str,
  range_end: &str,
) -> PeriodFlowTotals {
  let mut totals = PeriodFlowTotals::default();
  for ev in events {
    if !event_in_range(&ev.date, range_start, range_end) {
      continue;
    }
    if ev.r#type == "adjustment" {
      continue;
    }
    if is_prognostic_flow_event(ev) {
      if ev.r#type == "income" && !ev.id.starts_with("ledger:") {
        totals.income_cents += ev.amount_cents;
      }
      continue;
    }
    if skips_flow_total(ev) {
      continue;
    }
    if is_transfer_flow_event(ev) {
      continue;
    }
    if ev.amount_cents > 0 {
      totals.income_cents += ev.amount_cents;
    } else if ev.amount_cents < 0 {
      totals.expense_cents += ev.amount_cents.abs();
    }
  }
  calc_log!(
    "dashboard_flow",
    "aggregate_all_accounts_card_flows",
    "range={}..{}, income_cents={}, expense_cents={}",
    range_start,
    range_end,
    totals.income_cents,
    totals.expense_cents
  );
  totals
}

/// Liquide Mittel: Einnahmen/Ausgaben auf liquiden Konten (optional inkl. Transfer-Effekt).
pub fn aggregate_liquid_flows(
  events: &[TimelineEvent],
  range_start: &str,
  range_end: &str,
  liquid_account_ids: &HashSet<String>,
  include_transfers: bool,
) -> PeriodFlowTotals {
  let mut totals = PeriodFlowTotals::default();
  for ev in events {
    if !event_in_range(&ev.date, range_start, range_end) {
      continue;
    }
    if ev.r#type == "adjustment" {
      continue;
    }
    if skips_flow_total(ev) {
      continue;
    }
    if is_transfer_flow_event(ev) {
      if !include_transfers {
        continue;
      }
      if let Some(aid) = ev.account_id.as_deref() {
        if liquid_account_ids.contains(aid) {
          if ev.amount_cents > 0 {
            totals.income_cents += ev.amount_cents;
          } else if ev.amount_cents < 0 {
            totals.expense_cents += ev.amount_cents.abs();
          }
        }
      }
      continue;
    }
    let Some(aid) = ev.account_id.as_deref() else {
      continue;
    };
    if !liquid_account_ids.contains(aid) {
      continue;
    }
    if ev.amount_cents > 0 {
      totals.income_cents += ev.amount_cents;
    } else if ev.amount_cents < 0 {
      totals.expense_cents += ev.amount_cents.abs();
    }
  }
  calc_log!(
    "dashboard_flow",
    "aggregate_liquid_flows",
    "range={}..{}, liquid_accounts={}, income_cents={}, expense_cents={}",
    range_start,
    range_end,
    liquid_account_ids.len(),
    totals.income_cents,
    totals.expense_cents
  );
  totals
}

pub fn end_balance_from_start(start_cents: i64, flows: &PeriodFlowTotals) -> i64 {
  let end = start_cents + flows.net_cents();
  calc_log!(
    "dashboard_flow",
    "end_balance_from_start",
    "start_cents={}, net_cents={} → end_cents={}",
    start_cents,
    flows.net_cents(),
    end
  );
  end
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::models::TimelineEvent;

  fn ev(t: &str, date: &str, amount: i64) -> TimelineEvent {
    TimelineEvent {
      id: format!("{t}:{date}:{amount}"),
      r#type: t.into(),
      date: date.into(),
      title: t.into(),
      amount_cents: amount,
      account_id: None,
      account_name: None,
      internal_transfer: false,
      fixed_cost_id: None,
      variable_cost_id: None,
      buy_item_id: None,
      buy_item_group_id: None,
      notes: None,
    }
  }

  fn real_ev(date: &str, amount: i64) -> TimelineEvent {
    TimelineEvent {
      id: format!("ledger:income:{date}:{amount}"),
      r#type: "income".into(),
      date: date.into(),
      title: "Gehalt".into(),
      amount_cents: amount,
      account_id: None,
      account_name: None,
      internal_transfer: false,
      fixed_cost_id: None,
      variable_cost_id: None,
      buy_item_id: None,
      buy_item_group_id: None,
      notes: None,
    }
  }

  #[test]
  fn real_flows_exclude_prognostic_income() {
    let events = vec![
      real_ev("2026-05-01", 300000),
      TimelineEvent {
        id: "income:fc:2026-05-15".into(),
        r#type: "income".into(),
        date: "2026-05-15".into(),
        title: "Gehalt (Prognose)".into(),
        amount_cents: 200000,
        account_id: None,
        account_name: None,
        internal_transfer: false,
        fixed_cost_id: None,
        variable_cost_id: None,
        buy_item_id: None,
      buy_item_group_id: None,
        notes: None,
      },
      ev("fixed_cost", "2026-05-10", -50000),
    ];
    let all = aggregate_period_flows(&events, "2026-05-01", "2026-05-31", true);
    let real = aggregate_real_period_flows(&events, "2026-05-01", "2026-05-31", true);
    assert_eq!(all.income_cents, 500000);
    assert_eq!(real.income_cents, 300000);
    assert_eq!(all.expense_cents, 50000);
    assert_eq!(real.expense_cents, 0);
  }

  #[test]
  fn end_balance_follows_start_plus_net() {
    let events = vec![
      ev("income", "2026-04-01", 300000),
      ev("expense", "2026-04-05", -50000),
      TimelineEvent {
        id: "ledger:transfer:scoped".into(),
        r#type: "transfer".into(),
        date: "2026-04-10".into(),
        title: "Transfer".into(),
        amount_cents: -20000,
        account_id: Some("main".into()),
        account_name: None,
        internal_transfer: true,
        fixed_cost_id: None,
        variable_cost_id: None,
        buy_item_id: None,
      buy_item_group_id: None,
        notes: None,
      },
    ];
    let flows = aggregate_period_flows(&events, "2026-04-01", "2026-04-30", true);
    assert_eq!(flows.income_cents, 300000);
    assert_eq!(flows.expense_cents, 70000);
    assert_eq!(end_balance_from_start(100000, &flows), 330000);
  }

  #[test]
  fn positive_transfer_to_account_counts_as_income() {
    let events = vec![TimelineEvent {
      id: "ledger:transfer:in".into(),
      r#type: "transfer".into(),
      date: "2026-04-21".into(),
      title: "Transfer: Urlaub → Hauptkonto".into(),
      amount_cents: 10244,
      account_id: Some("main".into()),
      account_name: None,
      internal_transfer: true,
      fixed_cost_id: None,
      variable_cost_id: None,
      buy_item_id: None,
      buy_item_group_id: None,
      notes: None,
    }];
    let flows = aggregate_period_flows(&events, "2026-03-31", "2026-04-29", true);
    assert_eq!(flows.income_cents, 10244);
  }

  #[test]
  fn internal_transfer_display_rows_do_not_affect_totals() {
    let events = vec![
      ev("income", "2026-04-01", 300000),
      TimelineEvent {
        id: "ledger:transfer:internal".into(),
        r#type: "transfer".into(),
        date: "2026-04-10".into(),
        title: "Transfer".into(),
        amount_cents: 20000,
        account_id: None,
        account_name: None,
        internal_transfer: true,
        fixed_cost_id: None,
        variable_cost_id: None,
        buy_item_id: None,
      buy_item_group_id: None,
        notes: None,
      },
    ];
    let flows = aggregate_period_flows(&events, "2026-04-01", "2026-04-30", true);
    assert_eq!(flows.income_cents, 300000);
    assert_eq!(flows.expense_cents, 0);
  }
}
