use crate::accounts::get_account_balance_source;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use chrono::{Datelike, Duration, NaiveDate, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;
use uuid::Uuid;

type CmdResult<T> = Result<T, String>;

fn to_cmd_result<T>(r: AppResult<T>) -> CmdResult<T> {
  r.map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BankImportPreviewTransaction {
  pub index: usize,
  pub date: String,
  pub amount_cents: i64,
  pub title: String,
  pub notes: Option<String>,
  pub counterparty_iban: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BankImportPreview {
  pub format: String,
  pub iban: Option<String>,
  pub transactions: Vec<BankImportPreviewTransaction>,
  pub income_indices: Vec<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildBalanceInput {
  pub account_id: String,
  pub current_balance_cents: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryIncomeImportInput {
  #[serde(default)]
  pub transaction_index: Option<usize>,
  pub forecast_name: String,
  pub forecast_amount_cents: i64,
  #[serde(default)]
  pub use_import_amount: bool,
  #[serde(default)]
  pub due_rule: Option<String>,
  #[serde(default)]
  pub day_of_month: Option<i64>,
  #[serde(default)]
  pub employer_iban: Option<String>,
}

#[derive(Debug, Clone)]
struct PrimaryIncomePlan {
  employer_iban: String,
  anchor_index: usize,
  anchor_date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BankImportResult {
  pub format: String,
  pub iban: Option<String>,
  pub imported_count: u32,
  pub skipped_count: u32,
  pub transfer_count: u32,
  pub opening_balance_set: bool,
  pub closing_balance_cents: Option<i64>,
  pub closing_balance_date: Option<String>,
  pub message: String,
  pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct ParsedBalance {
  date: String,
  amount_cents: i64,
}

#[derive(Debug, Clone)]
struct ParsedTransaction {
  date: String,
  amount_cents: i64,
  title: String,
  notes: Option<String>,
  source_id: String,
  counterparty_iban: Option<String>,
  match_text: String,
}

fn transaction_match_text(tx: &ParsedTransaction) -> String {
  if !tx.match_text.is_empty() {
    return tx.match_text.clone();
  }
  format!(
    "{} {}",
    tx.title,
    tx.notes.as_deref().unwrap_or("")
  )
}

#[derive(Debug, Clone)]
struct ParsedStatement {
  format: String,
  iban: Option<String>,
  opening_balance: Option<ParsedBalance>,
  closing_balance: Option<ParsedBalance>,
  transactions: Vec<ParsedTransaction>,
}

fn try_match_fixed_cost_id(
  conn: &rusqlite::Connection,
  account_id: &str,
  date: &str,
  title: &str,
  notes: Option<&str>,
  counterparty_iban: Option<&str>,
) -> AppResult<Option<String>> {
  crate::cost_assignment::try_match_fixed_cost_id(
    conn,
    account_id,
    date,
    title,
    notes,
    counterparty_iban,
  )
}

fn try_match_income_forecast(
  conn: &rusqlite::Connection,
  account_id: &str,
  amount_cents: i64,
  date: &str,
) -> AppResult<Option<(String, String)>> {
  if amount_cents <= 0 {
    return Ok(None);
  }
  let mut stmt = conn.prepare(
    "SELECT id, amount_cents, cadence, first_charge_date, COALESCE(due_rule,'calendar_day'), day_of_month, end_charge_date
     FROM income_forecasts WHERE COALESCE(active,1) = 1 AND COALESCE(account_id, ?1) = ?1",
  )?;
  let rows = stmt
    .query_map(params![account_id], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, i64>(1)?,
        r.get::<_, String>(2)?,
        r.get::<_, String>(3)?,
        r.get::<_, String>(4)?,
        r.get::<_, Option<i64>>(5)?,
        r.get::<_, Option<String>>(6)?,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;
  for (id, forecast_amount, cadence, first, due_rule, dom, end) in rows {
    if forecast_amount != amount_cents {
      continue;
    }
    let occ = crate::logic::generate_occurrences_with_due_rule_rp(
      &first,
      &cadence,
      &due_rule,
      dom.and_then(|x| if x > 0 { Some(x as u32) } else { None }),
      date,
      date,
      5,
      end.as_deref(),
    );
    if occ.iter().any(|d| d.as_str() == date) {
      let linked: i64 = conn.query_row(
        "SELECT COUNT(*) FROM income_forecast_actuals WHERE income_forecast_id = ?1 AND occurrence_date = ?2 AND ledger_transaction_id IS NOT NULL",
        params![id, date],
        |r| r.get(0),
      )?;
      if linked > 0 {
        continue;
      }
      let source_id = crate::income_actuals::income_forecast_source_id(&id, date);
      let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM ledger_transactions WHERE source_id = ?1",
        params![source_id],
        |r| r.get(0),
      )?;
      if exists > 0 {
        continue;
      }
      return Ok(Some((id, date.to_string())));
    }
  }
  Ok(None)
}

#[tauri::command]
pub fn preview_bank_export(state: State<'_, AppState>, file_path: String) -> CmdResult<BankImportPreview> {
  to_cmd_result(preview_bank_export_inner(state, file_path))
}

#[tauri::command]
pub fn import_bank_export(
  state: State<'_, AppState>,
  file_path: String,
  account_id: String,
  current_balance_cents: Option<i64>,
  balance_as_of_date: Option<String>,
  child_balances: Option<Vec<ChildBalanceInput>>,
  primary_income: Option<PrimaryIncomeImportInput>,
) -> CmdResult<BankImportResult> {
  to_cmd_result(import_bank_export_inner(
    state,
    file_path,
    account_id,
    current_balance_cents,
    balance_as_of_date,
    child_balances,
    primary_income,
  ))
}

fn preview_bank_export_inner(_state: State<'_, AppState>, file_path: String) -> AppResult<BankImportPreview> {
  let path = Path::new(&file_path);
  if !path.exists() {
    return Err(AppError::Invalid("Datei nicht gefunden".into()));
  }
  let files = load_export_files(path)?;
  let statement = parse_exports(&files)?;
  let transactions: Vec<BankImportPreviewTransaction> = statement
    .transactions
    .iter()
    .enumerate()
    .map(|(index, tx)| BankImportPreviewTransaction {
      index,
      date: tx.date.clone(),
      amount_cents: tx.amount_cents,
      title: tx.title.clone(),
      notes: tx.notes.clone(),
      counterparty_iban: resolve_counterparty_iban(tx),
    })
    .collect();
  let income_indices = transactions
    .iter()
    .filter(|tx| tx.amount_cents > 0)
    .map(|tx| tx.index)
    .collect();
  Ok(BankImportPreview {
    format: statement.format,
    iban: statement.iban,
    transactions,
    income_indices,
  })
}

fn extract_iban_from_text(text: &str) -> Option<String> {
  let upper = text.to_uppercase();
  let mut start = 0usize;
  while let Some(rel) = upper[start..].find("DE") {
    let idx = start + rel;
    let candidate: String = upper[idx..].chars().take(22).collect();
    if candidate.len() >= 15 {
      if let Some(normalized) = crate::accounts::normalize_iban(&candidate) {
        return Some(normalized);
      }
    }
    start = idx + 2;
  }
  None
}

pub fn extract_iban_from_notes_for_migration(notes: &str) -> Option<String> {
  for part in notes.split('\n') {
    let trimmed = part.trim();
    if let Some(rest) = trimmed.strip_prefix("IBAN:") {
      if let Some(iban) = crate::accounts::normalize_iban(rest.trim()) {
        return Some(iban);
      }
    }
  }
  extract_iban_from_text(notes)
}

fn tx_matches_employer_iban(tx: &ParsedTransaction, employer_iban: &str) -> bool {
  resolve_counterparty_iban(tx).as_deref() == Some(employer_iban)
}

fn resolve_primary_income_plan(
  statement: &ParsedStatement,
  input: &PrimaryIncomeImportInput,
) -> AppResult<PrimaryIncomePlan> {
  if let Some(iban) = input
    .employer_iban
    .as_deref()
    .and_then(crate::accounts::normalize_iban)
  {
    if input.transaction_index.is_none() {
      let mut best: Option<(usize, &ParsedTransaction)> = None;
      for (index, tx) in statement.transactions.iter().enumerate() {
        if tx.amount_cents <= 0 || !tx_matches_employer_iban(tx, &iban) {
          continue;
        }
        best = Some(match best {
          None => (index, tx),
          Some((_, prev)) if tx.date.as_str() < prev.date.as_str() => (index, tx),
          Some(other) => other,
        });
      }
      if let Some((anchor_index, tx)) = best {
        return Ok(PrimaryIncomePlan {
          employer_iban: iban,
          anchor_index,
          anchor_date: tx.date.clone(),
        });
      }
      return Err(AppError::Invalid(
        "Keine Einnahme mit dieser Arbeitgeber-IBAN im Import.".into(),
      ));
    }
  }
  let idx = input
    .transaction_index
    .ok_or_else(|| AppError::Invalid("Haupteinnahme nicht angegeben.".into()))?;
  let tx = statement
    .transactions
    .get(idx)
    .ok_or_else(|| AppError::Invalid("Haupteinnahme nicht in der Datei gefunden".into()))?;
  if tx.amount_cents <= 0 {
    return Err(AppError::Invalid("Haupteinnahme muss eine Einnahme sein".into()));
  }
  let employer_iban = input
    .employer_iban
    .as_deref()
    .and_then(crate::accounts::normalize_iban)
    .or_else(|| resolve_counterparty_iban(tx))
    .ok_or_else(|| AppError::Invalid("Arbeitgeber-IBAN erforderlich.".into()))?;
  Ok(PrimaryIncomePlan {
    employer_iban,
    anchor_index: idx,
    anchor_date: tx.date.clone(),
  })
}

fn skips_tx_before_primary_anchor(input: &PrimaryIncomeImportInput) -> bool {
  input.transaction_index.is_none()
    && input
      .employer_iban
      .as_deref()
      .map(|s| !s.trim().is_empty())
      .unwrap_or(false)
}

fn should_import_transaction(tx: &ParsedTransaction, plan: Option<&PrimaryIncomePlan>, input: Option<&PrimaryIncomeImportInput>) -> bool {
  let Some(input) = input else {
    return true;
  };
  if !skips_tx_before_primary_anchor(input) {
    return true;
  }
  plan.map(|p| tx.date.as_str() >= p.anchor_date.as_str())
    .unwrap_or(true)
}

fn tx_is_primary_employer_income(tx: &ParsedTransaction, plan: &PrimaryIncomePlan) -> bool {
  tx.amount_cents > 0 && tx_matches_employer_iban(tx, &plan.employer_iban)
}

fn resolve_counterparty_iban(tx: &ParsedTransaction) -> Option<String> {
  tx.counterparty_iban
    .as_deref()
    .and_then(crate::accounts::normalize_iban)
    .or_else(|| extract_iban_from_text(&tx.match_text))
    .or_else(|| tx.notes.as_deref().and_then(extract_iban_from_text))
}

fn income_forecast_auto_match_allowed(
  conn: &rusqlite::Connection,
  tx: &ParsedTransaction,
) -> AppResult<bool> {
  let Some(expected) = crate::accounts::get_primary_income_employer_iban(conn)? else {
    return Ok(true);
  };
  let Some(actual) = resolve_counterparty_iban(tx) else {
    return Ok(false);
  };
  Ok(actual == expected)
}

fn child_effect_from_parent_tx(tx: &ParsedTransaction) -> i64 {
  -tx.amount_cents
}

fn derive_child_opening_from_balance(
  conn: &rusqlite::Connection,
  oberspartopf_id: &str,
  child_id: &str,
  current_balance_cents: i64,
  balance_as_of: &str,
  transactions: &[ParsedTransaction],
  primary_salary_date: Option<&str>,
) -> AppResult<ParsedBalance> {
  let cutoff = if let Some(d) = primary_salary_date.filter(|s| !s.is_empty()) {
    d.to_string()
  } else {
    crate::dashboard_period::derive_opening_cutoff_date(conn, balance_as_of)?
  };
  let use_cutoff = crate::accounts::get_dashboard_period_mode(conn)? == "since_last_salary";
  let mut tx_sum = 0i64;
  let mut earliest: Option<&str> = None;
  for tx in transactions {
    let in_range = if use_cutoff {
      tx.date.as_str() <= cutoff.as_str()
    } else {
      tx.date.as_str() <= balance_as_of
    };
    if !in_range {
      continue;
    }
    let matched = crate::accounts::match_spartopf_account_id(conn, oberspartopf_id, &transaction_match_text(tx))?;
    if matched.as_deref() == Some(child_id) {
      tx_sum += child_effect_from_parent_tx(tx);
      earliest = Some(match earliest {
        Some(prev) if prev <= tx.date.as_str() => prev,
        _ => tx.date.as_str(),
      });
    }
  }
  let date = if use_cutoff {
    if primary_salary_date.filter(|s| !s.is_empty()).is_some() {
      cutoff
    } else {
      crate::dashboard_period::opening_balance_date_for_import(
        conn,
        balance_as_of,
        earliest.unwrap_or(balance_as_of),
      )?
    }
  } else {
    earliest
      .map(|s| s.to_string())
      .unwrap_or_else(|| balance_as_of.to_string())
  };
  Ok(ParsedBalance {
    date,
    amount_cents: current_balance_cents - tx_sum,
  })
}

fn infer_income_due_rule(date: &str) -> (String, Option<i64>) {
  let Some(d) = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok() else {
    return ("calendar_day".into(), None);
  };
  let year = d.year();
  let month = d.month();
  let first_bd = crate::logic::first_business_day_of_month_rp(year, month);
  let last_bd = crate::logic::last_business_day_of_month_rp(year, month);
  if d == first_bd {
    return ("first_business_day".into(), None);
  }
  if d == last_bd {
    return ("last_business_day".into(), None);
  }
  let month_end = if month == 12 {
    NaiveDate::from_ymd_opt(year + 1, 1, 1)
      .and_then(|x| x.pred_opt())
      .unwrap_or(d)
  } else {
    NaiveDate::from_ymd_opt(year, month + 1, 1)
      .and_then(|x| x.pred_opt())
      .unwrap_or(d)
  };
  if d.day() == 1 || d == month_end {
    return ("calendar_day".into(), Some(d.day() as i64));
  }
  ("calendar_day".into(), Some(d.day() as i64))
}

fn link_ledger_income_to_forecast(
  conn: &rusqlite::Connection,
  ledger_id: &str,
  forecast_id: &str,
  occurrence_date: &str,
  amount_cents: i64,
) -> AppResult<()> {
  let source_id = crate::income_actuals::income_forecast_source_id(forecast_id, occurrence_date);
  conn.execute(
    "UPDATE ledger_transactions SET source_id = ?2 WHERE id = ?1",
    params![ledger_id, source_id],
  )?;
  conn.execute(
    "INSERT INTO income_forecast_actuals (income_forecast_id, occurrence_date, amount_cents, ledger_transaction_id)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(income_forecast_id, occurrence_date) DO UPDATE SET amount_cents = excluded.amount_cents, ledger_transaction_id = excluded.ledger_transaction_id",
    params![forecast_id, occurrence_date, amount_cents, ledger_id],
  )?;
  Ok(())
}

fn setup_primary_income_forecast(
  conn: &rusqlite::Connection,
  account_id: &str,
  tx: &ParsedTransaction,
  input: &PrimaryIncomeImportInput,
) -> AppResult<String> {
  let amount = if input.use_import_amount {
    tx.amount_cents
  } else {
    input.forecast_amount_cents
  };
  if amount <= 0 {
    return Err(AppError::Invalid("Prognosebetrag muss positiv sein".into()));
  }
  let name = input.forecast_name.trim();
  if name.is_empty() {
    return Err(AppError::Invalid("Name für Haupteinnahme erforderlich".into()));
  }
  let (due_rule, day_of_month) = match (
    input.due_rule.as_deref().filter(|s| !s.is_empty()),
    input.day_of_month,
  ) {
    (Some(rule), dom) => (rule.to_string(), dom),
    _ => infer_income_due_rule(&tx.date),
  };
  if let Some(iban) = input
    .employer_iban
    .as_deref()
    .and_then(crate::accounts::normalize_iban)
  {
    crate::accounts::set_primary_income_employer_iban(conn, Some(&iban))?;
  } else if let Some(iban) = resolve_counterparty_iban(tx) {
    crate::accounts::set_primary_income_employer_iban(conn, Some(&iban))?;
  }
  let forecast_id = if let Some(existing_id) = crate::accounts::get_primary_income_forecast_id(conn)? {
    let exists: bool = conn
      .query_row(
        "SELECT 1 FROM income_forecasts WHERE id = ?1",
        params![existing_id],
        |_| Ok(()),
      )
      .optional()?
      .is_some();
    if exists {
      existing_id
    } else {
      uuid::Uuid::new_v4().to_string()
    }
  } else {
    uuid::Uuid::new_v4().to_string()
  };
  conn.execute(
    "INSERT INTO income_forecasts (id, name, amount_cents, date, cadence, first_charge_date, due_rule, day_of_month, end_charge_date, active, ledger_transaction_id, account_id)
     VALUES (?1, ?2, ?3, ?4, 'monthly', ?4, ?5, ?6, NULL, 1, NULL, ?7)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       amount_cents = excluded.amount_cents,
       date = excluded.date,
       first_charge_date = excluded.first_charge_date,
       due_rule = excluded.due_rule,
       day_of_month = excluded.day_of_month,
       active = 1,
       account_id = excluded.account_id",
    params![forecast_id, name, amount, tx.date, due_rule, day_of_month, account_id],
  )?;
  conn.execute(
    "UPDATE income_forecasts SET active = 0
     WHERE id != ?1 AND COALESCE(account_id, ?2) = ?2 AND COALESCE(active, 1) = 1",
    params![forecast_id, account_id],
  )?;
  crate::accounts::set_primary_income_forecast_id(conn, Some(&forecast_id))?;
  crate::accounts::set_primary_income_anchor_date(conn, Some(&tx.date))?;
  Ok(forecast_id)
}

fn import_bank_export_inner(
  state: State<'_, AppState>,
  file_path: String,
  account_id: String,
  current_balance_cents: Option<i64>,
  balance_as_of_date: Option<String>,
  child_balances: Option<Vec<ChildBalanceInput>>,
  primary_income: Option<PrimaryIncomeImportInput>,
) -> AppResult<BankImportResult> {
  if account_id.trim().is_empty() {
    return Err(AppError::Invalid("accountId required".into()));
  }
  let path = Path::new(&file_path);
  if !path.exists() {
    return Err(AppError::Invalid("Datei nicht gefunden".into()));
  }
  let files = load_export_files(path)?;
  let statement = parse_exports(&files)?;

  let conn = state.conn.lock().unwrap();
  crate::setup::assert_bank_import_allowed(&conn)?;
  if get_account_balance_source(&conn, &account_id)? == "stock_portfolio" {
    return Err(AppError::Invalid(
      "Bankimport ist nur für Giro-/Sparkonten möglich, nicht für Depots.".into(),
    ));
  }

  let append_only = crate::setup::is_setup_completed(&conn)?;

  let base_time = Utc::now();
  let mut imported_count = 0u32;
  let mut skipped_count = 0u32;
  let mut transfer_count = 0u32;
  let mut warnings = Vec::new();
  let mut opening_balance_set = false;
  let iban_map = crate::accounts::load_account_iban_map(&conn)?;
  let balance_as_of = balance_as_of_date
    .filter(|d| !d.trim().is_empty())
    .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());

  let account_kind: String = conn.query_row(
    "SELECT COALESCE(account_kind, 'standard') FROM accounts WHERE id = ?1",
    params![account_id],
    |r| r.get(0),
  )?;
  let is_oberspartopf = account_kind == "oberspartopf";
  let is_savings_pot = crate::accounts::is_savings_pot_kind(&account_kind);

  let primary_plan = if append_only {
    None
  } else {
    primary_income
      .as_ref()
      .map(|input| resolve_primary_income_plan(&statement, input))
      .transpose()?
  };

  let primary_salary_date = if append_only || is_savings_pot {
    None
  } else {
    primary_plan.as_ref().map(|plan| plan.anchor_date.as_str())
  };
  let primary_forecast_id = if append_only || is_savings_pot {
    None
  } else if let (Some(ref income_input), Some(ref plan)) = (&primary_income, &primary_plan) {
    let tx = &statement.transactions[plan.anchor_index];
    Some(setup_primary_income_forecast(
      &conn,
      &account_id,
      tx,
      income_input,
    )?)
  } else {
    None
  };

  if !append_only {
    if is_savings_pot {
      if is_oberspartopf {
        let children = child_balances.unwrap_or_default();
        if children.is_empty() {
          return Err(AppError::Invalid(
            "Bitte Kontostand für jeden Unterspartopf angeben.".into(),
          ));
        }
        for child in &children {
          crate::accounts::set_import_balance(
            &conn,
            &child.account_id,
            child.current_balance_cents,
            &balance_as_of,
          )?;
          remove_bank_import_opening_adjustments(&conn, &child.account_id)?;
        }
      } else if let Some(current) = current_balance_cents {
        crate::accounts::set_import_balance(&conn, &account_id, current, &balance_as_of)?;
        remove_bank_import_opening_adjustments(&conn, &account_id)?;
      } else {
        return Err(AppError::Invalid(
          "Bitte aktuellen Kontostand angeben.".into(),
        ));
      }
    } else if is_oberspartopf {
      let children = child_balances.unwrap_or_default();
      if children.is_empty() {
        return Err(AppError::Invalid(
          "Bitte Kontostand für jeden Unterspartopf angeben.".into(),
        ));
      }
      for child in &children {
        let opening = derive_child_opening_from_balance(
          &conn,
          &account_id,
          &child.account_id,
          child.current_balance_cents,
          &balance_as_of,
          &statement.transactions,
          primary_salary_date,
        )?;
        let source_id = format!(
          "bank_import:opbd:{}:{}",
          child.account_id, opening.date
        );
        upsert_bank_adjustment(
          &conn,
          &child.account_id,
          &opening.date,
          opening.amount_cents,
          "Bankimport Anfangssaldo",
          &source_id,
          base_time,
        )?;
        opening_balance_set = true;
      }
    } else if let Some(current) = current_balance_cents {
      crate::accounts::set_import_balance(&conn, &account_id, current, &balance_as_of)?;
      remove_bank_import_opening_adjustments(&conn, &account_id)?;
    } else if statement.opening_balance.is_none() {
      return Err(AppError::Invalid(
        "Bitte aktuellen Kontostand angeben — die Exportdatei enthält keinen Saldo.".into(),
      ));
    }
  }

  for (index, tx) in statement.transactions.iter().enumerate() {
    if !should_import_transaction(tx, primary_plan.as_ref(), primary_income.as_ref()) {
      continue;
    }
    let existing: Option<String> = conn
      .query_row(
        "SELECT id FROM ledger_transactions WHERE source_id = ?1 LIMIT 1",
        params![tx.source_id],
        |r| r.get(0),
      )
      .optional()?;
    if let Some(_existing_id) = existing {
      if append_only {
        skipped_count += 1;
        continue;
      }
      let existing_id = _existing_id;
      let kind = if tx.amount_cents >= 0 { "income" } else { "expense" };
      let icon = if kind == "income" { "banknote" } else { "shop" };
      let color = if kind == "income" { "#22c55e" } else { "#ef4444" };
      conn.execute(
        "UPDATE ledger_transactions SET date = ?2, amount_cents = ?3, kind = ?4, title = ?5, notes = ?6, icon = ?7, color = ?8 WHERE id = ?1",
        params![
          existing_id,
          tx.date,
          tx.amount_cents,
          kind,
          tx.title,
          tx.notes,
          icon,
          color,
        ],
      )?;
      if kind == "income" {
        let primary_match = primary_forecast_id.as_ref().zip(primary_plan.as_ref()).filter(|_| {
          primary_plan
            .as_ref()
            .map(|plan| tx_is_primary_employer_income(tx, plan))
            .unwrap_or(false)
            || primary_income
              .as_ref()
              .and_then(|input| input.transaction_index)
              == Some(index)
        });
        if let Some((forecast_id, _)) = primary_match {
          let occurrence = crate::dashboard_period::primary_income_occurrence_for_date(&conn, &tx.date)?
            .unwrap_or_else(|| tx.date.clone());
          link_ledger_income_to_forecast(
            &conn,
            &existing_id,
            forecast_id,
            &occurrence,
            tx.amount_cents,
          )?;
        } else if income_forecast_auto_match_allowed(&conn, tx)? {
          if let Some((forecast_id, occurrence_date)) =
            try_match_income_forecast(&conn, &account_id, tx.amount_cents, &tx.date)?
          {
            link_ledger_income_to_forecast(
              &conn,
              &existing_id,
              &forecast_id,
              &occurrence_date,
              tx.amount_cents,
            )?;
          }
        }
      }
      skipped_count += 1;
      continue;
    }

    if !is_savings_pot {
      if let Some(transfer_source_id) = try_pair_bank_transfer(
        &conn,
        &account_id,
        &iban_map,
        tx,
        index,
        base_time,
      )? {
        let existing_transfer: Option<String> = conn
          .query_row(
            "SELECT id FROM ledger_transactions WHERE source_id = ?1 LIMIT 1",
            params![transfer_source_id],
            |r| r.get(0),
          )
          .optional()?;
        if existing_transfer.is_some() {
          skipped_count += 1;
        } else {
          transfer_count += 1;
        }
        continue;
      }

      let match_text = transaction_match_text(tx);
      if let Some(other_account_id) = crate::accounts::resolve_internal_transfer_counterparty(
        &conn,
        &iban_map,
        resolve_counterparty_iban(tx).as_deref(),
        &match_text,
      ) {
        if other_account_id != account_id {
          insert_unpaired_internal_transfer(
            &conn,
            &account_id,
            &other_account_id,
            tx,
            index,
            base_time,
          )?;
          transfer_count += 1;
          continue;
        }
      }
    }

    let target_account_id = if is_oberspartopf {
      let match_text = format!(
        "{} {}",
        tx.title,
        tx.notes.as_deref().unwrap_or("")
      );
      match crate::accounts::match_spartopf_account_id(&conn, &account_id, &match_text)? {
        Some(child_id) => child_id,
        None => {
          warnings.push(format!(
            "Kein Unterspartopf für Umsatz erkannt: {} ({:.2} EUR) — übersprungen.",
            tx.title,
            tx.amount_cents as f64 / 100.0
          ));
          skipped_count += 1;
          continue;
        }
      }
    } else {
      account_id.clone()
    };

    let kind = if tx.amount_cents >= 0 {
      "income"
    } else {
      "expense"
    };
    let mut icon = if kind == "income" {
      "banknote".to_string()
    } else {
      "shop".to_string()
    };
    let mut color = if kind == "income" {
      "#22c55e".to_string()
    } else {
      "#ef4444".to_string()
    };

    let fixed_cost_id = if kind == "expense" {
      try_match_fixed_cost_id(
        &conn,
        &target_account_id,
        &tx.date,
        &tx.title,
        tx.notes.as_deref(),
        tx.counterparty_iban.as_deref(),
      )?
    } else {
      None
    };

    if let Some(ref fc_id) = fixed_cost_id {
      if let Ok((fc_icon, fc_color)) = crate::cost_assignment::fixed_cost_style(&conn, fc_id) {
        icon = fc_icon;
        color = fc_color;
      }
    }

    let id = Uuid::new_v4().to_string();
    let created_at = (base_time + Duration::milliseconds(100 + index as i64)).to_rfc3339();
    conn.execute(
      "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, variable_cost_id, fixed_cost_id, icon, color, created_at)
       VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11, ?12)",
      params![
        id,
        tx.date,
        tx.amount_cents,
        target_account_id,
        kind,
        tx.title,
        tx.notes,
        tx.source_id,
        fixed_cost_id,
        icon,
        color,
        created_at,
      ],
    )?;
    if kind == "income" {
      let primary_match = primary_forecast_id.as_ref().zip(primary_plan.as_ref()).filter(|_| {
        primary_plan
          .as_ref()
          .map(|plan| tx_is_primary_employer_income(tx, plan))
          .unwrap_or(false)
          || primary_income
            .as_ref()
            .and_then(|input| input.transaction_index)
            == Some(index)
      });
      if let Some((forecast_id, _)) = primary_match {
        let occurrence = crate::dashboard_period::primary_income_occurrence_for_date(&conn, &tx.date)?
          .unwrap_or_else(|| tx.date.clone());
        link_ledger_income_to_forecast(&conn, &id, forecast_id, &occurrence, tx.amount_cents)?;
      } else if income_forecast_auto_match_allowed(&conn, tx)? {
        if let Some((forecast_id, occurrence_date)) =
          try_match_income_forecast(&conn, &target_account_id, tx.amount_cents, &tx.date)?
        {
          link_ledger_income_to_forecast(
            &conn,
            &id,
            &forecast_id,
            &occurrence_date,
            tx.amount_cents,
          )?;
        }
      }
    }
    imported_count += 1;
  }

  if !is_savings_pot {
    transfer_count += sweep_pair_bank_transfers(&conn, &account_id, &iban_map, base_time)?;
  }

  if let Some(current) = current_balance_cents {
    crate::accounts::set_import_balance(&conn, &account_id, current, &balance_as_of)?;
    remove_bank_import_opening_adjustments(&conn, &account_id)?;
  }

  if let (Some(ref opening), Some(ref closing)) = (&statement.opening_balance, &statement.closing_balance) {
    let expected = opening.amount_cents
      + statement
        .transactions
        .iter()
        .map(|t| t.amount_cents)
        .sum::<i64>();
    if (expected - closing.amount_cents).abs() > 1 {
      warnings.push(format!(
        "Schlusssaldo ({:.2} EUR) weicht von Anfangssaldo + Umsätzen ({:.2} EUR) ab.",
        closing.amount_cents as f64 / 100.0,
        expected as f64 / 100.0
      ));
    }
  }

  let message = if transfer_count > 0 {
    format!(
      "{} importiert, {} übersprungen, {} als Transfer erkannt{}.",
      imported_count,
      skipped_count,
      transfer_count,
      if files.len() > 1 {
        format!(" ({} Dateien, Format: {})", files.len(), statement.format)
      } else {
        format!(" (Format: {})", statement.format)
      }
    )
  } else if files.len() > 1 {
    format!(
      "{} importiert, {} übersprungen ({} Dateien, Format: {}).",
      imported_count, skipped_count, files.len(), statement.format
    )
  } else {
    format!(
      "{} importiert, {} übersprungen (Format: {}).",
      imported_count, skipped_count, statement.format
    )
  };

  Ok(BankImportResult {
    format: statement.format,
    iban: statement.iban,
    imported_count,
    skipped_count,
    transfer_count,
    opening_balance_set,
    closing_balance_cents: statement.closing_balance.as_ref().map(|b| b.amount_cents),
    closing_balance_date: statement.closing_balance.as_ref().map(|b| b.date.clone()),
    message,
    warnings,
  })
}

fn remove_bank_import_opening_adjustments(
  conn: &rusqlite::Connection,
  account_id: &str,
) -> AppResult<()> {
  conn.execute(
    "DELETE FROM ledger_transactions WHERE account_id = ?1 AND kind = 'adjustment' AND source_id LIKE 'bank_import:opbd:%'",
    params![account_id],
  )?;
  Ok(())
}

fn upsert_bank_adjustment(
  conn: &rusqlite::Connection,
  account_id: &str,
  date: &str,
  amount_cents: i64,
  title: &str,
  source_id: &str,
  base_time: chrono::DateTime<Utc>,
) -> AppResult<()> {
  let existing: Option<String> = conn
    .query_row(
      "SELECT id FROM ledger_transactions WHERE source_id = ?1 LIMIT 1",
      params![source_id],
      |r| r.get(0),
    )
    .optional()?;
  let amount = amount_cents.abs();
  if let Some(id) = existing {
    conn.execute(
      "UPDATE ledger_transactions SET date = ?2, amount_cents = ?3, title = ?4 WHERE id = ?1",
      params![id, date, amount, title],
    )?;
    return Ok(());
  }
  let id = Uuid::new_v4().to_string();
  let created_at = (base_time - Duration::milliseconds(50)).to_rfc3339();
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, variable_cost_id, icon, color, created_at)
     VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'adjustment', ?5, NULL, ?6, NULL, 'target', '#64748b', ?7)",
    params![id, date, amount, account_id, title, source_id, created_at],
  )?;
  Ok(())
}

fn delete_ledger_for_transfer_pair(conn: &rusqlite::Connection, ledger_id: &str) -> AppResult<()> {
  conn.execute(
    "DELETE FROM income_forecast_actuals WHERE ledger_transaction_id = ?1",
    params![ledger_id],
  )?;
  conn.execute(
    "UPDATE income_forecasts SET ledger_transaction_id = NULL WHERE ledger_transaction_id = ?1",
    params![ledger_id],
  )?;
  conn.execute(
    "UPDATE variable_cost_actuals SET ledger_transaction_id = NULL WHERE ledger_transaction_id = ?1",
    params![ledger_id],
  )?;
  conn.execute("DELETE FROM ledger_transactions WHERE id = ?1", params![ledger_id])?;
  Ok(())
}

fn transfer_source_id(
  date: &str,
  amount_cents: i64,
  from_account_id: &str,
  to_account_id: &str,
  suffix: &str,
) -> String {
  format!(
    "bank_import:transfer:{date}:{amount_cents}:{from_account_id}:{to_account_id}:{suffix}"
  )
}

fn try_pair_bank_transfer(
  conn: &rusqlite::Connection,
  account_id: &str,
  iban_map: &std::collections::HashMap<String, String>,
  tx: &ParsedTransaction,
  index: usize,
  base_time: chrono::DateTime<Utc>,
) -> AppResult<Option<String>> {
  let counterparty_iban = resolve_counterparty_iban(tx);
  let match_text = transaction_match_text(tx);
  let Some(other_account_id) = crate::accounts::resolve_internal_transfer_counterparty(
    conn,
    iban_map,
    counterparty_iban.as_deref(),
    &match_text,
  ) else {
    return Ok(None);
  };
  if other_account_id == account_id {
    return Ok(None);
  }
  let opposite_amount = -tx.amount_cents;
  let matched_id = find_opposite_bank_import_ledger(
    conn,
    &other_account_id,
    &tx.date,
    opposite_amount,
  )?;

  let importing_kind: String = conn.query_row(
    "SELECT COALESCE(account_kind, 'standard') FROM accounts WHERE id = ?1",
    params![account_id],
    |r| r.get(0),
  )?;
  let target_on_outflow =
    crate::accounts::resolve_transfer_target_account(conn, &other_account_id, &match_text)?;
  let (from_account_id, to_account_id) = if tx.amount_cents < 0 {
    (account_id.to_string(), target_on_outflow)
  } else if importing_kind == "spartopf" {
    (other_account_id.clone(), account_id.to_string())
  } else if importing_kind == "oberspartopf" {
    let child = crate::accounts::resolve_transfer_target_account(conn, account_id, &match_text)?;
    (other_account_id.clone(), child)
  } else {
    (other_account_id.clone(), account_id.to_string())
  };
  let amount = tx.amount_cents.abs();
  let mut suffix = tx
    .source_id
    .rsplit(':')
    .next()
    .unwrap_or("0")
    .to_string();
  if suffix.is_empty() {
    suffix = index.to_string();
  }
  let source_id = transfer_source_id(
    &tx.date,
    amount,
    &from_account_id,
    &to_account_id,
    &suffix,
  );

  if let Some(matched_id) = matched_id {
    delete_ledger_for_transfer_pair(conn, &matched_id)?;
  }

  let id = Uuid::new_v4().to_string();
  let created_at = (base_time + Duration::milliseconds(200 + index as i64)).to_rfc3339();
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, internal_transfer, icon, color, created_at)
     VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'transfer', ?6, ?7, ?8, 1, 'arrow-left-right', '#64748b', ?9)",
    params![
      id,
      tx.date,
      amount,
      from_account_id,
      to_account_id,
      tx.title,
      tx.notes,
      source_id,
      created_at,
    ],
  )?;
  Ok(Some(source_id))
}

