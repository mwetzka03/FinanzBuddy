use crate::commands::forecast_variable::ledger_tx_is_categorizable;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};

fn validate_buy_item_id(conn: &Connection, buy_item_id: &str) -> AppResult<()> {
  let exists: i64 = conn.query_row(
    "SELECT COUNT(*) FROM buy_items WHERE id = ?1",
    params![buy_item_id],
    |r| r.get(0),
  )?;
  if exists == 0 {
    return Err(AppError::Invalid("Einkaufszettel-Eintrag nicht gefunden".into()));
  }
  Ok(())
}

pub fn revert_buy_item(conn: &Connection, buy_item_id: &str) -> AppResult<()> {
  conn.execute(
    "UPDATE buy_items SET status = 'parked', applied_date = NULL WHERE id = ?1",
    params![buy_item_id],
  )?;
  conn.execute(
    "DELETE FROM ledger_transactions WHERE source_id = ?1 AND kind = 'buy_apply'",
    params![buy_item_id],
  )?;
  Ok(())
}

fn clear_buy_item_on_other_transactions(conn: &Connection, buy_item_id: &str, keep_id: &str) -> AppResult<()> {
  conn.execute(
    "UPDATE ledger_transactions SET buy_item_id = NULL WHERE buy_item_id = ?1 AND id != ?2",
    params![buy_item_id, keep_id],
  )?;
  Ok(())
}

/// 1:1 Zuordnung: Transaktion ↔ Einkaufszettel-Eintrag (nur Anker-Buchung, keine IBAN-Propagation).
pub fn apply_buy_item_assignment(
  conn: &Connection,
  anchor_id: &str,
  buy_item_id: Option<&str>,
) -> AppResult<()> {
  if !ledger_tx_is_categorizable(conn, anchor_id)? {
    return Err(AppError::Invalid(
      "Diese Buchung kann keinem Einkauf zugeordnet werden".into(),
    ));
  }
  let (kind, date): (String, String) = conn.query_row(
    "SELECT kind, date FROM ledger_transactions WHERE id = ?1",
    params![anchor_id],
    |r| Ok((r.get(0)?, r.get(1)?)),
  )?;
  if kind != "expense" {
    if buy_item_id.is_some() {
      return Err(AppError::Invalid(
        "Einkaufszettel ist nur für Ausgaben möglich".into(),
      ));
    }
    return Ok(());
  }

  let old_buy: Option<String> = conn.query_row(
    "SELECT buy_item_id FROM ledger_transactions WHERE id = ?1",
    params![anchor_id],
    |r| r.get(0),
  )?;

  let new_buy = buy_item_id.filter(|v| !v.trim().is_empty()).map(str::to_string);
  if old_buy.as_deref() == new_buy.as_deref() {
    return Ok(());
  }

  if let Some(ref old) = old_buy {
    revert_buy_item(conn, old)?;
  }

  if let Some(ref bid) = new_buy {
    validate_buy_item_id(conn, bid)?;
    let status: String = conn.query_row(
      "SELECT status FROM buy_items WHERE id = ?1",
      params![bid],
      |r| r.get(0),
    )?;
    if status != "parked" && old_buy.as_deref() != Some(bid.as_str()) {
      let linked_tx: Option<String> = conn
        .query_row(
          "SELECT id FROM ledger_transactions WHERE buy_item_id = ?1 LIMIT 1",
          params![bid],
          |r| r.get(0),
        )
        .ok();
      if linked_tx.as_deref() != Some(anchor_id) {
        return Err(AppError::Invalid(
          "Dieser Einkaufszettel-Eintrag ist bereits zugeordnet".into(),
        ));
      }
    }

    clear_buy_item_on_other_transactions(conn, bid, anchor_id)?;
    conn.execute(
      "DELETE FROM ledger_transactions WHERE source_id = ?1 AND kind = 'buy_apply'",
      params![bid],
    )?;
    conn.execute(
      "UPDATE ledger_transactions SET buy_item_id = ?2, variable_cost_id = NULL, fixed_cost_id = NULL WHERE id = ?1",
      params![anchor_id, bid],
    )?;
    conn.execute(
      "UPDATE buy_items SET status = 'applied', applied_date = ?2 WHERE id = ?1",
      params![bid, date],
    )?;
  } else {
    conn.execute(
      "UPDATE ledger_transactions SET buy_item_id = NULL WHERE id = ?1",
      params![anchor_id],
    )?;
  }

  Ok(())
}

pub fn clear_buy_assignment_for_transaction(conn: &Connection, tx_id: &str) -> AppResult<()> {
  let old_buy: Option<String> = conn.query_row(
    "SELECT buy_item_id FROM ledger_transactions WHERE id = ?1",
    params![tx_id],
    |r| r.get(0),
  )?;
  if let Some(ref bid) = old_buy {
    revert_buy_item(conn, bid)?;
  }
  conn.execute(
    "UPDATE ledger_transactions SET buy_item_id = NULL WHERE id = ?1",
    params![tx_id],
  )?;
  Ok(())
}
