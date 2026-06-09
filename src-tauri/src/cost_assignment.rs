use crate::bank_import::extract_iban_from_notes_for_migration;
use crate::commands::forecast_variable::{ledger_tx_is_categorizable, resync_variable_cost_months};
use crate::commands::helpers::{normalize_color, normalize_icon};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;

pub fn extract_counterparty_iban(notes: Option<&str>) -> Option<String> {
  notes.and_then(extract_iban_from_notes_for_migration)
}

pub fn transaction_purpose_text(title: &str, notes: Option<&str>) -> String {
  format!("{} {}", title, notes.unwrap_or(""))
}

fn purpose_words(name: &str) -> Vec<String> {
  name
    .split(|c: char| !c.is_alphanumeric())
    .map(|w| w.trim().to_lowercase())
    .filter(|w| w.len() >= 3)
    .collect()
}

pub fn fixed_cost_name_matches_purpose(fixed_cost_name: &str, title: &str, notes: Option<&str>) -> bool {
  let purpose = transaction_purpose_text(title, notes).to_lowercase();
  purpose_words(fixed_cost_name)
    .into_iter()
    .any(|word| purpose.contains(&word))
}

pub fn fixed_cost_matches_transaction(
  fixed_cost_name: &str,
  title: &str,
  notes: Option<&str>,
  counterparty_iban: Option<&str>,
) -> bool {
  let Some(iban) = counterparty_iban.filter(|v| !v.trim().is_empty()) else {
    return false;
  };
  if !fixed_cost_name_matches_purpose(fixed_cost_name, title, notes) {
    return false;
  }
  let purpose = transaction_purpose_text(title, notes).to_uppercase();
  purpose.contains(&iban.to_uppercase())
}