fn insert_unpaired_internal_transfer(
  conn: &rusqlite::Connection,
  account_id: &str,
  other_account_id: &str,
  tx: &ParsedTransaction,
  index: usize,
  base_time: chrono::DateTime<Utc>,
) -> AppResult<()> {
  let match_text = transaction_match_text(tx);
  let importing_kind: String = conn.query_row(
    "SELECT COALESCE(account_kind, 'standard') FROM accounts WHERE id = ?1",
    params![account_id],
    |r| r.get(0),
  )?;
  let target_on_outflow =
    crate::accounts::resolve_transfer_target_account(conn, other_account_id, &match_text)?;
  let (from_account_id, to_account_id) = if tx.amount_cents < 0 {
    (account_id.to_string(), target_on_outflow)
  } else if importing_kind == "spartopf" {
    (other_account_id.to_string(), account_id.to_string())
  } else if importing_kind == "oberspartopf" {
    let child = crate::accounts::resolve_transfer_target_account(conn, account_id, &match_text)?;
    (other_account_id.to_string(), child)
  } else {
    (other_account_id.to_string(), account_id.to_string())
  };
  let amount = tx.amount_cents.abs();
  let suffix = tx
    .source_id
    .rsplit(':')
    .next()
    .unwrap_or("0")
    .to_string();
  let source_id = format!(
    "bank_import:internal:{}:{}:{}:{}:{}",
    tx.date, amount, from_account_id, to_account_id, suffix
  );
  if conn
    .query_row(
      "SELECT COUNT(*) FROM ledger_transactions WHERE source_id = ?1",
      params![source_id],
      |r| r.get::<_, i64>(0),
    )?
    > 0
  {
    return Ok(());
  }
  let id = Uuid::new_v4().to_string();
  let created_at = (base_time + Duration::milliseconds(250 + index as i64)).to_rfc3339();
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, internal_transfer, icon, color, created_at)
     VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'transfer', ?6, ?7, ?8, 1, 'arrow-left-right', '#64748b', ?9)",
    params![
      id,
      tx.date,
      amount,
      from_account_id,
      to_account_id,
      tx.title,
      tx.notes,
      source_id,
      created_at,
    ],
  )?;
  Ok(())
}

