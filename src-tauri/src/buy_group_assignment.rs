use crate::buy_assignment::revert_buy_item;
use crate::commands::forecast_variable::ledger_tx_is_categorizable;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};

fn validate_buy_item_group_id(conn: &Connection, group_id: &str) -> AppResult<()> {
  let exists: i64 = conn.query_row(
    "SELECT COUNT(*) FROM buy_item_groups WHERE id = ?1",
    params![group_id],
    |r| r.get(0),
  )?;
  if exists == 0 {
    return Err(AppError::Invalid("Einkaufszettel-Gruppierung nicht gefunden".into()));
  }
  Ok(())
}

pub fn revert_buy_group(conn: &Connection, group_id: &str) -> AppResult<()> {
  let member_ids: Vec<String> = conn
    .prepare("SELECT id FROM buy_items WHERE group_id = ?1")?
    .query_map(params![group_id], |r| r.get(0))?
    .collect::<Result<Vec<_>, _>>()?;
  for item_id in member_ids {
    revert_buy_item(conn, &item_id)?;
  }
  conn.execute(
    "UPDATE ledger_transactions SET buy_item_group_id = NULL WHERE buy_item_group_id = ?1",
    params![group_id],
  )?;
  Ok(())
}

pub fn apply_buy_group_assignment(
  conn: &Connection,
  anchor_id: &str,
  group_id: Option<&str>,
) -> AppResult<()> {
  if !ledger_tx_is_categorizable(conn, anchor_id)? {
    return Err(AppError::Invalid(
      "Diese Buchung kann keiner Gruppierung zugeordnet werden".into(),
    ));
  }
  let (kind, date): (String, String) = conn.query_row(
    "SELECT kind, date FROM ledger_transactions WHERE id = ?1",
    params![anchor_id],
    |r| Ok((r.get(0)?, r.get(1)?)),
  )?;
  if kind != "expense" {
    if group_id.is_some() {
      return Err(AppError::Invalid(
        "Einkaufszettel-Gruppe ist nur für Ausgaben möglich".into(),
      ));
    }
    return Ok(());
  }

  let old_group: Option<String> = conn.query_row(
    "SELECT buy_item_group_id FROM ledger_transactions WHERE id = ?1",
    params![anchor_id],
    |r| r.get(0),
  )?;

  let new_group = group_id.filter(|v| !v.trim().is_empty()).map(str::to_string);
  if old_group.as_deref() == new_group.as_deref() {
    return Ok(());
  }

  if let Some(ref old) = old_group {
    revert_buy_group(conn, old)?;
  }

  if let Some(ref gid) = new_group {
    validate_buy_item_group_id(conn, gid)?;
    let member_ids: Vec<String> = conn
      .prepare("SELECT id FROM buy_items WHERE group_id = ?1 AND status = 'parked'")?
      .query_map(params![gid], |r| r.get(0))?
      .collect::<Result<Vec<_>, _>>()?;
    if member_ids.is_empty() {
      return Err(AppError::Invalid(
        "Gruppierung hat keine offenen Einträge mehr".into(),
      ));
    }
    for item_id in &member_ids {
      conn.execute(
        "DELETE FROM ledger_transactions WHERE source_id = ?1 AND kind = 'buy_apply'",
        params![item_id],
      )?;
      conn.execute(
        "UPDATE buy_items SET status = 'applied', applied_date = ?2 WHERE id = ?1",
        params![item_id, date],
      )?;
    }
    conn.execute(
      "UPDATE ledger_transactions SET buy_item_group_id = ?2, buy_item_id = NULL, variable_cost_id = NULL, fixed_cost_id = NULL WHERE id = ?1",
      params![anchor_id, gid],
    )?;
    let (icon, color) = crate::buy_assignment::buy_item_group_style(conn, gid)?;
    crate::buy_assignment::apply_buy_style_to_ledger(conn, anchor_id, &icon, &color)?;
  } else {
    conn.execute(
      "UPDATE ledger_transactions SET buy_item_group_id = NULL WHERE id = ?1",
      params![anchor_id],
    )?;
  }

  Ok(())
}

pub fn clear_buy_group_assignment_for_transaction(conn: &Connection, tx_id: &str) -> AppResult<()> {
  let old_group: Option<String> = conn.query_row(
    "SELECT buy_item_group_id FROM ledger_transactions WHERE id = ?1",
    params![tx_id],
    |r| r.get(0),
  )?;
  if let Some(ref gid) = old_group {
    revert_buy_group(conn, gid)?;
  }
  conn.execute(
    "UPDATE ledger_transactions SET buy_item_group_id = NULL WHERE id = ?1",
    params![tx_id],
  )?;
  Ok(())
}