pub fn try_match_fixed_cost_id(
  conn: &Connection,
  account_id: &str,
  date: &str,
  title: &str,
  notes: Option<&str>,
  counterparty_iban: Option<&str>,
) -> AppResult<Option<String>> {
  let mut stmt = conn.prepare(
    "SELECT id, name, cadence FROM fixed_costs WHERE active = 1 AND account_id = ?1",
  )?;
  let rows = stmt
    .query_map(params![account_id], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, String>(2)?,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;

  for (id, name, cadence) in rows {
    if !fixed_cost_matches_transaction(&name, title, notes, counterparty_iban) {
      continue;
    }
    if cadence == "monthly" || cadence == "yearly" || cadence == "once" {
      let month = if date.len() >= 7 { &date[..7] } else { date };
      let booked: i64 = conn.query_row(
        "SELECT COUNT(*) FROM ledger_transactions WHERE fixed_cost_id = ?1 AND kind = 'expense' AND substr(date,1,7) = ?2",
        params![id, month],
        |r| r.get(0),
      )?;
      if booked > 0 {
        continue;
      }
    } else {
      let booked: i64 = conn.query_row(
        "SELECT COUNT(*) FROM ledger_transactions WHERE fixed_cost_id = ?1 AND kind = 'expense' AND date = ?2",
        params![id, date],
        |r| r.get(0),
      )?;
      if booked > 0 {
        continue;
      }
    }
    return Ok(Some(id));
  }
  Ok(None)
}

pub fn fixed_cost_style(conn: &Connection, fixed_cost_id: &str) -> AppResult<(String, String)> {
  let row: Option<(Option<String>, Option<String>)> = conn
    .query_row(
      "SELECT icon, color FROM fixed_costs WHERE id = ?1",
      params![fixed_cost_id],
      |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?;
  let (icon, color) = row.unwrap_or((None, None));
  Ok((
    normalize_icon(icon, "calendar"),
    normalize_color(color, "#6366f1"),
  ))
}

pub fn variable_cost_style(conn: &Connection, variable_cost_id: &str) -> AppResult<(String, String)> {
  let row: Option<(Option<String>, Option<String>)> = conn
    .query_row(
      "SELECT icon, color FROM variable_costs WHERE id = ?1",
      params![variable_cost_id],
      |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?;
  let (icon, color) = row.unwrap_or((None, None));
  Ok((
    normalize_icon(icon, "wallet"),
    normalize_color(color, "#6366f1"),
  ))
}

fn apply_category_style_to_ledgers(
  conn: &Connection,
  ledger_ids: &[String],
  variable_cost_id: Option<&str>,
  fixed_cost_id: Option<&str>,
) -> AppResult<()> {
  let (icon, color) = if let Some(fc_id) = fixed_cost_id {
    fixed_cost_style(conn, fc_id)?
  } else if let Some(vc_id) = variable_cost_id {
    variable_cost_style(conn, vc_id)?
  } else {
    return Ok(());
  };
  for id in ledger_ids {
    conn.execute(
      "UPDATE ledger_transactions SET icon = ?2, color = ?3 WHERE id = ?1",
      params![id, icon, color],
    )?;
  }
  Ok(())
}

pub fn sync_ledger_style_for_fixed_cost(conn: &Connection, fixed_cost_id: &str) -> AppResult<()> {
  let (icon, color) = fixed_cost_style(conn, fixed_cost_id)?;
  conn.execute(
    "UPDATE ledger_transactions SET icon = ?2, color = ?3 WHERE fixed_cost_id = ?1 AND kind = 'expense'",
    params![fixed_cost_id, icon, color],
  )?;
  Ok(())
}

pub fn sync_ledger_style_for_variable_cost(conn: &Connection, variable_cost_id: &str) -> AppResult<()> {
  let (icon, color) = variable_cost_style(conn, variable_cost_id)?;
  conn.execute(
    "UPDATE ledger_transactions SET icon = ?2, color = ?3 WHERE variable_cost_id = ?1 AND kind = 'expense'",
    params![variable_cost_id, icon, color],
  )?;
  Ok(())
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
  iban: Option<String>,
}

fn load_anchor_tx(conn: &Connection, anchor_id: &str) -> AppResult<AnchorTx> {
  if !ledger_tx_is_categorizable(conn, anchor_id)? {
    return Err(AppError::Invalid(
      "Diese Buchung kann keine Kategorie erhalten".into(),
    ));
  }
  let (kind, account_id, notes): (String, Option<String>, Option<String>) = conn.query_row(
    "SELECT kind, account_id, notes FROM ledger_transactions WHERE id = ?1",
    params![anchor_id],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
  )?;
  if kind != "expense" {
    return Err(AppError::Invalid(
      "Kategorie ist nur für Ausgaben möglich".into(),
    ));
  }
  let account_id = account_id.ok_or_else(|| AppError::Invalid("accountId required".into()))?;
  let iban = extract_counterparty_iban(notes.as_deref());
  Ok(AnchorTx {
    id: anchor_id.to_string(),
    date: conn.query_row(
      "SELECT date FROM ledger_transactions WHERE id = ?1",
      params![anchor_id],
      |r| r.get(0),
    )?,
    account_id,
    iban,
  })
}

fn matching_fixed_cost_expense_ids(
  conn: &Connection,
  anchor: &AnchorTx,
  fixed_cost_id: &str,
) -> AppResult<Vec<(String, String)>> {
  let fc_name: String = conn.query_row(
    "SELECT name FROM fixed_costs WHERE id = ?1",
    params![fixed_cost_id],
    |r| r.get(0),
  )?;
  let Some(ref iban) = anchor.iban else {
    return Ok(vec![]);
  };
  let mut out = Vec::new();
  let mut stmt = conn.prepare(
    "SELECT id, date, title, notes, fixed_cost_id, variable_cost_id, buy_item_id
     FROM ledger_transactions
     WHERE kind = 'expense' AND account_id = ?1",
  )?;
  let rows = stmt.query_map(params![anchor.account_id], |r| {
    Ok((
      r.get::<_, String>(0)?,
      r.get::<_, String>(1)?,
      r.get::<_, String>(2)?,
      r.get::<_, Option<String>>(3)?,
      r.get::<_, Option<String>>(4)?,
      r.get::<_, Option<String>>(5)?,
      r.get::<_, Option<String>>(6)?,
    ))
  })?;
  for row in rows {
    let (id, date, title, notes, fixed_cost_id, variable_cost_id, buy_item_id) = row?;
    if id == anchor.id {
      continue;
    }
    if !ledger_tx_is_categorizable(conn, &id)? {
      continue;
    }
    if fixed_cost_id.is_some() || variable_cost_id.is_some() || buy_item_id.is_some() {
      continue;
    }
    if fixed_cost_matches_transaction(&fc_name, &title, notes.as_deref(), Some(iban.as_str())) {
      out.push((id, date));
    }
  }
  Ok(out)
}

/// Entfernt die Fixkosten-Zuordnung von einer einzelnen Buchung.
pub fn clear_fixed_cost_from_transaction(conn: &Connection, ledger_id: &str) -> AppResult<()> {
  if !ledger_tx_is_categorizable(conn, ledger_id)? {
    return Err(AppError::Invalid("Diese Buchung kann nicht geändert werden".into()));
  }
  let fixed_cost_id: Option<String> = conn.query_row(
    "SELECT fixed_cost_id FROM ledger_transactions WHERE id = ?1",
    params![ledger_id],
    |r| r.get(0),
  )?;
  if fixed_cost_id.is_none() {
    return Ok(());
  }
  conn.execute(
    "UPDATE ledger_transactions SET fixed_cost_id = NULL WHERE id = ?1",
    params![ledger_id],
  )?;
  Ok(())
}

/// Weist die Kategorie der Anker-Buchung zu. Fixkosten: optional IBAN + Wort im Verwendungszweck.
/// Variable Kosten: nur die gewählte Buchung (keine automatische Mehrfachzuordnung).
pub fn apply_expense_category_assignment(
  conn: &Connection,
  anchor_id: &str,
  variable_cost_id: Option<&str>,
  fixed_cost_id: Option<&str>,
  assign_similar_fixed_cost: bool,
) -> AppResult<()> {
  if let Some(vc_id) = variable_cost_id {
    validate_variable_cost_id(conn, vc_id)?;
  }
  if let Some(fc_id) = fixed_cost_id {
    validate_fixed_cost_id(conn, fc_id)?;
  }

  let anchor = load_anchor_tx(conn, anchor_id)?;
  let targets = if variable_cost_id.is_some() {
    vec![(anchor.id.clone(), anchor.date.clone())]
  } else if let Some(fc_id) = fixed_cost_id {
    let mut targets = if assign_similar_fixed_cost {
      matching_fixed_cost_expense_ids(conn, &anchor, fc_id)?
    } else {
      Vec::new()
    };
    if !targets.iter().any(|(id, _)| id == &anchor.id) {
      targets.insert(0, (anchor.id.clone(), anchor.date.clone()));
    }
    targets
  } else {
    vec![(anchor.id.clone(), anchor.date.clone())]
  };

  let mut months_to_resync: HashSet<String> = HashSet::new();
  let mut old_variable_costs: HashSet<String> = HashSet::new();
  let mut styled_ids: Vec<String> = Vec::new();
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
    styled_ids.push(id.clone());

    if let Ok(month) = crate::commands::helpers::month_from_date(date) {
      months_to_resync.insert(month);
    }
  }

  apply_category_style_to_ledgers(conn, &styled_ids, variable_cost_id, fixed_cost_id)?;

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
  fn variable_cost_assignment_only_on_anchor() {
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
    ] {
      conn
        .execute(
          "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, kind, title, notes, created_at)
           VALUES (?1, ?2, -5000, 'acc1', 'expense', 'Tankstelle', ?3, datetime('now'))",
          params![id, date, notes],
        )
        .unwrap();
    }

    apply_expense_category_assignment(&conn, "tx1", Some("vc1"), None, false).unwrap();

    let linked: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM ledger_transactions WHERE variable_cost_id = 'vc1'",
        [],
        |r| r.get(0),
      )
      .unwrap();
    assert_eq!(linked, 1);
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

    apply_expense_category_assignment(&conn, "tx1", None, Some("fc1"), false).unwrap();

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

  #[test]
  fn matches_fixed_cost_by_iban_and_name_word() {
    assert!(fixed_cost_matches_transaction(
      "Netflix",
      "Abbuchung",
      Some("Buchungstext: Netflix.com IBAN: DE12345678901234567890"),
      Some("DE12345678901234567890"),
    ));
    assert!(!fixed_cost_matches_transaction(
      "Netflix",
      "Abbuchung",
      Some("Buchungstext: Spotify IBAN: DE12345678901234567890"),
      Some("DE12345678901234567890"),
    ));
  }

  #[test]
  fn similar_fixed_cost_assignment_skips_already_linked() {
    let conn = test_conn();
    seed_account(&conn, "acc1");
    let iban = "LU89751000135104200E";
    let notes = format!("Apple Services IBAN: {iban}");
    for (fc_id, fc_name) in [("fc_music", "Apple Music"), ("fc_icloud", "Apple iCloud")] {
      conn
        .execute(
          "INSERT INTO fixed_costs (id, name, amount_cents, cadence, first_charge_date, active, account_id, due_rule)
           VALUES (?1, ?2, 999, 'monthly', '2026-01-01', 1, 'acc1', 'calendar_day')",
          params![fc_id, fc_name],
        )
        .unwrap();
    }
    for (id, date) in [("tx_music", "2026-06-03"), ("tx_icloud", "2026-06-10")] {
      conn
        .execute(
          "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, kind, title, notes, created_at)
           VALUES (?1, ?2, -999, 'acc1', 'expense', 'Apple', ?3, datetime('now'))",
          params![id, date, notes],
        )
        .unwrap();
    }

    apply_expense_category_assignment(&conn, "tx_music", None, Some("fc_music"), true).unwrap();
    apply_expense_category_assignment(&conn, "tx_icloud", None, Some("fc_icloud"), true).unwrap();

    let music_fc: Option<String> = conn
      .query_row(
        "SELECT fixed_cost_id FROM ledger_transactions WHERE id = 'tx_music'",
        [],
        |r| r.get(0),
      )
      .unwrap();
    let icloud_fc: Option<String> = conn
      .query_row(
        "SELECT fixed_cost_id FROM ledger_transactions WHERE id = 'tx_icloud'",
        [],
        |r| r.get(0),
      )
      .unwrap();
    assert_eq!(music_fc.as_deref(), Some("fc_music"));
    assert_eq!(icloud_fc.as_deref(), Some("fc_icloud"));
  }

  #[test]
  fn single_fixed_cost_assignment_only_updates_anchor() {
    let conn = test_conn();
    seed_account(&conn, "acc1");
    conn
      .execute(
        "INSERT INTO fixed_costs (id, name, amount_cents, cadence, first_charge_date, active, account_id, due_rule)
         VALUES ('fc1', 'Apple Music', 999, 'monthly', '2026-01-01', 1, 'acc1', 'calendar_day')",
        [],
      )
      .unwrap();
    let notes = "Apple Services IBAN: LU89751000135104200E";
    for (id, date) in [("tx1", "2026-06-03"), ("tx2", "2026-06-10")] {
      conn
        .execute(
          "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, kind, title, notes, created_at)
           VALUES (?1, ?2, -999, 'acc1', 'expense', 'Apple', ?3, datetime('now'))",
          params![id, date, notes],
        )
        .unwrap();
    }

    apply_expense_category_assignment(&conn, "tx1", None, Some("fc1"), false).unwrap();

    let fc1: Option<String> = conn
      .query_row(
        "SELECT fixed_cost_id FROM ledger_transactions WHERE id = 'tx1'",
        [],
        |r| r.get(0),
      )
      .unwrap();
    let fc2: Option<String> = conn
      .query_row(
        "SELECT fixed_cost_id FROM ledger_transactions WHERE id = 'tx2'",
        [],
        |r| r.get(0),
      )
      .unwrap();
    assert_eq!(fc1.as_deref(), Some("fc1"));
    assert!(fc2.is_none());
  }
}