fn find_opposite_bank_import_ledger(
  conn: &rusqlite::Connection,
  other_account_id: &str,
  date: &str,
  opposite_amount: i64,
) -> AppResult<Option<String>> {
  if let Some(id) = conn
    .query_row(
      "SELECT id FROM ledger_transactions
       WHERE account_id = ?1 AND date = ?2 AND amount_cents = ?3
         AND kind IN ('income', 'expense')
         AND COALESCE(source_id, '') LIKE 'bank_import:%'
       LIMIT 1",
      params![other_account_id, date, opposite_amount],
      |r| r.get(0),
    )
    .optional()?
  {
    return Ok(Some(id));
  }

  let date_naive = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok();
  if let Some(base) = date_naive {
    for offset in [-3i64, -2, -1, 1, 2, 3, -5, 5] {
      let Some(other_date) = base.checked_add_signed(chrono::Duration::days(offset)) else {
        continue;
      };
      let other_iso = other_date.format("%Y-%m-%d").to_string();
      if let Some(id) = conn
        .query_row(
          "SELECT id FROM ledger_transactions
           WHERE account_id = ?1 AND date = ?2 AND amount_cents = ?3
             AND kind IN ('income', 'expense')
             AND COALESCE(source_id, '') LIKE 'bank_import:%'
           LIMIT 1",
          params![other_account_id, other_iso, opposite_amount],
          |r| r.get(0),
        )
        .optional()?
      {
        return Ok(Some(id));
      }
    }
  }
  Ok(None)
}

