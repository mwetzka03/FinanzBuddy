use crate::bank_import::extract_iban_from_notes_for_migration;
use crate::commands::forecast_variable::{ledger_tx_is_categorizable, resync_variable_cost_months};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use std::collections::HashSet;

pub fn extract_counterparty_iban(notes: Option<&str>) -> Option<String> {
  notes.and_then(extract_iban_from_notes_for_migration)
}

pub fn normalize_expense_category_ids(
  kind: &str,
  variable_cost_id: Option<String>,
  fixed_cost_id: Option<String>,
  buy_item_id: Option<String>,
) -> AppResult<(Option<String>, Option<String>, Option<String>)> {
  let variable = variable_cost_id.filter(|v| !v.trim().is_empty());
  let fixed = fixed_cost_id.filter(|v| !v.trim().is_empty());
  let buy = buy_item_id.filter(|v| !v.trim().is_empty());
  if kind != "expense" {
    if variable.is_some() || fixed.is_some() || buy.is_some() {
      return Err(AppError::Invalid(
        "Kategorie ist nur für Ausgaben möglich".into(),
      ));
    }
    return Ok((None, None, None));
  }
  let assigned = [variable.is_some(), fixed.is_some(), buy.is_some()]
    .into_iter()
    .filter(|v| *v)
    .count();
  if assigned > 1 {
    return Err(AppError::Invalid(
      "Nur eine Kategorie (Fix-, variable Kosten oder Einkaufszettel) gleichzeitig".into(),
    ));
  }
  Ok((variable, fixed, buy))
}

fn validate_fixed_cost_id(conn: &Connection, fc_id: &str) -> AppResult<()> {
  let exists: i64 = conn.query_row(
    "SELECT COUNT(*) FROM fixed_costs WHERE id = ?1",
    params![fc_id],
    |r| r.get(0),
  )?;
  if exists == 0 {
    return Err(AppError::Invalid("Fixkosten nicht gefunden".into()));
  }
  Ok(())
}

fn validate_variable_cost_id(conn: &Connection, vc_id: &str) -> AppResult<()> {
  crate::commands::forecast_variable::validate_variable_cost_id(conn, vc_id)
}

struct AnchorTx {
  id: String,
  date: String,
  account_id: String,
  amount_abs: i64,
  iban: Option<String>,
}

