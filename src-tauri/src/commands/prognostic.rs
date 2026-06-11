use super::forecast_fixed::fixed_cost_occurrences_until;
use super::forecast_income::income_forecasts_forecast_until;
use super::forecast_variable::{
  open_month_categorized_variable_cost_ledger_cents, variable_costs_forecast_until,
};
use super::helpers::{
  account_balance_source, account_name_of, forecasts_apply,
};
use crate::error::AppResult;
use crate::models::TimelineEvent;
use rusqlite::{params, OptionalExtension};

pub(crate) fn forecast_net_until(
  conn: &rusqlite::Connection,
  cutoff_inclusive: &str,
  account_filter: &Option<String>,
  main_id: &str,
  include_parked_buys: bool,
) -> AppResult<i64> {
  if !forecasts_apply(account_filter, main_id) {
    return Ok(0);
  }

  let mut net: i64 = income_forecasts_forecast_until(conn, cutoff_inclusive)?;

  net -= variable_costs_forecast_until(conn, cutoff_inclusive)?;

  if include_parked_buys {
    let cutoff_month = if cutoff_inclusive.len() >= 7 {
      &cutoff_inclusive[..7]
    } else {
      cutoff_inclusive
    };
    net -= conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM buy_items WHERE status='parked' AND planned_month IS NOT NULL AND planned_month <= ?1",
      params![cutoff_month],
      |r| r.get::<_, i64>(0),
    )?;
  }

  net -= fixed_cost_occurrences_until(conn, cutoff_inclusive)?;
  Ok(net)
}

pub(crate) fn push_depot_stock_purchase_events(
  conn: &rusqlite::Connection,
  names: &std::collections::HashMap<String, String>,
  depot_account_id: &str,
  range_start: &str,
  range_end: &str,
  events: &mut Vec<TimelineEvent>,
  accumulate_buys: bool,
  buys_sum: &mut i64,
) -> AppResult<()> {
  let mut stmt = conn.prepare(
    "SELECT sl.id, sl.buy_date, sl.buy_price_cents, sl.shares, sl.payment_account_id, sl.is_transfer, sh.name
     FROM stock_lots sl
     JOIN stock_holdings sh ON sh.id = sl.holding_id
     WHERE sh.depot_account_id = ?1 AND sl.buy_date >= ?2 AND sl.buy_date <= ?3
     ORDER BY sl.buy_date ASC, sl.created_at ASC",
  )?;
  let rows = stmt.query_map(params![depot_account_id, range_start, range_end], |r| {
    Ok((
      r.get::<_, String>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, i64>(2)?,
      r.get::<_, f64>(3)?,
      r.get::<_, Option<String>>(4)?,
      r.get::<_, i64>(5)?,
      r.get::<_, String>(6)?,
    ))
  })?;
  for row in rows {
    let (lot_id, buy_date, buy_price_cents, shares, payment_account_id, is_transfer, stock_name) = row?;
    if is_transfer != 0 {
      continue;
    }
    let Some(payment_account_id) = payment_account_id else {
      continue;
    };
    let total_cents = (buy_price_cents as f64 * shares).round() as i64;
    if total_cents <= 0 {
      continue;
    }
    if accumulate_buys {
      *buys_sum += total_cents;
    }
    let payment_name = account_name_of(names, &payment_account_id);
    events.push(TimelineEvent {
      id: format!("stock_lot:{}", lot_id),
      r#type: "stock_purchase".into(),
      date: buy_date,
      title: format!("Aktienkauf: {}", stock_name.trim()),
      amount_cents: -total_cents,
      account_id: Some(payment_account_id),
      account_name: Some(format!("Abbuchung: {payment_name}")),
      internal_transfer: false,
      fixed_cost_id: None,
      variable_cost_id: None,
      buy_item_id: None,
      buy_item_group_id: None,
      notes: None,
    });
  }
  Ok(())
}

pub(crate) fn push_all_depot_stock_purchase_events(
  conn: &rusqlite::Connection,
  names: &std::collections::HashMap<String, String>,
  range_start: &str,
  range_end: &str,
  events: &mut Vec<TimelineEvent>,
) -> AppResult<()> {
  let mut stmt = conn.prepare("SELECT id FROM accounts WHERE balance_source = 'stock_portfolio'")?;
  let depot_ids = stmt
    .query_map([], |r| r.get::<_, String>(0))?
    .collect::<Result<Vec<_>, _>>()?;
  for depot_id in depot_ids {
    push_depot_stock_purchase_events(
      conn,
      names,
      &depot_id,
      range_start,
      range_end,
      events,
      false,
      &mut 0,
    )?;
  }
  Ok(())
}

pub(crate) fn account_effective_balance_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_id: &str,
  stock_portfolio_cents: Option<i64>,
) -> AppResult<i64> {
  if account_balance_source(conn, account_id)? == "stock_portfolio" {
    return Ok(stock_portfolio_cents.unwrap_or(0));
  }
  ledger_account_balance_until(conn, date_inclusive, account_id)
}