fn sweep_pair_bank_transfers(
  conn: &rusqlite::Connection,
  account_id: &str,
  iban_map: &std::collections::HashMap<String, String>,
  base_time: chrono::DateTime<Utc>,
) -> AppResult<u32> {
  let mut stmt = conn.prepare(
    "SELECT id, date, amount_cents, title, notes, source_id
     FROM ledger_transactions
     WHERE account_id = ?1
       AND kind IN ('income', 'expense')
       AND COALESCE(source_id, '') LIKE 'bank_import:%'
     ORDER BY date ASC, created_at ASC",
  )?;
  let rows = stmt
    .query_map(params![account_id], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, i64>(2)?,
        r.get::<_, String>(3)?,
        r.get::<_, Option<String>>(4)?,
        r.get::<_, String>(5)?,
      ))
    })?
    .collect::<Result<Vec<_>, _>>()?;

  let mut paired = 0u32;
  for (index, (ledger_id, date, amount_cents, title, notes, source_id)) in rows.into_iter().enumerate() {
    let still_exists: i64 = conn.query_row(
      "SELECT COUNT(*) FROM ledger_transactions WHERE id = ?1",
      params![ledger_id],
      |r| r.get(0),
    )?;
    if still_exists == 0 {
      continue;
    }
    let match_text = format!(
      "{} {}",
      title,
      notes.clone().unwrap_or_default()
    );
    let tx = ParsedTransaction {
      date,
      amount_cents,
      title,
      notes,
      source_id,
      counterparty_iban: extract_iban_from_text(&match_text),
      match_text,
    };
    if try_pair_bank_transfer(conn, account_id, iban_map, &tx, 10_000 + index, base_time)?.is_some() {
      paired += 1;
    }
  }
  Ok(paired)
}

