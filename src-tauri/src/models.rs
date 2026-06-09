use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
  pub id: Uuid,
  pub name: String,
  pub is_liquid: bool,
  pub balance_source: String,
  pub account_kind: String,
  pub parent_account_id: Option<Uuid>,
  pub iban: Option<String>,
  pub is_main: bool,
  pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerTransaction {
  pub id: Uuid,
  pub date: String, // YYYY-MM-DD
  pub amount_cents: i64,
  pub account_id: Option<Uuid>,
  pub from_account_id: Option<Uuid>,
  pub to_account_id: Option<Uuid>,
  pub kind: String,
  pub title: String,
  pub notes: Option<String>,
  pub source_id: Option<String>,
  pub variable_cost_id: Option<Uuid>,
  pub fixed_cost_id: Option<Uuid>,
  pub buy_item_id: Option<Uuid>,
  pub icon: String,
  pub color: String,
  pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixedCost {
  pub id: Uuid,
  pub name: String,
  pub amount_cents: i64,
  pub cadence: String, // yearly|monthly|weekly|biweekly
  pub first_charge_date: String, // YYYY-MM-DD
  pub active: bool,
  pub notes: Option<String>,
  pub due_rule: String, // calendar_day|first_business_day
  pub day_of_month: Option<i64>,
  pub end_charge_date: Option<String>,
  pub account_id: String,
  pub icon: String,
  pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuyItem {
  pub id: Uuid,
  pub name: String,
  pub description: Option<String>,
  pub amount_cents: i64,
  pub status: String, // parked|applied
  pub applied_date: Option<String>,
  pub planned_month: Option<String>, // YYYY-MM
  pub icon: String,
  pub color: String,
  pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeForecast {
  pub id: Uuid,
  pub name: String,
  pub amount_cents: i64,
  pub cadence: String,
  pub first_charge_date: String,
  pub due_rule: String,
  pub day_of_month: Option<i64>,
  pub end_charge_date: Option<String>,
  pub active: bool,
  pub account_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeForecastActual {
  pub occurrence_date: String,
  pub amount_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeForecastDetail {
  pub forecast: IncomeForecast,
  pub actuals: Vec<IncomeForecastActual>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableCost {
  pub id: Uuid,
  pub name: String,
  pub amount_cents: i64,
  pub notes: Option<String>,
  pub icon: String,
  pub color: String,
  pub created_at: DateTime<Utc>,
  pub account_id: String,
  /// Prognose für den laufenden Monat (gleich `amount_cents`).
  pub current_month_forecast_cents: i64,
  /// Effektiver Ist-Wert (Prognose solange Monat offen, danach gebucht).
  pub current_month_actual_cents: i64,
  /// Summe kategorisierter Transaktionen im laufenden Monat.
  pub current_month_spent_cents: i64,
  pub current_month: String,
  pub current_month_closed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableCostActual {
  pub month: String,
  pub amount_cents: i64,
  pub actual_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableCostCategorizedTransaction {
  pub id: Uuid,
  pub date: String,
  pub title: String,
  pub amount_cents: i64,
  pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableCostDetail {
  pub cost: VariableCost,
  pub actuals: Vec<VariableCostActual>,
  pub transactions: Vec<VariableCostCategorizedTransaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
  pub id: String,
  pub r#type: String,
  pub date: String,
  pub title: String,
  pub amount_cents: i64,
  pub account_id: Option<String>,
  pub account_name: Option<String>,
  /// Umbuchung zwischen eigenen Konten (Bankimport per IBAN oder manueller Transfer).
  #[serde(default)]
  pub internal_transfer: bool,
  /// Fixkosten-Zuordnung bei gebuchten Ausgaben (Ledger).
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub fixed_cost_id: Option<String>,
  /// Variable-Kosten-Zuordnung bei gebuchten Ausgaben (Ledger).
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub variable_cost_id: Option<String>,
  /// Buchungstext / Notizen (z. B. bei zugewiesenen Ausgaben unter dem Titel).
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub notes: Option<String>,
  /// Einkaufszettel-Zuordnung bei gebuchten Ausgaben (Ledger).
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub buy_item_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPeriodNavItem {
  pub period_start: String,
  pub period_end: String,
  pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthView {
  pub month: String,
  pub start_balance_cents: i64, // sum across all accounts
  pub income_cents: i64,
  pub fixed_costs_cents: i64,
  pub variable_costs_cents: i64,
  pub remaining_fixed_costs_cents: i64,
  pub remaining_variable_costs_cents: i64,
  pub applied_buys_cents: i64,
  pub transfers_cents: i64,
  pub end_balance_cents: i64,
  /// Prognostizierte liquide Mittel zu Monatsbeginn (ohne Einkaufszettel in der Forecast-Komponente).
  pub start_liquid_cents: i64,
  pub total_liquid_cents: i64,
  /// Ist-Saldo (Ledger bzw. Depot-Marktwert), ohne Prognosen.
  pub kontostand_cents: i64,
  /// Kontostand minus Einnahmen, die buchhalterisch erst im Folgemonat zählen.
  pub kontostand_saldo_cents: i64,
  /// Stichtag des Kontostands (YYYY-MM-DD).
  pub kontostand_as_of: String,
  /// Ist-Saldo zu Monatsbeginn (Ledger, ohne Prognosen).
  pub kontostand_start_cents: i64,
  /// Monatsbeginn minus Folgemonats-Einnahmen (bereinigt für Startsaldo).
  pub kontostand_start_saldo_cents: i64,
  /// Ist-Saldo am Ende des Vormonats (Depot: Kostenbasis bis dahin).
  pub prev_kontostand_cents: i64,
  pub period_mode: String,
  pub period_start: String,
  pub period_end: String,
  pub salary_cutoff_date: Option<String>,
  pub period_is_current: bool,
  pub booked_fixed_costs_cents: i64,
  pub booked_variable_costs_cents: i64,
  pub events: Vec<TimelineEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayView {
  pub date: String, // YYYY-MM-DD
  pub total_cents: i64,
  pub liquid_cents: i64,
  /// Ist-Saldo (Ledger bzw. Depot-Marktwert), ohne Prognosen.
  pub kontostand_cents: i64,
  /// Ist-Saldo am Vortag (Depot: Kostenbasis bis dahin).
  pub prev_kontostand_cents: i64,
  pub events: Vec<TimelineEvent>,
}

pub fn parse_iso_date(s: &str) -> Option<NaiveDate> {
  NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseGroupLine {
  pub id: Uuid,
  pub name: String,
  pub amount_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseGroupSummary {
  pub id: Uuid,
  pub name: String,
  pub date: Option<String>,
  pub notes: Option<String>,
  pub total_cents: i64,
  pub line_count: i64,
  pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseGroupDetail {
  pub group: ExpenseGroupSummary,
  pub lines: Vec<ExpenseGroupLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtContactSummary {
  pub id: Uuid,
  pub name: String,
  pub notes: Option<String>,
  pub owed_to_me_cents: i64,
  pub i_owe_cents: i64,
  pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtTransaction {
  pub id: Uuid,
  pub contact_id: Uuid,
  pub date: String,
  pub amount_cents: i64,
  pub direction: String,
  pub title: Option<String>,
  pub notes: Option<String>,
  pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtContactDetail {
  pub contact: DebtContactSummary,
  pub transactions: Vec<DebtTransaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtSummary {
  pub owed_to_me_cents: i64,
  pub i_owe_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsArticle {
  pub id: String,
  pub title: String,
  pub summary: String,
  pub body: String,
  pub url: String,
  pub source: String,
  pub published_at: String,
  pub category: String,
  pub symbol: Option<String>,
}

