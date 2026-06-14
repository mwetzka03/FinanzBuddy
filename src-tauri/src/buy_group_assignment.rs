use crate::buy_assignment::{apply_buy_style_to_ledger, buy_item_group_style, revert_buy_item};
use crate::commands::forecast_variable::ledger_tx_is_categorizable;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuyGroupSplitInput {
  pub buy_item_id: String,
  pub amount_cents: i64,
}

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

pub fn list_ledger_buy_group_splits(
  conn: &Connection,
  ledger_id: &str,
) -> AppResult<Vec<BuyGroupSplitInput>> {
  let mut stmt = conn.prepare(
    "SELECT buy_item_id, amount_cents FROM ledger_buy_group_splits WHERE ledger_transaction_id = ?1 ORDER BY created_at ASC",
  )?;
  let rows = stmt
    .query_map(params![ledger_id], |r| {
      Ok(BuyGroupSplitInput {
        buy_item_id: r.get(0)?,
        amount_cents: r.get(1)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

fn revert_splits_for_ledger(conn: &Connection, ledger_id: &str) -> AppResult<()> {
  let item_ids: Vec<String> = conn
    .prepare("SELECT buy_item_id FROM ledger_buy_group_splits WHERE ledger_transaction_id = ?1")?
    .query_map(params![ledger_id], |r| r.get(0))?
    .collect::<Result<Vec<_>, _>>()?;
  conn.execute(
    "DELETE FROM ledger_buy_group_splits WHERE ledger_transaction_id = ?1",
    params![ledger_id],
  )?;
  for item_id in item_ids {
    revert_buy_item(conn, &item_id)?;
  }
  Ok(())
}

pub fn build_full_group_splits(
  conn: &Connection,
  group_id: &str,
  tx_total_cents: i64,
) -> AppResult<Vec<BuyGroupSplitInput>> {
  let rows: Vec<(String, i64)> = conn
    .prepare("SELECT id, amount_cents FROM buy_items WHERE group_id = ?1 AND status = 'parked'")?
    .query_map(params![group_id], |r| Ok((r.get(0)?, r.get(1)?)))?
    .collect::<Result<Vec<_>, _>>()?;
  if rows.is_empty() {
    return Err(AppError::Invalid(
      "Gruppierung hat keine offenen Einträge mehr".into(),
    ));
  }
  let sum: i64 = rows.iter().map(|(_, cents)| *cents).sum();
  if sum != tx_total_cents {
    return Err(AppError::Invalid(format!(
      "Buchungsbetrag ({:.2} EUR) entspricht nicht der Summe der Gruppe ({:.2} EUR)",
      tx_total_cents as f64 / 100.0,
      sum as f64 / 100.0
    )));
  }
  Ok(rows
    .into_iter()
    .map(|(buy_item_id, amount_cents)| BuyGroupSplitInput {
      buy_item_id,
      amount_cents,
    })
    .collect())
}

pub fn apply_buy_group_assignment(
  conn: &Connection,
  anchor_id: &str,
  group_id: Option<&str>,
  splits: Option<&[BuyGroupSplitInput]>,
) -> AppResult<()> {
  if !ledger_tx_is_categorizable(conn, anchor_id)? {
    return Err(AppError::Invalid(
      "Diese Buchung kann keiner Gruppierung zugeordnet werden".into(),
    ));
  }
  let (kind, date, amount_cents): (String, String, i64) = conn.query_row(
    "SELECT kind, date, amount_cents FROM ledger_transactions WHERE id = ?1",
    params![anchor_id],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
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
  if old_group.as_deref() == new_group.as_deref() && splits.is_none() {
    return Ok(());
  }

  revert_splits_for_ledger(conn, anchor_id)?;

  if let Some(ref gid) = new_group {
    validate_buy_item_group_id(conn, gid)?;
    let split_rows = splits.ok_or_else(|| {
      AppError::Invalid("Bitte Betrag auf Gruppeneinträge aufteilen".into())
    })?;
    if split_rows.is_empty() {
      return Err(AppError::Invalid(
        "Mindestens ein Gruppeneintrag mit Betrag erforderlich".into(),
      ));
    }

    let tx_total = amount_cents.abs();
    let mut split_sum = 0i64;
    let mut seen_items = std::collections::HashSet::new();
    for split in split_rows {
      if split.amount_cents <= 0 {
        return Err(AppError::Invalid(
          "Aufteilungsbeträge müssen positiv sein".into(),
        ));
      }
      if !seen_items.insert(split.buy_item_id.clone()) {
        return Err(AppError::Invalid(
          "Jeder Gruppeneintrag darf nur einmal zugeordnet werden".into(),
        ));
      }
      split_sum += split.amount_cents;

      let (item_group, status): (Option<String>, String) = conn.query_row(
        "SELECT group_id, status FROM buy_items WHERE id = ?1",
        params![split.buy_item_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
      )?;
      if item_group.as_deref() != Some(gid.as_str()) {
        return Err(AppError::Invalid(
          "Eintrag gehört nicht zu dieser Gruppierung".into(),
        ));
      }

      let linked_other: Option<String> = conn
        .query_row(
          "SELECT ledger_transaction_id FROM ledger_buy_group_splits WHERE buy_item_id = ?1",
          params![split.buy_item_id],
          |r| r.get(0),
        )
        .optional()?;
      if let Some(other) = linked_other {
        if other != anchor_id {
          return Err(AppError::Invalid(
            "Gruppeneintrag ist bereits einer anderen Buchung zugeordnet".into(),
          ));
        }
      }

      if status != "parked" {
        let linked_tx: Option<String> = conn
          .query_row(
            "SELECT ledger_transaction_id FROM ledger_buy_group_splits WHERE buy_item_id = ?1",
            params![split.buy_item_id],
            |r| r.get(0),
          )
          .optional()?;
        if linked_tx.as_deref() != Some(anchor_id) {
          return Err(AppError::Invalid(
            "Gruppeneintrag ist bereits einer anderen Buchung zugeordnet".into(),
          ));
        }
      }
    }

    if split_sum != tx_total {
      return Err(AppError::Invalid(format!(
        "Summe der Aufteilung ({:.2} EUR) muss dem Buchungsbetrag ({:.2} EUR) entsprechen",
        split_sum as f64 / 100.0,
        tx_total as f64 / 100.0
      )));
    }

    let now = chrono::Utc::now().to_rfc3339();
    for split in split_rows {
      conn.execute(
        "INSERT INTO ledger_buy_group_splits (id, ledger_transaction_id, buy_item_id, amount_cents, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
          Uuid::new_v4().to_string(),
          anchor_id,
          split.buy_item_id,
          split.amount_cents,
          now,
        ],
      )?;
      conn.execute(
        "DELETE FROM ledger_transactions WHERE source_id = ?1 AND kind = 'buy_apply'",
        params![split.buy_item_id],
      )?;
      conn.execute(
        "UPDATE buy_items SET status = 'applied', applied_date = ?2 WHERE id = ?1",
        params![split.buy_item_id, date],
      )?;
    }

    conn.execute(
      "UPDATE ledger_transactions SET buy_item_group_id = ?2, buy_item_id = NULL, variable_cost_id = NULL, fixed_cost_id = NULL WHERE id = ?1",
      params![anchor_id, gid],
    )?;
    let (icon, color) = buy_item_group_style(conn, gid)?;
    apply_buy_style_to_ledger(conn, anchor_id, &icon, &color)?;
  } else {
    conn.execute(
      "UPDATE ledger_transactions SET buy_item_group_id = NULL WHERE id = ?1",
      params![anchor_id],
    )?;
  }

  Ok(())
}

pub fn clear_buy_group_assignment_for_transaction(conn: &Connection, tx_id: &str) -> AppResult<()> {
  revert_splits_for_ledger(conn, tx_id)?;
  conn.execute(
    "UPDATE ledger_transactions SET buy_item_group_id = NULL WHERE id = ?1",
    params![tx_id],
  )?;
  Ok(())
}

pub fn revert_buy_group(conn: &Connection, group_id: &str) -> AppResult<()> {
  let ledger_ids: Vec<String> = conn
    .prepare("SELECT DISTINCT ledger_transaction_id FROM ledger_buy_group_splits WHERE buy_item_id IN (SELECT id FROM buy_items WHERE group_id = ?1)")?
    .query_map(params![group_id], |r| r.get(0))?
    .collect::<Result<Vec<_>, _>>()?;
  for ledger_id in ledger_ids {
    revert_splits_for_ledger(conn, &ledger_id)?;
    conn.execute(
      "UPDATE ledger_transactions SET buy_item_group_id = NULL WHERE id = ?1",
      params![ledger_id],
    )?;
  }
  conn.execute(
    "UPDATE ledger_transactions SET buy_item_group_id = NULL WHERE buy_item_group_id = ?1",
    params![group_id],
  )?;
  let member_ids: Vec<String> = conn
    .prepare("SELECT id FROM buy_items WHERE group_id = ?1")?
    .query_map(params![group_id], |r| r.get(0))?
    .collect::<Result<Vec<_>, _>>()?;
  for item_id in member_ids {
    revert_buy_item(conn, &item_id)?;
  }
  Ok(())
}