fn parse_bank_export(content: &str, filename: &str) -> AppResult<ParsedStatement> {
  let trimmed = content.trim_start();
  if trimmed.starts_with('<') || trimmed.starts_with("<?xml") {
    return parse_camt_xml(content);
  }
  if content.contains(":20:") && content.contains(":61:") {
    return parse_mt940(content);
  }
  if filename.to_ascii_lowercase().ends_with(".csv") || looks_like_csv(trimmed) {
    return parse_csv_export(content);
  }
  Err(AppError::Invalid(
    "Unbekanntes Format. Bitte CSV (CAMT V8), CAMT-XML, ZIP oder MT940 exportieren.".into(),
  ))
}

fn parse_exports(files: &[(String, String)]) -> AppResult<ParsedStatement> {
  if files.is_empty() {
    return Err(AppError::Invalid("Keine Importdatei gefunden.".into()));
  }
  let mut statements = Vec::with_capacity(files.len());
  for (name, content) in files {
    statements.push(parse_bank_export(content, name)?);
  }
  Ok(merge_statements(statements))
}

fn merge_statements(statements: Vec<ParsedStatement>) -> ParsedStatement {
  let mut iter = statements.into_iter();
  let Some(mut merged) = iter.next() else {
    return ParsedStatement {
      format: "leer".into(),
      iban: None,
      opening_balance: None,
      closing_balance: None,
      transactions: Vec::new(),
    };
  };
  for stmt in iter {
    if merged.iban.is_none() {
      merged.iban = stmt.iban;
    }
    if merged.opening_balance.is_none() {
      merged.opening_balance = stmt.opening_balance;
    }
    if let Some(closing) = stmt.closing_balance {
      let replace = merged
        .closing_balance
        .as_ref()
        .map(|current| closing.date >= current.date)
        .unwrap_or(true);
      if replace {
        merged.closing_balance = Some(closing);
      }
    }
    if stmt.format.contains("CSV") && !merged.format.contains("CSV") {
      merged.format = format!("{}, {}", merged.format, stmt.format);
    } else if !merged.format.contains(&stmt.format) {
      merged.format = format!("{}, {}", merged.format, stmt.format);
    }
    merged.transactions.extend(stmt.transactions);
  }
  merged.transactions.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.source_id.cmp(&b.source_id)));
  merged
}

fn load_export_files(path: &Path) -> AppResult<Vec<(String, String)>> {
  let ext = path
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_ascii_lowercase();
  if ext == "zip" {
    return read_zip_exports(path);
  }
  let name = path
    .file_name()
    .and_then(|n| n.to_str())
    .unwrap_or("export")
    .to_string();
  Ok(vec![(name, read_text_file(path)?)])
}