pub(crate) fn transaction_after_adjustment_anchor(
  tx_date: &str,
  tx_created: &str,
  adj_date: Option<&str>,
  adj_created: Option<&str>,
) -> bool {
  match (adj_date, adj_created) {
    (Some(d), Some(c)) => tx_date > d || (tx_date == d && tx_created > c),
    _ => true,
  }
}

pub(crate) fn ledger_prognostic_income_on_account_until(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_id: &str,
) -> AppResult<i64> {
  use crate::income_actuals::is_prognostic_income_ledger;

  let anchor: Option<(String, String)> = conn
    .query_row(
      "SELECT date, created_at FROM ledger_transactions
       WHERE account_id = ?1 AND kind = 'adjustment' AND date <= ?2
       ORDER BY date DESC, created_at DESC LIMIT 1",
      params![account_id, date_inclusive],
      |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?;
  let (adj_date, adj_created) = match anchor {
    Some((d, c)) => (Some(d), Some(c)),
    None => (None, None),
  };

  let mut stmt = conn.prepare(
    "SELECT amount_cents, source_id, date, created_at FROM ledger_transactions
     WHERE account_id = ?1 AND kind = 'income' AND date <= ?2
       AND source_id LIKE 'income_forecast:%'",
  )?;
  let rows = stmt.query_map(params![account_id, date_inclusive], |r| {
    Ok((
      r.get::<_, i64>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, String>(2)?,
      r.get::<_, String>(3)?,
    ))
  })?;

  let mut sum = 0i64;
  for row in rows {
    let (amount, source_id, tx_date, tx_created) = row?;
    if !transaction_after_adjustment_anchor(
      &tx_date,
      &tx_created,
      adj_date.as_deref(),
      adj_created.as_deref(),
    ) {
      continue;
    }
    if is_prognostic_income_ledger(conn, &source_id)? {
      sum += amount;
    }
  }
  Ok(sum)
}

pub(crate) fn ledger_account_kontostand_until(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_id: &str,
) -> AppResult<i64> {
  let raw = ledger_account_balance_until(conn, date_inclusive, account_id)?;
  let prognostic = ledger_prognostic_income_on_account_until(conn, date_inclusive, account_id)?;
  Ok(raw - prognostic)
}

pub(crate) fn account_kontostand_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_id: &str,
  stock_market_cents: Option<i64>,
  use_depot_cost_basis: bool,
) -> AppResult<i64> {
  if account_balance_source(conn, account_id)? == "stock_portfolio" {
    if use_depot_cost_basis {
      return crate::stocks::depot_cost_basis_cents_until(conn, account_id, date_inclusive);
    }
    return Ok(stock_market_cents.unwrap_or_else(|| 0));
  }
  ledger_account_kontostand_until(conn, date_inclusive, account_id)
}

pub(crate) fn ledger_kontostand_total_until(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  stock_portfolio_cents: Option<i64>,
) -> AppResult<i64> {
  let mut stmt = conn.prepare("SELECT id FROM accounts")?;
  let ids = stmt
    .query_map([], |r| r.get::<_, String>(0))?
    .collect::<Result<Vec<_>, _>>()?;
  let mut total = 0i64;
  for id in ids {
    if account_balance_source(conn, &id)? == "stock_portfolio" {
      total += stock_portfolio_cents.unwrap_or(0);
    } else {
      total += ledger_account_kontostand_until(conn, date_inclusive, &id)?;
    }
  }
  Ok(total)
}

pub(crate) fn kontostand_total_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_filter: &Option<String>,
  stock_portfolio_cents: Option<i64>,
  use_depot_cost_basis: bool,
) -> AppResult<i64> {
  match account_filter {
    None => ledger_kontostand_total_until(conn, date_inclusive, stock_portfolio_cents),
    Some(aid) => account_kontostand_cents(
      conn,
      date_inclusive,
      aid,
      stock_portfolio_cents,
      use_depot_cost_basis,
    ),
  }
}

pub(crate) fn prognostic_total_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_filter: &Option<String>,
  main_id: &str,
  stock_portfolio_cents: Option<i64>,
  include_parked_buys: bool,
) -> AppResult<i64> {
  let forecast = forecast_net_until(
    conn,
    date_inclusive,
    account_filter,
    main_id,
    include_parked_buys,
  )?;
  let vk_double = open_month_categorized_variable_cost_ledger_cents(
    conn,
    date_inclusive,
    account_filter,
    main_id,
  )?;
  let ledger = match account_filter {
    None => ledger_total_until(conn, date_inclusive, stock_portfolio_cents)?,
    Some(aid) => account_effective_balance_cents(conn, date_inclusive, aid, stock_portfolio_cents)?,
  };
  Ok(ledger + forecast - vk_double)
}