fn load_anchor_tx(conn: &Connection, anchor_id: &str) -> AppResult<AnchorTx> {
  if !ledger_tx_is_categorizable(conn, anchor_id)? {
    return Err(AppError::Invalid(
      "Diese Buchung kann keine Kategorie erhalten".into(),
    ));
  }
  let (kind, amount_cents, account_id, notes): (String, i64, Option<String>, Option<String>) =
    conn.query_row(
      "SELECT kind, amount_cents, account_id, notes FROM ledger_transactions WHERE id = ?1",
      params![anchor_id],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
  if kind != "expense" {
    return Err(AppError::Invalid(
      "Kategorie ist nur für Ausgaben möglich".into(),
    ));
  }
  let account_id = account_id.ok_or_else(|| AppError::Invalid("accountId required".into()))?;
  Ok(AnchorTx {
    id: anchor_id.to_string(),
    date: conn.query_row(
      "SELECT date FROM ledger_transactions WHERE id = ?1",
      params![anchor_id],
      |r| r.get(0),
    )?,
    account_id,
    amount_abs: amount_cents.abs(),
    iban: extract_counterparty_iban(notes.as_deref()),
  })
}

fn matching_expense_ids(conn: &Connection, anchor: &AnchorTx) -> AppResult<Vec<(String, String)>> {
  let mut out = Vec::new();
  let mut stmt = conn.prepare(
    "SELECT id, date, notes FROM ledger_transactions
     WHERE kind = 'expense' AND account_id = ?1 AND ABS(amount_cents) = ?2",
  )?;
  let rows = stmt.query_map(params![anchor.account_id, anchor.amount_abs], |r| {
    Ok((
      r.get::<_, String>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, Option<String>>(2)?,
    ))
  })?;
  for row in rows {
    let (id, date, notes) = row?;
    if !ledger_tx_is_categorizable(conn, &id)? {
      continue;
    }
    if let Some(ref iban) = anchor.iban {
      if extract_counterparty_iban(notes.as_deref()).as_deref() != Some(iban.as_str()) {
        continue;
      }
    } else if id != anchor.id {
      continue;
    }
    out.push((id, date));
  }
  if out.is_empty() {
    out.push((anchor.id.clone(), anchor.date.clone()));
  }
  Ok(out)
}

/// Weist die Kategorie der Anker-Buchung zu und — bei IBAN in den Notizen —
/// alle Ausgaben mit gleichem Betrag und gleicher Gegenkonto-IBAN zu.
pub fn apply_expense_category_assignment(
  conn: &Connection,
  anchor_id: &str,
  variable_cost_id: Option<&str>,
  fixed_cost_id: Option<&str>,
) -> AppResult<()> {
  if let Some(vc_id) = variable_cost_id {
    validate_variable_cost_id(conn, vc_id)?;
  }
  if let Some(fc_id) = fixed_cost_id {
    validate_fixed_cost_id(conn, fc_id)?;
  }

  let anchor = load_anchor_tx(conn, anchor_id)?;
  let targets = matching_expense_ids(conn, &anchor)?;

  let mut months_to_resync: HashSet<String> = HashSet::new();
  let mut old_variable_costs: HashSet<String> = HashSet::new();
  for (id, date) in &targets {
    let (old_vc, old_date): (Option<String>, String) = conn.query_row(
      "SELECT variable_cost_id, date FROM ledger_transactions WHERE id = ?1",
      params![id],
      |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if let Some(old) = old_vc {
      old_variable_costs.insert(old);
      if let Ok(month) = crate::commands::helpers::month_from_date(&old_date) {
        months_to_resync.insert(month);
      }
    }

    let old_buy: Option<String> = conn.query_row(
      "SELECT buy_item_id FROM ledger_transactions WHERE id = ?1",
      params![id],
      |r| r.get(0),
    )?;
    if let Some(ref old_buy) = old_buy {
      crate::buy_assignment::revert_buy_item(conn, old_buy)?;
    }

    conn.execute(
      "UPDATE ledger_transactions SET variable_cost_id = ?2, fixed_cost_id = ?3, buy_item_id = NULL WHERE id = ?1",
      params![id, variable_cost_id, fixed_cost_id],
    )?;

    if let Ok(month) = crate::commands::helpers::month_from_date(date) {
      months_to_resync.insert(month);
    }
  }

  for old_vc in old_variable_costs {
    if Some(old_vc.as_str()) == variable_cost_id {
      continue;
    }
    for month in months_to_resync.clone() {
      crate::commands::forecast_variable::sync_variable_cost_from_transactions(
        conn,
        &old_vc,
        &month,
      )?;
    }
  }

  if let Some(vc_id) = variable_cost_id {
    for month in months_to_resync {
      crate::commands::forecast_variable::sync_variable_cost_from_transactions(
        conn, vc_id, &month,
      )?;
    }
    resync_variable_cost_months(conn, Some(vc_id), Some(anchor.date.as_str()))?;
  }

  Ok(())
}

pub fn count_fixed_cost_bookings_in_range(
  conn: &Connection,
  fixed_cost_id: &str,
  range_start: &str,
  range_end: &str,
) -> AppResult<usize> {
  let count: i64 = conn.query_row(
    "SELECT COUNT(*) FROM ledger_transactions
     WHERE fixed_cost_id = ?1 AND kind = 'expense' AND date >= ?2 AND date <= ?3",
    params![fixed_cost_id, range_start, range_end],
    |r| r.get(0),
  )?;
  Ok(count as usize)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::{migrate, open_db};
  use rusqlite::params;
  use std::path::PathBuf;

  fn test_conn() -> rusqlite::Connection {
    let path = PathBuf::from(std::env::temp_dir()).join(format!(
      "finanzbuddy-cost-assign-{}.sqlite3",
      uuid::Uuid::new_v4()
    ));
    let _ = std::fs::remove_file(&path);
    let conn = open_db(&path).unwrap();
    migrate(&conn).unwrap();
    conn
  }

  fn seed_account(conn: &rusqlite::Connection, id: &str) {
    conn
      .execute(
        "INSERT INTO accounts (id, name, is_liquid, created_at) VALUES (?1, ?2, 1, datetime('now'))",
        params![id, "Main"],
      )
      .unwrap();
    conn
      .execute(
        "INSERT INTO app_settings (key, value) VALUES ('main_account_id', ?1)",
        params![id],
      )
      .unwrap();
  }

  #[test]
  fn propagates_variable_cost_by_iban_and_amount() {
    let conn = test_conn();
    seed_account(&conn, "acc1");
    conn
      .execute(
        "INSERT INTO variable_costs (id, name, amount_cents, charge_day, created_at, account_id)
         VALUES ('vc1', 'Tanken', 5000, 1, datetime('now'), 'acc1')",
        [],
      )
      .unwrap();

    for (id, date, notes) in [
      ("tx1", "2026-06-10", "IBAN: DE00123456789012345678"),
      ("tx2", "2026-07-12", "IBAN: DE00123456789012345678"),
      ("tx3", "2026-07-15", "IBAN: DE00999999999999999999"),
    ] {
      conn
        .execute(
          "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, kind, title, notes, created_at)
           VALUES (?1, ?2, -5000, 'acc1', 'expense', 'Tankstelle', ?3, datetime('now'))",
          params![id, date, notes],
        )
        .unwrap();
    }

    apply_expense_category_assignment(&conn, "tx1", Some("vc1"), None).unwrap();

    let linked: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM ledger_transactions WHERE variable_cost_id = 'vc1'",
        [],
        |r| r.get(0),
      )
      .unwrap();
    assert_eq!(linked, 2);

    let other: Option<String> = conn
      .query_row(
        "SELECT variable_cost_id FROM ledger_transactions WHERE id = 'tx3'",
        [],
        |r| r.get(0),
      )
      .unwrap();
    assert!(other.is_none());
  }

  #[test]
  fn assigns_fixed_cost_without_iban_only_to_anchor() {
    let conn = test_conn();
    seed_account(&conn, "acc1");
    conn
      .execute(
        "INSERT INTO fixed_costs (id, name, amount_cents, cadence, first_charge_date, active, account_id, due_rule)
         VALUES ('fc1', 'Miete', 80000, 'monthly', '2026-01-01', 1, 'acc1', 'calendar_day')",
        [],
      )
      .unwrap();
    for (id, date) in [("tx1", "2026-06-01"), ("tx2", "2026-07-01")] {
      conn
        .execute(
          "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, kind, title, created_at)
           VALUES (?1, ?2, -80000, 'acc1', 'expense', 'Miete', datetime('now'))",
          params![id, date],
        )
        .unwrap();
    }

    apply_expense_category_assignment(&conn, "tx1", None, Some("fc1")).unwrap();

    let fc1: Option<String> = conn
      .query_row(
        "SELECT fixed_cost_id FROM ledger_transactions WHERE id = 'tx1'",
        [],
        |r| r.get(0),
      )
      .unwrap();
    assert_eq!(fc1.as_deref(), Some("fc1"));
    let fc2: Option<String> = conn
      .query_row(
        "SELECT fixed_cost_id FROM ledger_transactions WHERE id = 'tx2'",
        [],
        |r| r.get(0),
      )
      .unwrap();
    assert!(fc2.is_none());
  }
}