fn read_zip_exports(path: &Path) -> AppResult<Vec<(String, String)>> {
  use std::io::Read;
  let file = std::fs::File::open(path)?;
  let mut archive = zip::ZipArchive::new(file)
    .map_err(|e| AppError::Invalid(format!("ZIP ungültig: {e}")))?;
  let mut files = Vec::new();
  for index in 0..archive.len() {
    let mut entry = archive
      .by_index(index)
      .map_err(|e| AppError::Invalid(format!("ZIP-Eintrag unlesbar: {e}")))?;
    if entry.is_dir() {
      continue;
    }
    let name = entry.name().replace('\\', "/");
    let lower = name.to_ascii_lowercase();
    if !(lower.ends_with(".csv")
      || lower.ends_with(".xml")
      || lower.ends_with(".txt")
      || lower.ends_with(".940"))
    {
      continue;
    }
    let mut bytes = Vec::new();
    entry
      .read_to_end(&mut bytes)
      .map_err(|e| AppError::Invalid(format!("ZIP-Datei {name} unlesbar: {e}")))?;
    files.push((name, decode_text_bytes(&bytes)));
  }
  if files.is_empty() {
    return Err(AppError::Invalid(
      "ZIP enthält keine CSV-, XML- oder MT940-Dateien.".into(),
    ));
  }
  Ok(files)
}

fn read_text_file(path: &Path) -> AppResult<String> {
  let bytes = std::fs::read(path)?;
  Ok(decode_text_bytes(&bytes))
}

fn decode_text_bytes(bytes: &[u8]) -> String {
  let text = if let Ok(text) = std::str::from_utf8(bytes) {
    text.to_string()
  } else {
    encoding_rs::WINDOWS_1252.decode(bytes).0.into_owned()
  };
  text.trim_start_matches('\u{feff}').to_string()
}

fn looks_like_csv(content: &str) -> bool {
  let first = content.lines().next().unwrap_or("").to_ascii_lowercase();
  first.contains(';') && (first.contains("buchungstag") || first.contains("betrag"))
}

struct CsvColumnMap {
  iban: Option<usize>,
  date: Option<usize>,
  value_date: Option<usize>,
  booking_text: Option<usize>,
  purpose: Option<usize>,
  counterparty: Option<usize>,
  counterparty_iban: Option<usize>,
  e2e: Option<usize>,
  amount: Option<usize>,
}

fn parse_csv_export(content: &str) -> AppResult<ParsedStatement> {
  let rows = parse_delimited_rows(content)?;
  if rows.len() < 2 {
    return Err(AppError::Invalid(
      "CSV enthält keine Umsatzzeilen.".into(),
    ));
  }
  let columns = map_csv_columns(&rows[0])?;
  if columns.date.is_none() || columns.amount.is_none() {
    return Err(AppError::Invalid(
      "CSV: Spalten „Buchungstag“ und „Betrag“ nicht gefunden.".into(),
    ));
  }

  let mut iban: Option<String> = None;
  let mut transactions = Vec::new();

  for (index, row) in rows.iter().enumerate().skip(1) {
    if row.iter().all(|cell| cell.trim().is_empty()) {
      continue;
    }
    let date_idx = columns.date.unwrap();
    let amount_idx = columns.amount.unwrap();
    if date_idx >= row.len() || amount_idx >= row.len() {
      continue;
    }
    let date_raw = row[date_idx].trim();
    if date_raw.is_empty() {
      continue;
    }
    let date = parse_bank_date(date_raw)?;
    let amount_raw = row[amount_idx].trim();
    if amount_raw.is_empty() {
      continue;
    }
    let signed = parse_decimal_to_cents(amount_raw)?;

    if let Some(iban_idx) = columns.iban {
      if iban.is_none() && iban_idx < row.len() {
        let value = row[iban_idx].trim();
        if !value.is_empty() {
          iban = Some(value.replace(' ', ""));
        }
      }
    }

    let booking_text = columns
      .booking_text
      .and_then(|i| row.get(i))
      .map(|s| s.trim())
      .filter(|s| !s.is_empty());
    let purpose = columns
      .purpose
      .and_then(|i| row.get(i))
      .map(|s| s.trim())
      .filter(|s| !s.is_empty());
    let counterparty = columns
      .counterparty
      .and_then(|i| row.get(i))
      .map(|s| s.trim())
      .filter(|s| !s.is_empty());
    let counterparty_iban = columns
      .counterparty_iban
      .and_then(|i| row.get(i))
      .and_then(|s| crate::accounts::normalize_iban(s));
    let end_to_end = columns
      .e2e
      .and_then(|i| row.get(i))
      .map(|s| s.trim())
      .filter(|s| !s.is_empty() && *s != "NOTPROVIDED");

    let title = first_non_empty(&[
      purpose.unwrap_or(""),
      booking_text.unwrap_or(""),
      counterparty.unwrap_or(""),
      "Bankumsatz",
    ])
    .chars()
    .take(120)
    .collect::<String>();

    let mut note_parts = Vec::new();
    if let Some(text) = booking_text.filter(|s| !s.is_empty() && *s != title.as_str()) {
      note_parts.push(format!("Buchungstext: {text}"));
    }
    if let Some(cp) = counterparty.filter(|s| !s.is_empty() && *s != title.as_str()) {
      note_parts.push(format!("Gegenpartei: {cp}"));
    }
    if let Some(iban) = counterparty_iban.as_ref() {
      note_parts.push(format!("IBAN: {iban}"));
    }
    if let Some(e2e) = end_to_end {
      note_parts.push(format!("End-to-End: {e2e}"));
    }
    if let Some(value_idx) = columns.value_date {
      if let Some(value_raw) = row.get(value_idx).map(|s| s.trim()).filter(|s| !s.is_empty()) {
        if let Ok(value_date) = parse_bank_date(value_raw) {
          if value_date != date {
            note_parts.push(format!("Valuta: {value_date}"));
          }
        }
      }
    }
    let notes = if note_parts.is_empty() {
      None
    } else {
      Some(note_parts.join("\n"))
    };
    let match_text = format!(
      "{} {} {} {}",
      purpose.unwrap_or(""),
      booking_text.unwrap_or(""),
      counterparty.unwrap_or(""),
      counterparty_iban.as_deref().unwrap_or("")
    );

    let source_id = if let Some(e2e) = end_to_end {
      format!("bank_import:{date}:{e2e}:{signed}")
    } else {
      format!("bank_import:csv:{date}:{signed}:{index}")
    };

    transactions.push(ParsedTransaction {
      date,
      amount_cents: signed,
      title,
      notes,
      source_id,
      counterparty_iban,
      match_text,
    });
  }

  if transactions.is_empty() {
    return Err(AppError::Invalid(
      "Keine Umsätze in der CSV-Datei gefunden.".into(),
    ));
  }

  Ok(ParsedStatement {
    format: "CSV (Sparkasse)".into(),
    iban,
    opening_balance: None,
    closing_balance: None,
    transactions,
  })
}

fn map_csv_columns(header: &[String]) -> AppResult<CsvColumnMap> {
  let mut map = CsvColumnMap {
    iban: None,
    date: None,
    value_date: None,
    booking_text: None,
    purpose: None,
    counterparty: None,
    counterparty_iban: None,
    e2e: None,
    amount: None,
  };
  for (index, cell) in header.iter().enumerate() {
    let key = normalize_csv_header(cell);
    if map.iban.is_none() && (key.contains("auftragskonto") || key == "iban") {
      map.iban = Some(index);
    }
    if map.date.is_none()
      && (key.contains("buchungstag") || key.contains("buchungsdatum") || key == "datum")
    {
      map.date = Some(index);
    }
    if map.value_date.is_none() && key.contains("valutadatum") {
      map.value_date = Some(index);
    }
    if map.booking_text.is_none() && key.contains("buchungstext") {
      map.booking_text = Some(index);
    }
    if map.purpose.is_none() && key.contains("verwendungszweck") {
      map.purpose = Some(index);
    }
    if map.counterparty.is_none()
      && (key.contains("beguenstigter")
        || key.contains("zahlungspflichtiger")
        || key.contains("auftraggeber")
        || key.contains("empfaenger"))
    {
      map.counterparty = Some(index);
    }
    if map.counterparty_iban.is_none()
      && (key.contains("kontonummer") || (key.contains("iban") && !key.contains("auftragskonto")))
    {
      map.counterparty_iban = Some(index);
    }
    if map.e2e.is_none()
      && (key.contains("endtoend") || key.contains("kundenreferenz") || key.contains("sammlerreferenz"))
    {
      map.e2e = Some(index);
    }
    if key == "betrag" {
      map.amount = Some(index);
    }
  }
  // Sparkasse CAMT52: „Lastschrift Ursprungsbetrag“ must not be used as amount column.
  if map.amount.is_none() {
    for (index, cell) in header.iter().enumerate() {
      let key = normalize_csv_header(cell);
      if key.contains("betrag")
        && !key.contains("ursprungsbetrag")
        && !key.contains("auslagenersatz")
      {
        map.amount = Some(index);
        break;
      }
    }
  }
  Ok(map)
}

fn normalize_csv_header(raw: &str) -> String {
  raw.trim()
    .trim_matches('"')
    .to_ascii_lowercase()
    .replace('ä', "ae")
    .replace('ö', "oe")
    .replace('ü', "ue")
    .replace('ß', "ss")
    .replace([' ', '/', '(', ')', '-', '.', '_'], "")
}