pub(crate) fn prognostic_liquid_cents(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  account_filter: &Option<String>,
  main_id: &str,
  stock_portfolio_cents: Option<i64>,
  include_parked_buys: bool,
) -> AppResult<i64> {
  let forecast = forecast_net_until(
    conn,
    date_inclusive,
    account_filter,
    main_id,
    include_parked_buys,
  )?;
  let vk_double = open_month_categorized_variable_cost_ledger_cents(
    conn,
    date_inclusive,
    account_filter,
    main_id,
  )?;
  match account_filter {
    None => Ok(ledger_liquid_total_until(conn, date_inclusive, stock_portfolio_cents)? + forecast - vk_double),
    Some(aid) if aid == main_id => Ok(
      account_effective_balance_cents(conn, date_inclusive, aid, stock_portfolio_cents)? + forecast - vk_double,
    ),
    Some(aid) => {
      let is_liquid: i64 = conn.query_row("SELECT is_liquid FROM accounts WHERE id = ?1", params![aid], |r| r.get(0))?;
      if is_liquid != 0 {
        Ok(account_effective_balance_cents(
          conn,
          date_inclusive,
          aid,
          stock_portfolio_cents,
        )?)
      } else {
        Ok(0)
      }
    }
  }
}

pub(crate) fn ledger_account_balance_until(conn: &rusqlite::Connection, date_inclusive: &str, account_id: &str) -> AppResult<i64> {
  let anchor: Option<(i64, String, String)> = conn
    .query_row(
      "SELECT amount_cents, date, created_at FROM ledger_transactions
       WHERE account_id = ?1 AND kind = 'adjustment' AND date <= ?2
       ORDER BY date DESC, created_at DESC LIMIT 1",
      params![account_id, date_inclusive],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .optional()?;

  let (base, after_date, after_created) = match anchor {
    Some((amount, date, created_at)) => (amount, Some(date), Some(created_at)),
    None => (0i64, None, None),
  };

  let normal: i64 = if let (Some(adj_date), Some(adj_created)) = (&after_date, &after_created) {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions
       WHERE account_id = ?1 AND kind != 'adjustment' AND date <= ?2
         AND (date > ?3 OR (date = ?3 AND created_at > ?4))",
      params![account_id, date_inclusive, adj_date, adj_created],
      |r| r.get(0),
    )?
  } else {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions
       WHERE account_id = ?1 AND kind != 'adjustment' AND date <= ?2",
      params![account_id, date_inclusive],
      |r| r.get(0),
    )?
  };

  let incoming: i64 = if let (Some(adj_date), Some(adj_created)) = (&after_date, &after_created) {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions
       WHERE to_account_id = ?1 AND date <= ?2
         AND (date > ?3 OR (date = ?3 AND created_at > ?4))",
      params![account_id, date_inclusive, adj_date, adj_created],
      |r| r.get(0),
    )?
  } else {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE to_account_id = ?1 AND date <= ?2",
      params![account_id, date_inclusive],
      |r| r.get(0),
    )?
  };

  let outgoing: i64 = if let (Some(adj_date), Some(adj_created)) = (&after_date, &after_created) {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions
       WHERE from_account_id = ?1 AND date <= ?2
         AND (date > ?3 OR (date = ?3 AND created_at > ?4))",
      params![account_id, date_inclusive, adj_date, adj_created],
      |r| r.get(0),
    )?
  } else {
    conn.query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE from_account_id = ?1 AND date <= ?2",
      params![account_id, date_inclusive],
      |r| r.get(0),
    )?
  };

  Ok(base + normal + incoming - outgoing)
}

pub(crate) fn ledger_total_until(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  stock_portfolio_cents: Option<i64>,
) -> AppResult<i64> {
  let mut stmt = conn.prepare("SELECT id FROM accounts")?;
  let ids = stmt
    .query_map([], |r| r.get::<_, String>(0))?
    .collect::<Result<Vec<_>, _>>()?;
  let mut total = 0i64;
  for id in ids {
    total += account_effective_balance_cents(conn, date_inclusive, &id, stock_portfolio_cents)?;
  }
  Ok(total)
}

pub(crate) fn ledger_liquid_total_until(
  conn: &rusqlite::Connection,
  date_inclusive: &str,
  stock_portfolio_cents: Option<i64>,
) -> AppResult<i64> {
  let mut stmt = conn.prepare("SELECT id FROM accounts WHERE is_liquid = 1")?;
  let ids = stmt
    .query_map([], |r| r.get::<_, String>(0))?
    .collect::<Result<Vec<_>, _>>()?;
  let mut total = 0i64;
  for id in ids {
    total += account_effective_balance_cents(conn, date_inclusive, &id, stock_portfolio_cents)?;
  }
  Ok(total)
}

pub(crate) fn ledger_transfers_in_range(conn: &rusqlite::Connection, rs: &str, re: &str) -> AppResult<i64> {
  // informational: sum of transfer amounts in range
  let v: i64 = conn
    .query_row(
      "SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE kind='transfer' AND date >= ?1 AND date <= ?2",
      params![rs, re],
      |r| r.get(0),
    )?;
  Ok(v)
}