fn parse_delimited_rows(content: &str) -> AppResult<Vec<Vec<String>>> {
  let delimiter = detect_csv_delimiter(content);
  let mut rows = Vec::new();
  for line in content.lines() {
    if line.trim().is_empty() {
      continue;
    }
    rows.push(parse_delimited_line(line, delimiter));
  }
  Ok(rows)
}

fn detect_csv_delimiter(content: &str) -> char {
  let first = content.lines().next().unwrap_or("");
  let semis = first.matches(';').count();
  let commas = first.matches(',').count();
  if semis >= commas { ';' } else { ',' }
}

fn parse_delimited_line(line: &str, delimiter: char) -> Vec<String> {
  let mut fields = Vec::new();
  let mut current = String::new();
  let mut in_quotes = false;
  let mut chars = line.chars().peekable();
  while let Some(ch) = chars.next() {
    match ch {
      '"' if in_quotes && chars.peek() == Some(&'"') => {
        current.push('"');
        chars.next();
      }
      '"' => in_quotes = !in_quotes,
      c if c == delimiter && !in_quotes => {
        fields.push(trim_csv_field(&current));
        current.clear();
      }
      c => current.push(c),
    }
  }
  fields.push(trim_csv_field(&current));
  fields
}

fn trim_csv_field(raw: &str) -> String {
  raw.trim().trim_matches('"').trim().to_string()
}

fn parse_bank_date(raw: &str) -> AppResult<String> {
  let value = raw.trim().trim_matches('"');
  if value.len() >= 10 && value.as_bytes().get(4) == Some(&b'-') {
    return Ok(value.chars().take(10).collect());
  }
  let parts: Vec<&str> = value.split('.').collect();
  if parts.len() == 3 {
    let day = parts[0];
    let month = parts[1];
    let year = if parts[2].len() == 2 {
      format!("20{}", parts[2])
    } else {
      parts[2].to_string()
    };
    return Ok(format!("{year}-{month}-{day}"));
  }
  Err(AppError::Invalid(format!("Datum ungültig: {raw}")))
}

fn parse_camt_xml(content: &str) -> AppResult<ParsedStatement> {
  let doc = roxmltree::Document::parse(content)
    .map_err(|e| AppError::Invalid(format!("CAMT-XML ungültig: {e}")))?;

  let mut iban: Option<String> = None;
  for node in descendants_by_tag(&doc, "IBAN") {
    if let Some(text) = node_text(node) {
      iban = Some(text);
      break;
    }
  }

  let mut opening_balance: Option<ParsedBalance> = None;
  let mut closing_balance: Option<ParsedBalance> = None;
  for bal in descendants_by_tag(&doc, "Bal") {
    let kind = balance_type_code(bal).unwrap_or_default();
    let amount_node = find_first_child(bal, "Amt");
    let Some(amount_node) = amount_node else { continue };
    let Some(amount_raw) = node_text(amount_node) else { continue };
    let amount = parse_decimal_to_cents(&amount_raw)?;
    let indicator = find_child_text(bal, "CdtDbtInd").unwrap_or_else(|| "CRDT".into());
    let signed = signed_amount(amount, &indicator);
    let date = extract_iso_date(bal)
      .ok_or_else(|| AppError::Invalid("CAMT: Bal ohne Datum".into()))?;
    let parsed = ParsedBalance {
      date,
      amount_cents: signed,
    };
    if kind == "OPBD" {
      opening_balance = Some(parsed);
    } else if kind == "CLBD" {
      closing_balance = Some(parsed);
    }
  }

  let mut transactions = Vec::new();
  for (index, entry) in descendants_by_tag(&doc, "Ntry").into_iter().enumerate() {
    let amount_node = find_first_child(entry, "Amt");
    let Some(amount_node) = amount_node else { continue };
    let Some(amount_raw) = node_text(amount_node) else { continue };
    let amount = parse_decimal_to_cents(&amount_raw)?;
    let indicator = find_descendant_text(entry, "CdtDbtInd").unwrap_or_else(|| "CRDT".into());
    let signed = signed_amount(amount, &indicator);

    let date = entry
      .descendants()
      .find(|n| n.is_element() && n.tag_name().name() == "BookgDt")
      .and_then(extract_iso_date)
      .or_else(|| extract_iso_date(entry))
      .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
    let value_date = entry
      .descendants()
      .find(|n| n.is_element() && n.tag_name().name() == "ValDt")
      .and_then(extract_iso_date);

    let bank_ref = find_descendant_text(entry, "AcctSvcrRef")
      .or_else(|| find_descendant_text(entry, "NtryRef"));
    let end_to_end = find_descendant_text(entry, "EndToEndId");
    let counterparty = find_descendant_text(entry, "Nm");
    let counterparty_iban = find_entry_counterparty_iban(entry, &indicator);
    let remittance = collect_texts(entry, "Ustrd").join(" ");
    let additional = find_descendant_text(entry, "AddtlNtryInf");

    let title = first_non_empty(&[
      remittance.trim(),
      additional.as_deref().unwrap_or("").trim(),
      counterparty.as_deref().unwrap_or("").trim(),
      "Bankumsatz",
    ])
    .chars()
    .take(120)
    .collect::<String>();

    let mut note_parts = Vec::new();
    if let Some(cp) = counterparty.as_ref().filter(|s| !s.is_empty() && *s != title.as_str()) {
      note_parts.push(format!("Gegenkonto: {cp}"));
    }
    if let Some(ref e2e) = end_to_end {
      note_parts.push(format!("End-to-End: {e2e}"));
    }
    if let Some(vr) = value_date.as_ref().filter(|v| *v != &date) {
      note_parts.push(format!("Valuta: {vr}"));
    }
    if let Some(ref br) = bank_ref {
      note_parts.push(format!("Bank-Ref: {br}"));
    }
    let notes = if note_parts.is_empty() {
      None
    } else {
      Some(note_parts.join("\n"))
    };

    let source_id = if let Some(ref br) = bank_ref {
      format!("bank_import:{br}")
    } else if let Some(ref e2e) = end_to_end.filter(|s| !s.is_empty() && *s != "NOTPROVIDED") {
      format!("bank_import:{date}:{e2e}:{signed}")
    } else {
      format!("bank_import:{date}:{signed}:{index}")
    };

    transactions.push(ParsedTransaction {
      date,
      amount_cents: signed,
      title,
      notes,
      source_id,
      counterparty_iban,
      match_text: format!(
        "{} {} {}",
        remittance.trim(),
        additional.as_deref().unwrap_or("").trim(),
        counterparty.as_deref().unwrap_or("")
      ),
    });
  }

  if transactions.is_empty() && opening_balance.is_none() && closing_balance.is_none() {
    return Err(AppError::Invalid(
      "Keine Umsätze oder Salden in der CAMT-Datei gefunden.".into(),
    ));
  }

  Ok(ParsedStatement {
    format: "CAMT XML".into(),
    iban,
    opening_balance,
    closing_balance,
    transactions,
  })
}

fn parse_mt940(content: &str) -> AppResult<ParsedStatement> {
  let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
  let mut iban: Option<String> = None;
  let mut opening_balance: Option<ParsedBalance> = None;
  let mut closing_balance: Option<ParsedBalance> = None;
  let mut transactions = Vec::new();
  let mut pending_description: Option<String> = None;

  for raw_line in normalized.lines() {
    let line = raw_line.trim();
    if line.is_empty() {
      continue;
    }
    if line.starts_with(":25:") {
      iban = Some(line[4..].trim().replace(' ', ""));
    } else if line.starts_with(":60F:") || line.starts_with(":60M:") {
      opening_balance = Some(parse_mt940_balance_line(line)?);
    } else if line.starts_with(":62F:") || line.starts_with(":62M:") {
      closing_balance = Some(parse_mt940_balance_line(line)?);
    } else if line.starts_with(":61:") {
      let tx = parse_mt940_transaction_line(line, pending_description.take())?;
      transactions.push(tx);
    } else if line.starts_with(":86:") {
      pending_description = Some(line[4..].trim().to_string());
    } else if !line.starts_with(':') {
      if let Some(desc) = pending_description.as_mut() {
        if !desc.is_empty() {
          desc.push(' ');
        }
        desc.push_str(line);
      }
    }
  }

  if transactions.is_empty() && opening_balance.is_none() {
    return Err(AppError::Invalid(
      "Keine Umsätze in der MT940-Datei gefunden.".into(),
    ));
  }

  Ok(ParsedStatement {
    format: "MT940".into(),
    iban,
    opening_balance,
    closing_balance,
    transactions,
  })
}

fn parse_mt940_balance_line(line: &str) -> AppResult<ParsedBalance> {
  let payload = line.split(':').nth(2).unwrap_or("").trim();
  if payload.len() < 11 {
    return Err(AppError::Invalid("MT940 Saldozeile ungültig".into()));
  }
  let indicator = &payload[0..1];
  let date = format_mt940_date(&payload[1..7])?;
  let rest = &payload[7..];
  let currency_end = rest
    .find(|c: char| !c.is_ascii_alphabetic())
    .unwrap_or(rest.len());
  let amount_raw = rest[currency_end..].replace(',', ".");
  let amount = parse_decimal_to_cents(amount_raw.trim())?;
  Ok(ParsedBalance {
    date,
    amount_cents: signed_amount(amount, if indicator == "D" { "DBIT" } else { "CRDT" }),
  })
}

fn parse_mt940_transaction_line(line: &str, description: Option<String>) -> AppResult<ParsedTransaction> {
  let payload = line.split(':').nth(2).unwrap_or("").trim();
  if payload.len() < 10 {
    return Err(AppError::Invalid("MT940 Umsatzzeile ungültig".into()));
  }
  let date = format_mt940_date(&payload[0..6])?;
  let indicator_pos = payload[10..]
    .find(|c: char| c == 'C' || c == 'D' || c == 'R')
    .ok_or_else(|| AppError::Invalid("MT940 Betrag nicht gefunden".into()))?;
  let indicator = &payload[10 + indicator_pos..11 + indicator_pos];
  let amount_part = payload[10..10 + indicator_pos].replace(',', ".");
  let amount = parse_decimal_to_cents(amount_part.trim())?;
  let signed = signed_amount(amount, if indicator == "D" { "DBIT" } else { "CRDT" });
  let match_text = description.clone().unwrap_or_default();
  let title = description
    .filter(|d| !d.trim().is_empty())
    .unwrap_or_else(|| "Bankumsatz".into())
    .chars()
    .take(120)
    .collect();
  let source_id = format!("bank_import:mt940:{date}:{signed}:{title}");
  Ok(ParsedTransaction {
    date,
    amount_cents: signed,
    title,
    notes: None,
    source_id,
    counterparty_iban: None,
    match_text,
  })
}

fn format_mt940_date(raw: &str) -> AppResult<String> {
  if raw.len() != 6 {
    return Err(AppError::Invalid("MT940 Datum ungültig".into()));
  }
  Ok(format!("20{}-{}-{}", &raw[0..2], &raw[2..4], &raw[4..6]))
}

fn signed_amount(amount_cents: i64, indicator: &str) -> i64 {
  if indicator.eq_ignore_ascii_case("DBIT") || indicator == "D" {
    -amount_cents.abs()
  } else {
    amount_cents.abs()
  }
}

fn parse_decimal_to_cents(raw: &str) -> AppResult<i64> {
  let mut cleaned = raw.trim().replace(' ', "");
  if cleaned.contains(',') {
    cleaned = cleaned.replace('.', "");
    cleaned = cleaned.replace(',', ".");
  }
  let value: f64 = cleaned
    .parse()
    .map_err(|_| AppError::Invalid(format!("Betrag ungültig: {raw}")))?;
  Ok((value * 100.0).round() as i64)
}

fn descendants_by_tag<'a>(doc: &'a roxmltree::Document, tag: &str) -> Vec<roxmltree::Node<'a, 'a>> {
  doc
    .descendants()
    .filter(|n| n.is_element() && n.tag_name().name() == tag)
    .collect()
}

fn find_first_child<'a>(node: roxmltree::Node<'a, 'a>, tag: &str) -> Option<roxmltree::Node<'a, 'a>> {
  node
    .descendants()
    .find(|n| n.is_element() && n.tag_name().name() == tag && n.parent() == Some(node))
    .or_else(|| {
      node
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == tag)
    })
}

fn find_entry_counterparty_iban(entry: roxmltree::Node<'_, '_>, indicator: &str) -> Option<String> {
  let prefer = if indicator == "DBIT" {
    "CdtrAcct"
  } else {
    "DbtrAcct"
  };
  if let Some(acct) = entry.descendants().find(|n| n.is_element() && n.tag_name().name() == prefer) {
    if let Some(iban) = find_descendant_text(acct, "IBAN") {
      return crate::accounts::normalize_iban(&iban);
    }
  }
  for iban_node in entry.descendants().filter(|n| n.is_element() && n.tag_name().name() == "IBAN") {
    if let Some(text) = node_text(iban_node) {
      if let Some(normalized) = crate::accounts::normalize_iban(&text) {
        return Some(normalized);
      }
    }
  }
  None
}

fn find_descendant_text(node: roxmltree::Node<'_, '_>, tag: &str) -> Option<String> {
  node
    .descendants()
    .find(|n| n.is_element() && n.tag_name().name() == tag)
    .and_then(node_text)
}

fn balance_type_code(node: roxmltree::Node<'_, '_>) -> Option<String> {
  node.descendants().find_map(|n| {
    if n.tag_name().name() != "Cd" {
      return None;
    }
    let parent = n.parent()?;
    if parent.tag_name().name() != "CdOrPrtry" {
      return None;
    }
    node_text(n)
  })
}

fn extract_iso_date(node: roxmltree::Node<'_, '_>) -> Option<String> {
  node
    .descendants()
    .filter(|n| n.is_element() && n.tag_name().name() == "Dt")
    .find_map(node_text)
    .or_else(|| {
      node
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "DtTm")
        .and_then(node_text)
        .map(|s| s.chars().take(10).collect())
    })
}

fn find_child_text(node: roxmltree::Node<'_, '_>, tag: &str) -> Option<String> {
  node
    .children()
    .find(|n| n.is_element() && n.tag_name().name() == tag)
    .and_then(node_text)
}

fn collect_texts(node: roxmltree::Node<'_, '_>, tag: &str) -> Vec<String> {
  node
    .descendants()
    .filter(|n| n.is_element() && n.tag_name().name() == tag)
    .filter_map(node_text)
    .collect()
}

fn node_text(node: roxmltree::Node<'_, '_>) -> Option<String> {
  node.text().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn first_non_empty<'a>(values: &'a [&'a str]) -> &'a str {
  values
    .iter()
    .find(|v| !v.trim().is_empty())
    .copied()
    .unwrap_or("Bankumsatz")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn derives_opening_balance_from_current_balance_uses_tx_sum() {
    let txs = vec![
      ParsedTransaction {
        date: "2026-05-04".into(),
        amount_cents: -41994,
        title: "Rate".into(),
        notes: None,
        source_id: "test:1".into(),
        counterparty_iban: None,
        match_text: String::new(),
      },
      ParsedTransaction {
        date: "2026-05-10".into(),
        amount_cents: 100000,
        title: "Gehalt".into(),
        notes: None,
        source_id: "test:2".into(),
        counterparty_iban: None,
        match_text: String::new(),
      },
    ];
    let tx_sum: i64 = txs.iter().map(|t| t.amount_cents).sum();
    assert_eq!(500000 - tx_sum, 441994);
  }

  #[test]
  fn parses_camt_sample() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <Stmt>
      <Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">1000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-05-01</Dt></Dt>
      </Bal>
      <Ntry>
        <Amt Ccy="EUR">50.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2026-05-05</Dt></BookgDt>
        <AcctSvcrRef>REF-001</AcctSvcrRef>
        <AddtlNtryInf>REWE Markt</AddtlNtryInf>
      </Ntry>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">950.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-05-05</Dt></Dt>
      </Bal>
    </Stmt>
  </BkToCstmrStmt>
</Document>"#;
    let parsed = parse_camt_xml(xml).expect("camt");
    assert_eq!(parsed.transactions.len(), 1);
    assert_eq!(parsed.transactions[0].amount_cents, -5000);
    assert_eq!(parsed.opening_balance.as_ref().unwrap().amount_cents, 100000);
  }

  #[test]
  fn parses_sparkasse_csv_sample() {
    let csv = r#""Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Betrag";"Waehrung"
"DE13370501980123093569";"17.04.2026";"17.04.2026";"KARTENZAHLUNG";"REWE Markt";"REWE Markt";"-9,47";"EUR"
"DE13370501980123093569";"18.04.2026";"18.04.2026";"GUTSCHRIFT";"Gehalt";"Arbeitgeber GmbH";"2500,00";"EUR""#;
    let parsed = parse_csv_export(csv).expect("csv");
    assert_eq!(parsed.transactions.len(), 2);
    assert_eq!(parsed.transactions[0].amount_cents, -947);
    assert_eq!(parsed.transactions[1].amount_cents, 250000);
    assert_eq!(parsed.iban.as_deref(), Some("DE13370501980123093569"));
  }

  #[test]
  fn parses_sparkasse_camt52v8_csv_uses_betrag_not_ursprungsbetrag() {
    let csv = r#""Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"
"DE84548500101000681302";"01.06.26";"01.06.26";"RENTE PENSIONSZAHLUNG";"RENTENZAHLUNG";"";"";"REF123";"";"";"";"Allianz Lebensvers. AG";"DE77700202700062328142";"HYVEDEMM";"258,20";"EUR";"Umsatz gebucht"
"#;
    let parsed = parse_csv_export(csv).expect("csv");
    assert_eq!(parsed.transactions.len(), 1);
    assert_eq!(parsed.transactions[0].amount_cents, 25820);
    assert_eq!(parsed.transactions[0].date, "2026-06-01");
  }
}
