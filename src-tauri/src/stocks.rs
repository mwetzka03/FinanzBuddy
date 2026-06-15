use crate::error::{AppError, AppResult};
use crate::state::AppState;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;

type CmdResult<T> = Result<T, String>;

fn to_cmd_result<T>(r: AppResult<T>) -> CmdResult<T> {
  r.map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockHolding {
  pub id: String,
  pub name: String,
  pub symbol: String,
  pub buy_date: String,
  pub buy_price_cents: i64,
  pub shares: f64,
  pub currency: String,
  pub depot_account_id: Option<String>,
  pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockLot {
  pub id: String,
  pub holding_id: String,
  pub buy_date: String,
  pub buy_price_cents: i64,
  pub shares: f64,
  pub payment_account_id: Option<String>,
  pub is_transfer: bool,
  pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockLotView {
  pub lot: StockLot,
  pub cost_basis: f64,
  pub current_value: Option<f64>,
  pub gain_loss: Option<f64>,
  pub gain_loss_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockPositionDetail {
  pub position: StockHoldingView,
  pub lots: Vec<StockLotView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockChartPoint {
  pub timestamp: i64,
  pub close: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockChart {
  pub range: String,
  pub currency: String,
  pub reference_price: f64,
  pub reference_label: String,
  pub points: Vec<StockChartPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockQuote {
  pub symbol: String,
  pub price: f64,
  pub currency: String,
  pub previous_close: f64,
  pub day_change: f64,
  pub day_change_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockHoldingView {
  pub holding: StockHolding,
  pub quote: Option<StockQuote>,
  pub sparkline: Option<Vec<StockChartPoint>>,
  pub current_value: Option<f64>,
  pub cost_basis: f64,
  pub gain_loss: Option<f64>,
  pub gain_loss_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockPortfolioSummary {
  pub holdings: Vec<StockHoldingView>,
  pub total_cost_basis: f64,
  pub total_current_value: f64,
  pub total_gain_loss: f64,
  pub total_gain_loss_pct: f64,
}

fn row_to_lot(
  id: String,
  holding_id: String,
  buy_date: String,
  buy_price_cents: i64,
  shares: f64,
  payment_account_id: Option<String>,
  is_transfer: i64,
  created_at: String,
) -> StockLot {
  StockLot {
    id,
    holding_id,
    buy_date,
    buy_price_cents,
    shares,
    payment_account_id,
    is_transfer: is_transfer != 0,
    created_at,
  }
}

fn load_holding(conn: &rusqlite::Connection, id: &str) -> AppResult<StockHolding> {
  conn.query_row(
    "SELECT id, name, symbol, buy_date, buy_price_cents, shares, currency, depot_account_id, created_at FROM stock_holdings WHERE id = ?1",
    params![id],
    |r| {
      Ok(row_to_holding(
        r.get(0)?,
        r.get(1)?,
        r.get(2)?,
        r.get(3)?,
        r.get(4)?,
        r.get(5)?,
        r.get(6)?,
        r.get(7)?,
        r.get(8)?,
      ))
    },
  )
  .map_err(Into::into)
}

fn load_lots(conn: &rusqlite::Connection, holding_id: &str) -> AppResult<Vec<StockLot>> {
  let mut stmt = conn.prepare(
    "SELECT id, holding_id, buy_date, buy_price_cents, shares, payment_account_id, is_transfer, created_at FROM stock_lots WHERE holding_id = ?1 ORDER BY buy_date ASC, created_at ASC",
  )?;
  let rows = stmt.query_map(params![holding_id], |r| {
    Ok(row_to_lot(
      r.get(0)?,
      r.get(1)?,
      r.get(2)?,
      r.get(3)?,
      r.get(4)?,
      r.get(5)?,
      r.get(6)?,
      r.get(7)?,
    ))
  })?;
  rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn insert_stock_lot(
  conn: &rusqlite::Connection,
  holding_id: &str,
  buy_date: &str,
  buy_price_cents: i64,
  shares: f64,
  payment_account_id: Option<&str>,
  is_transfer: bool,
) -> AppResult<String> {
  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  conn.execute(
    "INSERT INTO stock_lots (id, holding_id, buy_date, buy_price_cents, shares, payment_account_id, is_transfer, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    params![
      id,
      holding_id,
      buy_date,
      buy_price_cents,
      shares,
      payment_account_id,
      if is_transfer { 1 } else { 0 },
      now
    ],
  )?;
  Ok(id)
}

fn delete_lot_ledger(conn: &rusqlite::Connection, lot_id: &str) -> AppResult<()> {
  conn.execute(
    "DELETE FROM ledger_transactions WHERE source_id = ?1",
    params![format!("stock_lot:{lot_id}")],
  )?;
  Ok(())
}

fn resolve_depot_account_id(conn: &rusqlite::Connection, input: &Option<String>) -> AppResult<String> {
  if let Some(id) = input.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
    return Ok(id.to_string());
  }
  conn.query_row(
    "SELECT id FROM accounts WHERE balance_source = 'stock_portfolio' ORDER BY created_at ASC LIMIT 1",
    [],
    |r| r.get(0),
  )
  .map_err(|_| AppError::Invalid("Kein Aktien-Depot-Konto gefunden".into()))
}

fn resolve_payment_account_id(
  conn: &rusqlite::Connection,
  depot_account_id: &str,
  input: &Option<String>,
) -> AppResult<String> {
  if let Some(id) = input.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
    return Ok(id.to_string());
  }
  conn.query_row(
    "SELECT linked_ledger_account_id FROM accounts WHERE id = ?1",
    params![depot_account_id],
    |r| r.get::<_, Option<String>>(0),
  )
  .optional()?
  .flatten()
  .filter(|s| !s.trim().is_empty())
  .ok_or_else(|| AppError::Invalid("Depot ohne verknüpftes Girokonto — bitte in den Einstellungen zuweisen.".into()))
}

fn book_stock_purchase_ledger(
  conn: &rusqlite::Connection,
  lot_id: &str,
  buy_date: &str,
  buy_price_cents: i64,
  shares: f64,
  stock_name: &str,
  payment_account_id: &str,
) -> AppResult<()> {
  let account_id = payment_account_id;
  let total_cents = (buy_price_cents as f64 * shares).round() as i64;
  if total_cents <= 0 {
    return Ok(());
  }

  let source_id = format!("stock_lot:{lot_id}");
  let exists: i64 = conn.query_row(
    "SELECT COUNT(*) FROM ledger_transactions WHERE source_id = ?1",
    params![source_id],
    |r| r.get(0),
  )?;
  if exists > 0 {
    return Ok(());
  }

  let tx_id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let title = format!("Aktienkauf: {}", stock_name.trim());
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'expense', ?5, NULL, ?6, ?7)",
    params![tx_id, buy_date, -total_cents, account_id, title, source_id, now],
  )?;
  Ok(())
}

fn recompute_holding_from_lots(conn: &rusqlite::Connection, holding_id: &str) -> AppResult<()> {
  let lots = load_lots(conn, holding_id)?;
  if lots.is_empty() {
    return Ok(());
  }
  let total_shares: f64 = lots.iter().map(|l| l.shares).sum();
  let total_cost: f64 = lots
    .iter()
    .map(|l| l.buy_price_cents as f64 * l.shares)
    .sum();
  let avg_price_cents = if total_shares > f64::EPSILON {
    (total_cost / total_shares).round() as i64
  } else {
    0
  };
  let buy_date = lots
    .iter()
    .map(|l| l.buy_date.as_str())
    .min()
    .unwrap_or("")
    .to_string();
  conn.execute(
    "UPDATE stock_holdings SET buy_price_cents = ?2, shares = ?3, buy_date = ?4 WHERE id = ?1",
    params![holding_id, avg_price_cents, total_shares, buy_date],
  )?;
  Ok(())
}

fn build_lot_view(lot: StockLot, price_eur: Option<f64>) -> StockLotView {
  let cost_basis = (lot.buy_price_cents as f64 / 100.0) * lot.shares;
  let (current_value, gain_loss, gain_loss_pct) = if let Some(price) = price_eur {
    let cv = price * lot.shares;
    let gl = cv - cost_basis;
    let gl_pct = if cost_basis.abs() > f64::EPSILON {
      (gl / cost_basis) * 100.0
    } else {
      0.0
    };
    (Some(cv), Some(gl), Some(gl_pct))
  } else {
    (None, None, None)
  };
  StockLotView {
    lot,
    cost_basis,
    current_value,
    gain_loss,
    gain_loss_pct,
  }
}

fn chart_range_params(range: &str) -> (&'static str, &'static str) {
  match range {
    "1d" => ("1d", "2m"),
    "5d" => ("5d", "15m"),
    "1mo" => ("1mo", "1d"),
    "1y" => ("1y", "1d"),
    "max" => ("max", "1wk"),
    _ => ("1mo", "1d"),
  }
}

fn fetch_stock_chart(symbol_or_isin: &str, range: &str, fx: &mut FxToEur) -> AppResult<StockChart> {
  let yahoo_symbol = resolve_lsx_yahoo_symbol(symbol_or_isin)?;
  let (range_param, interval) = chart_range_params(range);
  let encoded = encode_symbol(&yahoo_symbol);
  let url = format!(
    "https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?interval={interval}&range={range_param}&region=DE&lang=de-DE&includePrePost=true"
  );
  let client = yahoo_client()?;
  let resp = client
    .get(&url)
    .send()
    .map_err(|e| AppError::Invalid(format!("Chart-Abfrage fehlgeschlagen: {e}")))?;
  if !resp.status().is_success() {
    return Err(AppError::Invalid(format!("Chart API: HTTP {}", resp.status())));
  }
  let body: serde_json::Value = resp
    .json()
    .map_err(|e| AppError::Invalid(format!("Ungültige Chart-Antwort: {e}")))?;

  let result = body
    .pointer("/chart/result/0")
    .ok_or_else(|| AppError::Invalid("Keine Chart-Daten".into()))?;
  let currency = result
    .pointer("/meta/currency")
    .and_then(|v| v.as_str())
    .unwrap_or("EUR")
    .to_uppercase();
  let timestamps = result
    .pointer("/timestamp")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default();
  let closes = result
    .pointer("/indicators/quote/0/close")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default();

  let mut points = Vec::new();
  for (idx, ts) in timestamps.iter().enumerate() {
    let Some(ts_i) = ts.as_i64() else {
      continue;
    };
    let Some(close) = closes.get(idx).and_then(|v| v.as_f64()) else {
      continue;
    };
    let close_eur = fx.convert(close, &currency)?;
    points.push(StockChartPoint {
      timestamp: ts_i,
      close: close_eur,
    });
  }

  if points.is_empty() {
    return Err(AppError::Invalid("Keine Kursdaten im Chart".into()));
  }

  let previous_close_raw = result
    .pointer("/meta/previousClose")
    .or_else(|| result.pointer("/meta/chartPreviousClose"))
    .and_then(|v| v.as_f64());

  let (reference_price, reference_label) = if range == "1d" {
    let reference = match previous_close_raw {
      Some(price) => fx.convert(price, &currency)?,
      None => points[0].close,
    };
    (reference, "Vortag".to_string())
  } else {
    (points[0].close, "Anfang".to_string())
  };

  Ok(StockChart {
    range: range.to_string(),
    currency: "EUR".to_string(),
    reference_price,
    reference_label,
    points,
  })
}

fn row_to_holding(
  id: String,
  name: String,
  symbol: String,
  buy_date: String,
  buy_price_cents: i64,
  shares: f64,
  currency: String,
  depot_account_id: Option<String>,
  created_at: String,
) -> StockHolding {
  StockHolding {
    id,
    name,
    symbol,
    buy_date,
    buy_price_cents,
    shares,
    currency,
    depot_account_id,
    created_at,
  }
}

fn is_isin(value: &str) -> bool {
  value.len() == 12 && value.chars().all(|c| c.is_ascii_alphanumeric())
}

pub(crate) fn looks_like_isin(value: &str) -> bool {
  is_isin(value.trim())
}

fn resolve_lsx_yahoo_symbol(input: &str) -> AppResult<String> {
  let trimmed = input.trim().to_uppercase();
  if trimmed.is_empty() {
    return Err(AppError::Invalid("ISIN/Kürzel erforderlich".into()));
  }
  if trimmed.contains('.') || trimmed.contains('-') {
    return Ok(trimmed);
  }
  if is_isin(&trimmed) {
    return resolve_isin_to_yahoo_symbol(&trimmed);
  }
  const CRYPTO_SYMBOLS: &[(&str, &str)] = &[
    ("BTC", "BTC-EUR"),
    ("ETH", "ETH-EUR"),
    ("XRP", "XRP-EUR"),
    ("SOL", "SOL-EUR"),
    ("ADA", "ADA-EUR"),
    ("DOT", "DOT-EUR"),
    ("LTC", "LTC-EUR"),
    ("BCH", "BCH-EUR"),
    ("DOGE", "DOGE-EUR"),
  ];
  for (sym, yahoo) in CRYPTO_SYMBOLS {
    if trimmed == *sym {
      return Ok(yahoo.to_string());
    }
  }
  Ok(format!("{trimmed}.DE"))
}

fn resolve_isin_to_yahoo_symbol(isin: &str) -> AppResult<String> {
  let quotes = fetch_yahoo_search(isin, 15)?;
  let equity: Vec<_> = quotes.iter().filter(|q| quote_type_ok(q)).collect();

  for q in &equity {
    let symbol = q.get("symbol").and_then(|v| v.as_str()).unwrap_or("");
    if symbol.ends_with(".DE") {
      return Ok(symbol.to_string());
    }
    let exchange = q.get("exchange").and_then(|v| v.as_str()).unwrap_or("");
    if exchange.eq_ignore_ascii_case("GER") || exchange.contains("XETRA") {
      return Ok(symbol.to_string());
    }
  }

  for q in &equity {
    let qt = q.get("quoteType").and_then(|v| v.as_str()).unwrap_or("");
    if qt.eq_ignore_ascii_case("CRYPTOCURRENCY") {
      let symbol = q.get("symbol").and_then(|v| v.as_str()).unwrap_or("");
      if !symbol.is_empty() {
        return Ok(symbol.to_string());
      }
    }
  }

  if let Some(q) = equity.first() {
    let symbol = q.get("symbol").and_then(|v| v.as_str()).unwrap_or("");
    if !symbol.is_empty() {
      return Ok(symbol.to_string());
    }
  }

  Err(AppError::Invalid(format!("Kein Titel für ISIN {isin} gefunden")))
}

/// Yahoo-Symbole für News-Abruf aus Kürzel/ISIN und Unternehmensname.
pub(crate) fn news_yahoo_symbols_for_holding(symbol: &str, name: &str) -> Vec<String> {
  use std::collections::HashSet;
  let mut seen = HashSet::new();
  let mut out = Vec::new();
  let mut push = |raw: &str| {
    let t = raw.trim().to_uppercase();
    if t.len() >= 1 && seen.insert(t.clone()) {
      out.push(t);
    }
  };

  if let Ok(de) = resolve_lsx_yahoo_symbol(symbol) {
    push(&de);
    if let Some(base) = de.strip_suffix(".DE") {
      push(base);
    }
  }

  if looks_like_isin(symbol) {
    if let Ok(quotes) = fetch_yahoo_search(symbol.trim(), 12) {
      for q in quotes {
        let Some(sym) = q.get("symbol").and_then(|v| v.as_str()) else {
          continue;
        };
        push(sym);
        if let Some(base) = sym.strip_suffix(".DE") {
          push(base);
        }
      }
    }
  }

  for query in [name.trim(), symbol.trim()] {
    if query.len() < 3 {
      continue;
    }
    if let Ok(quotes) = fetch_yahoo_search(query, 8) {
      for q in quotes {
        let Some(sym) = q.get("symbol").and_then(|v| v.as_str()) else {
          continue;
        };
        push(sym);
        if let Some(base) = sym.strip_suffix(".DE") {
          push(base);
        }
      }
    }
  }

  out
}

#[derive(Debug, Clone)]
struct ChartQuote {
  yahoo_symbol: String,
  price: f64,
  previous_close: f64,
  currency: String,
  market_time: i64,
  sparkline: Vec<StockChartPoint>,
}

fn meta_f64(meta: &serde_json::Value, keys: &[&str]) -> Option<f64> {
  keys.iter().find_map(|key| meta.get(*key).and_then(|v| v.as_f64()))
}

fn meta_i64(meta: &serde_json::Value, keys: &[&str]) -> Option<i64> {
  keys.iter().find_map(|key| meta.get(*key).and_then(|v| v.as_i64()))
}

fn last_chart_close(result: &serde_json::Value) -> Option<f64> {
  let timestamps = result.pointer("/timestamp")?.as_array()?;
  let closes = result.pointer("/indicators/quote/0/close")?.as_array()?;
  for idx in (0..timestamps.len()).rev() {
    let close = closes.get(idx).and_then(|v| v.as_f64())?;
    if close.is_finite() {
      return Some(close);
    }
  }
  None
}

fn downsample_sparkline(points: Vec<StockChartPoint>, max_points: usize) -> Vec<StockChartPoint> {
  if points.len() <= max_points {
    return points;
  }
  let step = ((points.len() as f64) / (max_points as f64)).ceil() as usize;
  let step = step.max(1);
  points.into_iter().step_by(step).collect()
}

fn extract_sparkline_points(result: &serde_json::Value) -> Vec<StockChartPoint> {
  let timestamps = result
    .pointer("/timestamp")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default();
  let closes = result
    .pointer("/indicators/quote/0/close")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default();
  let mut points = Vec::new();
  for (idx, ts) in timestamps.iter().enumerate() {
    let Some(ts_i) = ts.as_i64() else {
      continue;
    };
    let Some(close) = closes.get(idx).and_then(|v| v.as_f64()) else {
      continue;
    };
    if !close.is_finite() {
      continue;
    }
    points.push(StockChartPoint {
      timestamp: ts_i,
      close,
    });
  }
  downsample_sparkline(points, 32)
}

fn convert_sparkline_to_eur(
  points: &[StockChartPoint],
  currency: &str,
  fx: &mut FxToEur,
) -> Vec<StockChartPoint> {
  points
    .iter()
    .filter_map(|point| {
      fx.convert(point.close, currency).ok().map(|close| StockChartPoint {
        timestamp: point.timestamp,
        close,
      })
    })
    .collect()
}

fn fetch_yahoo_chart(symbol: &str) -> AppResult<ChartQuote> {
  let encoded = encode_symbol(symbol);
  let url = format!(
    "https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?interval=2m&range=1d&region=DE&lang=de-DE&includePrePost=true"
  );
  let client = yahoo_client()?;
  let resp = client
    .get(&url)
    .send()
    .map_err(|e| AppError::Invalid(format!("Kursabfrage fehlgeschlagen: {e}")))?;
  if !resp.status().is_success() {
    return Err(AppError::Invalid(format!("Yahoo API: HTTP {}", resp.status())));
  }
  let body: serde_json::Value = resp
    .json()
    .map_err(|e| AppError::Invalid(format!("Ungültige API-Antwort: {e}")))?;
  let result = body
    .pointer("/chart/result/0")
    .ok_or_else(|| AppError::Invalid("Keine Kursdaten gefunden".into()))?;
  let meta = result
    .get("meta")
    .ok_or_else(|| AppError::Invalid("Keine Kursdaten gefunden".into()))?;
  let price = meta_f64(
    meta,
    &[
      "regularMarketPrice",
      "postMarketPrice",
      "preMarketPrice",
      "previousClose",
      "chartPreviousClose",
    ],
  )
  .or_else(|| last_chart_close(result))
  .ok_or_else(|| AppError::Invalid("Aktueller Kurs nicht verfügbar".into()))?;
  let previous_close = meta_f64(meta, &["previousClose", "chartPreviousClose"]).unwrap_or(price);
  let currency = meta
    .get("currency")
    .and_then(|v| v.as_str())
    .unwrap_or("EUR")
    .to_uppercase();
  let market_time = meta_i64(
    meta,
    &[
      "regularMarketTime",
      "postMarketTime",
      "preMarketTime",
    ],
  )
  .unwrap_or_else(|| chrono::Utc::now().timestamp());
  let sparkline = extract_sparkline_points(result);
  Ok(ChartQuote {
    yahoo_symbol: symbol.trim().to_uppercase(),
    price,
    previous_close,
    currency,
    market_time,
    sparkline,
  })
}

/// Yahoo `EURUSD=X`: Fremdwährung pro 1 EUR (z. B. 1,08 USD).
fn fetch_eur_cross_rate(currency: &str) -> AppResult<f64> {
  let currency = currency.trim().to_uppercase();
  if currency == "EUR" {
    return Ok(1.0);
  }

  let direct = format!("EUR{currency}=X");
  if let Ok(chart) = fetch_yahoo_chart(&direct) {
    if chart.price > f64::EPSILON {
      return Ok(chart.price);
    }
  }

  let inverse = format!("{currency}EUR=X");
  let chart = fetch_yahoo_chart(&inverse)?;
  if chart.price <= f64::EPSILON {
    return Err(AppError::Invalid(format!(
      "Wechselkurs {currency}/EUR ungültig"
    )));
  }
  Ok(1.0 / chart.price)
}

struct FxToEur {
  cache: HashMap<String, f64>,
}

impl FxToEur {
  fn new() -> Self {
    Self {
      cache: HashMap::new(),
    }
  }

  fn foreign_per_eur(&mut self, currency: &str) -> AppResult<f64> {
    let currency = currency.trim().to_uppercase();
    if currency == "EUR" {
      return Ok(1.0);
    }
    if let Some(rate) = self.cache.get(&currency) {
      return Ok(*rate);
    }
    let rate = fetch_eur_cross_rate(&currency)?;
    self.cache.insert(currency, rate);
    Ok(rate)
  }

  fn convert(&mut self, amount: f64, currency: &str) -> AppResult<f64> {
    let currency = currency.trim().to_uppercase();
    if currency == "EUR" {
      return Ok(amount);
    }
    let rate = self.foreign_per_eur(&currency)?;
    if rate <= f64::EPSILON {
      return Err(AppError::Invalid(format!(
        "Wechselkurs {currency}/EUR ungültig"
      )));
    }
    Ok(amount / rate)
  }
}

fn chart_prices_in_eur(chart: &ChartQuote, fx: &mut FxToEur) -> AppResult<(f64, f64)> {
  Ok((
    fx.convert(chart.price, &chart.currency)?,
    fx.convert(chart.previous_close, &chart.currency)?,
  ))
}

fn build_stock_quote(yahoo_symbol: &str, price_eur: f64, previous_close_eur: f64) -> StockQuote {
  let day_change = price_eur - previous_close_eur;
  let day_change_pct = if previous_close_eur.abs() > f64::EPSILON {
    (day_change / previous_close_eur) * 100.0
  } else {
    0.0
  };
  StockQuote {
    symbol: yahoo_symbol.to_string(),
    price: price_eur,
    currency: "EUR".to_string(),
    previous_close: previous_close_eur,
    day_change,
    day_change_pct,
  }
}

fn quote_symbol_candidates(symbol_or_isin: &str, yahoo_symbol: &str) -> Vec<String> {
  let mut out = Vec::new();
  let mut push = |value: &str| {
    let trimmed = value.trim().to_uppercase();
    if !trimmed.is_empty() && !out.iter().any(|v| v == &trimmed) {
      out.push(trimmed);
    }
  };

  push(yahoo_symbol);
  let upper = symbol_or_isin.trim().to_uppercase();
  if is_isin(&upper) {
    push(&upper);
  }
  if !yahoo_symbol.ends_with(".DE") {
    let base = yahoo_symbol.split('.').next().unwrap_or(yahoo_symbol);
    push(&format!("{base}.DE"));
    push(&format!("{base}.TG"));
  }
  out
}

fn fetch_lsx_eur_quote_with_rate(symbol_or_isin: &str, fx: &mut FxToEur) -> AppResult<(StockQuote, Vec<StockChartPoint>)> {
  let yahoo_symbol = resolve_lsx_yahoo_symbol(symbol_or_isin)?;
  let candidates = quote_symbol_candidates(symbol_or_isin, &yahoo_symbol);

  let mut best: Option<(StockQuote, Vec<StockChartPoint>, i64)> = None;
  let mut last_err: Option<AppError> = None;
  for candidate in candidates {
    match fetch_yahoo_chart(&candidate) {
      Ok(chart) => match chart_prices_in_eur(&chart, fx) {
        Ok((price_eur, previous_close_eur)) => {
          let quote = build_stock_quote(&chart.yahoo_symbol, price_eur, previous_close_eur);
          let sparkline = convert_sparkline_to_eur(&chart.sparkline, &chart.currency, fx);
          let replace = best
            .as_ref()
            .map(|(_, _, ts)| chart.market_time > *ts)
            .unwrap_or(true);
          if replace {
            best = Some((quote, sparkline, chart.market_time));
          }
        }
        Err(e) => last_err = Some(e),
      },
      Err(e) => last_err = Some(e),
    }
  }

  if let Some((quote, sparkline, _)) = best {
    return Ok((quote, sparkline));
  }

  Err(last_err.unwrap_or_else(|| AppError::Invalid("Kein EUR-Kurs gefunden".into())))
}

fn normalize_holding_symbol(symbol: &str) -> String {
  symbol.trim().to_uppercase()
}

fn holding_currency(input: Option<&String>) -> String {
  input
    .map(|s| s.trim())
    .filter(|s| !s.is_empty())
    .map(|s| s.to_uppercase())
    .unwrap_or_else(|| "EUR".to_string())
}

fn encode_symbol(symbol: &str) -> String {
  symbol.trim().to_uppercase().replace(' ', "%20")
}

fn yahoo_client() -> AppResult<reqwest::blocking::Client> {
  reqwest::blocking::Client::builder()
    .user_agent("Mozilla/5.0 (compatible; FinanzBuddy/1.0)")
    .timeout(std::time::Duration::from_secs(10))
    .build()
    .map_err(|e| AppError::Invalid(e.to_string()))
}

fn fetch_yahoo_search(query: &str, count: usize) -> AppResult<Vec<serde_json::Value>> {
  let encoded = query.trim().replace(' ', "%20");
  if encoded.len() < 2 {
    return Ok(vec![]);
  }
  let url = format!(
    "https://query1.finance.yahoo.com/v1/finance/search?q={encoded}&quotesCount={count}&lang=de-DE&region=DE"
  );
  let client = yahoo_client()?;
  let resp = client
    .get(&url)
    .send()
    .map_err(|e| AppError::Invalid(format!("Symbolsuche fehlgeschlagen: {e}")))?;
  if !resp.status().is_success() {
    return Err(AppError::Invalid(format!("Symbolsuche: HTTP {}", resp.status())));
  }
  let body: serde_json::Value = resp
    .json()
    .map_err(|e| AppError::Invalid(format!("Ungültige Suchantwort: {e}")))?;
  Ok(body
    .get("quotes")
    .and_then(|v| v.as_array())
    .map(|arr| arr.clone())
    .unwrap_or_default())
}

fn extract_isin(q: &serde_json::Value) -> Option<String> {
  if let Some(isin) = q.get("isin").and_then(|v| v.as_str()) {
    if is_isin(isin) {
      return Some(isin.to_uppercase());
    }
  }
  if let Some(arr) = q.get("isins").and_then(|v| v.as_array()) {
    for item in arr {
      if let Some(s) = item.as_str() {
        if is_isin(s) {
          return Some(s.to_uppercase());
        }
      }
    }
  }
  None
}

fn quote_type_ok(q: &serde_json::Value) -> bool {
  let qt = q.get("quoteType").and_then(|v| v.as_str()).unwrap_or("");
  matches!(qt, "EQUITY" | "ETF" | "CRYPTOCURRENCY")
}

fn german_listing_score(q: &serde_json::Value) -> i32 {
  let symbol = q.get("symbol").and_then(|v| v.as_str()).unwrap_or("");
  if symbol.ends_with(".DE") {
    return 0;
  }
  let exchange = q.get("exchange").and_then(|v| v.as_str()).unwrap_or("");
  if exchange.eq_ignore_ascii_case("GER") || exchange.contains("XETRA") {
    return 1;
  }
  2
}

fn is_german_listing(q: &serde_json::Value) -> bool {
  german_listing_score(q) <= 1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockSuggestion {
  pub name: String,
  pub symbol: String,
  pub isin: Option<String>,
  pub exchange: String,
}

#[tauri::command]
pub fn search_stock_suggestions(state: State<'_, AppState>, query: String, mode: Option<String>) -> CmdResult<Vec<StockSuggestion>> {
  let _ = state;
  to_cmd_result(search_stock_suggestions_inner(query, mode.as_deref()))
}

fn looks_like_isin_query(q: &str) -> bool {
  let t = q.trim();
  t.len() >= 2
    && t.len() <= 12
    && t.chars().all(|c| c.is_ascii_alphanumeric())
    && t.chars().take(2).all(|c| c.is_ascii_alphabetic())
}

fn isin_match_score(query: &str, suggestion: &StockSuggestion) -> i32 {
  if let Some(isin) = &suggestion.isin {
    if isin.eq_ignore_ascii_case(query) {
      return 0;
    }
    if isin.starts_with(query) {
      return 1;
    }
    if isin.contains(query) {
      return 2;
    }
  }
  if suggestion.symbol.to_uppercase().starts_with(query) {
    return 3;
  }
  9
}

fn quote_to_suggestion(q: &serde_json::Value, fallback_isin: Option<&str>) -> Option<StockSuggestion> {
  let symbol = q.get("symbol").and_then(|v| v.as_str())?.trim().to_string();
  if symbol.is_empty() {
    return None;
  }
  let name = q
    .get("longname")
    .or_else(|| q.get("shortname"))
    .and_then(|v| v.as_str())
    .unwrap_or(&symbol)
    .to_string();
  let exchange = q
    .get("exchange")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let isin = extract_isin(q).or_else(|| {
    fallback_isin
      .filter(|s| is_isin(s))
      .map(|s| s.to_uppercase())
  });
  Some(StockSuggestion {
    name,
    symbol,
    isin,
    exchange,
  })
}

fn search_stock_suggestions_inner(query: String, mode: Option<&str>) -> AppResult<Vec<StockSuggestion>> {
  let trimmed = query.trim();
  if trimmed.len() < 2 {
    return Ok(vec![]);
  }
  let upper = trimmed.to_uppercase();
  let isin_mode = mode == Some("isin") || looks_like_isin_query(&upper);
  let query_is_full_isin = is_isin(&upper);

  let mut quotes = fetch_yahoo_search(&upper, 20)?;
  quotes.retain(|q| quote_type_ok(q));

  // Namenssuche: deutsche Listings bevorzugen, internationale Titel nicht verstecken.
  if !isin_mode {
    let german: Vec<_> = quotes.iter().filter(|q| is_german_listing(q)).cloned().collect();
    if !german.is_empty() {
      quotes = german;
    }
  }

  quotes.sort_by(|a, b| {
    let mut score_a = german_listing_score(a);
    let mut score_b = german_listing_score(b);
    if query_is_full_isin {
      if extract_isin(a).as_deref() == Some(upper.as_str()) {
        score_a -= 10;
      }
      if extract_isin(b).as_deref() == Some(upper.as_str()) {
        score_b -= 10;
      }
    }
    score_a.cmp(&score_b)
  });

  let fallback_isin = if query_is_full_isin { Some(upper.as_str()) } else { None };
  let mut out = Vec::new();
  let mut seen = std::collections::HashSet::new();

  for q in &quotes {
    let Some(suggestion) = quote_to_suggestion(q, fallback_isin) else {
      continue;
    };
    if !seen.insert(suggestion.symbol.clone()) {
      continue;
    }
    out.push(suggestion);
    if out.len() >= 8 {
      break;
    }
  }

  if isin_mode {
    out.sort_by(|a, b| {
      isin_match_score(&upper, a)
        .cmp(&isin_match_score(&upper, b))
        .then_with(|| a.symbol.to_uppercase().cmp(&b.symbol.to_uppercase()))
    });
    if upper.len() < 12 {
      let filtered: Vec<_> = out
        .iter()
        .filter(|s| {
          s.isin
            .as_ref()
            .map(|isin| isin.starts_with(&upper))
            .unwrap_or(false)
            || s.symbol.to_uppercase().starts_with(&upper)
        })
        .cloned()
        .collect();
      if !filtered.is_empty() {
        out = filtered;
      }
    }
    if out.len() > 8 {
      out.truncate(8);
    }
  }

  Ok(out)
}

fn build_holding_view(
  holding: StockHolding,
  quote: Option<StockQuote>,
  sparkline: Option<Vec<StockChartPoint>>,
) -> StockHoldingView {
  let cost_basis = (holding.buy_price_cents as f64 / 100.0) * holding.shares;
  let (current_value, gain_loss, gain_loss_pct) = if let Some(ref q) = quote {
    let cv = q.price * holding.shares;
    let gl = cv - cost_basis;
    let gl_pct = if cost_basis.abs() > f64::EPSILON {
      (gl / cost_basis) * 100.0
    } else {
      0.0
    };
    (Some(cv), Some(gl), Some(gl_pct))
  } else {
    (None, None, None)
  };

  StockHoldingView {
    holding,
    quote,
    sparkline,
    current_value,
    cost_basis,
    gain_loss,
    gain_loss_pct,
  }
}

type MarketDataCache = HashMap<String, (Option<StockQuote>, Option<Vec<StockChartPoint>>)>;

fn cached_market_data(
  symbol: &str,
  fx: &mut FxToEur,
  cache: &mut MarketDataCache,
) -> (Option<StockQuote>, Option<Vec<StockChartPoint>>) {
  let key = normalize_holding_symbol(symbol);
  if let Some(cached) = cache.get(&key) {
    return cached.clone();
  }
  let bundle = match fetch_lsx_eur_quote_with_rate(symbol, fx) {
    Ok((quote, sparkline)) => {
      let sparkline = if sparkline.is_empty() {
        None
      } else {
        Some(sparkline)
      };
      (Some(quote), sparkline)
    }
    Err(_) => (None, None),
  };
  cache.insert(key, bundle.clone());
  bundle
}

#[tauri::command]
pub fn list_stock_portfolio(
  state: State<'_, AppState>,
  depot_account_id: Option<String>,
) -> CmdResult<StockPortfolioSummary> {
  to_cmd_result(list_stock_portfolio_inner(state, depot_account_id))
}

fn load_all_holdings(
  conn: &rusqlite::Connection,
  depot_account_id: Option<&str>,
) -> AppResult<Vec<StockHolding>> {
  if let Some(depot_id) = depot_account_id {
    let mut stmt = conn.prepare(
      "SELECT id, name, symbol, buy_date, buy_price_cents, shares, currency, depot_account_id, created_at FROM stock_holdings WHERE depot_account_id = ?1 ORDER BY buy_date DESC, name ASC",
    )?;
    let rows = stmt.query_map(params![depot_id], map_holding_row)?;
    return rows.collect::<Result<Vec<_>, _>>().map_err(Into::into);
  }
  let mut stmt = conn.prepare(
    "SELECT id, name, symbol, buy_date, buy_price_cents, shares, currency, depot_account_id, created_at FROM stock_holdings ORDER BY buy_date DESC, name ASC",
  )?;
  let rows = stmt.query_map([], map_holding_row)?;
  rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn map_holding_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<StockHolding> {
  Ok(row_to_holding(
    r.get(0)?,
    r.get(1)?,
    r.get(2)?,
    r.get(3)?,
    r.get(4)?,
    r.get(5)?,
    r.get(6)?,
    r.get(7)?,
    r.get(8)?,
  ))
}

pub fn portfolio_total_current_value_eur(holdings: &[StockHolding]) -> AppResult<f64> {
  let mut fx = FxToEur::new();
  let _ = fx.foreign_per_eur("USD");
  let mut cache: MarketDataCache = HashMap::new();
  let mut total_value = 0.0;
  for h in holdings {
    let (quote, _) = cached_market_data(&h.symbol, &mut fx, &mut cache);
    let view = build_holding_view(h.clone(), quote, None);
    total_value += view.current_value.unwrap_or(view.cost_basis);
  }
  Ok(total_value)
}

pub fn fetch_portfolio_total_cents(state: &AppState) -> AppResult<i64> {
  fetch_portfolio_total_cents_for_depot(state, None)
}

pub fn fetch_portfolio_total_cents_for_depot(
  state: &AppState,
  depot_account_id: Option<&str>,
) -> AppResult<i64> {
  let holdings = {
    let conn = state.conn.lock().unwrap();
    load_all_holdings(&conn, depot_account_id)?
  };
  let total = portfolio_total_current_value_eur(&holdings)?;
  Ok((total * 100.0).round() as i64)
}

fn holding_cost_basis_eur(h: &StockHolding) -> f64 {
  (h.buy_price_cents as f64 / 100.0) * h.shares
}

/// Kostenbasis aller Lots bis einschließlich `date_inclusive` (YYYY-MM-DD).
pub fn depot_cost_basis_cents_until(
  conn: &rusqlite::Connection,
  depot_account_id: &str,
  date_inclusive: &str,
) -> AppResult<i64> {
  let total: f64 = conn.query_row(
    "SELECT COALESCE(SUM(sl.buy_price_cents * sl.shares), 0)
     FROM stock_lots sl
     JOIN stock_holdings sh ON sh.id = sl.holding_id
     WHERE sh.depot_account_id = ?1 AND sl.buy_date <= ?2",
    rusqlite::params![depot_account_id, date_inclusive],
    |r| r.get(0),
  )?;
  Ok(total.round() as i64)
}

/// Schneller Depot-Saldo für Dashboard/Prognose ohne Live-Kurse.
/// Nutzt den gecachten Gesamtwert anteilig nach Kostenbasis; sonst nur Kostenbasis.
pub fn portfolio_balance_cents_for_dashboard(
  conn: &rusqlite::Connection,
  state: &AppState,
  depot_account_id: &str,
) -> AppResult<i64> {
  let holdings = load_all_holdings(conn, Some(depot_account_id))?;
  if holdings.is_empty() {
    return Ok(0);
  }
  let depot_cost: f64 = holdings.iter().map(holding_cost_basis_eur).sum();

  if let Some(cached) = crate::portfolio_cache::cached_total_cents(state) {
    let all_holdings = load_all_holdings(conn, None)?;
    let total_cost: f64 = all_holdings.iter().map(holding_cost_basis_eur).sum();
    if total_cost > f64::EPSILON {
      return Ok(((cached as f64) * (depot_cost / total_cost)).round() as i64);
    }
  }

  Ok((depot_cost * 100.0).round() as i64)
}

fn summarize_portfolio(rows: Vec<StockHolding>) -> AppResult<StockPortfolioSummary> {
  let mut holdings = Vec::new();
  let mut total_cost = 0.0;
  let mut total_value = 0.0;
  let mut fx = FxToEur::new();
  let _ = fx.foreign_per_eur("USD");
  let mut cache: MarketDataCache = HashMap::new();

  for h in rows {
    let (quote, sparkline) = cached_market_data(&h.symbol, &mut fx, &mut cache);
    let view = build_holding_view(h, quote, sparkline);
    total_cost += view.cost_basis;
    if let Some(cv) = view.current_value {
      total_value += cv;
    } else {
      total_value += view.cost_basis;
    }
    holdings.push(view);
  }

  let total_gain_loss = total_value - total_cost;
  let total_gain_loss_pct = if total_cost.abs() > f64::EPSILON {
    (total_gain_loss / total_cost) * 100.0
  } else {
    0.0
  };

  Ok(StockPortfolioSummary {
    holdings,
    total_cost_basis: total_cost,
    total_current_value: total_value,
    total_gain_loss,
    total_gain_loss_pct,
  })
}

fn list_stock_portfolio_inner(
  state: State<'_, AppState>,
  depot_account_id: Option<String>,
) -> AppResult<StockPortfolioSummary> {
  let depot_filter = depot_account_id
    .as_ref()
    .map(|s| s.trim())
    .filter(|s| !s.is_empty());
  let rows = {
    let conn = state.conn.lock().unwrap();
    load_all_holdings(&conn, depot_filter)?
  };
  summarize_portfolio(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStockHoldingInput {
  pub name: String,
  pub symbol: String,
  pub buy_date: String,
  pub buy_price_cents: i64,
  pub shares: f64,
  pub currency: Option<String>,
  pub depot_account_id: Option<String>,
  pub payment_account_id: Option<String>,
  pub is_transfer: Option<bool>,
}

#[tauri::command]
pub fn create_stock_holding(state: State<'_, AppState>, input: CreateStockHoldingInput) -> CmdResult<String> {
  to_cmd_result(create_stock_holding_inner(state, input))
}

fn create_stock_holding_inner(state: State<'_, AppState>, input: CreateStockHoldingInput) -> AppResult<String> {
  if input.name.trim().is_empty() {
    return Err(AppError::Invalid("name required".into()));
  }
  if input.symbol.trim().is_empty() {
    return Err(AppError::Invalid("symbol required".into()));
  }
  if input.buy_price_cents <= 0 {
    return Err(AppError::Invalid("buy price must be positive".into()));
  }
  if input.shares <= 0.0 {
    return Err(AppError::Invalid("shares must be positive".into()));
  }

  let symbol = normalize_holding_symbol(&input.symbol);
  let is_transfer = input.is_transfer.unwrap_or(false);
  let conn = state.conn.lock().unwrap();
  let depot_account_id = resolve_depot_account_id(&conn, &input.depot_account_id)?;
  let payment_account_id = if is_transfer {
    None
  } else {
    Some(resolve_payment_account_id(&conn, &depot_account_id, &input.payment_account_id)?)
  };

  let existing_id: Option<String> = conn
    .query_row(
      "SELECT id FROM stock_holdings WHERE UPPER(symbol) = ?1 AND depot_account_id = ?2 LIMIT 1",
      params![symbol, depot_account_id],
      |r| r.get(0),
    )
    .optional()?;

  if let Some(holding_id) = existing_id {
    let lot_id = insert_stock_lot(
      &conn,
      &holding_id,
      &input.buy_date,
      input.buy_price_cents,
      input.shares,
      payment_account_id.as_deref(),
      is_transfer,
    )?;
    if let Some(payment_id) = payment_account_id.as_deref() {
      book_stock_purchase_ledger(
        &conn,
        &lot_id,
        &input.buy_date,
        input.buy_price_cents,
        input.shares,
        &input.name,
        payment_id,
      )?;
    }
    recompute_holding_from_lots(&conn, &holding_id)?;
    conn.execute(
      "UPDATE stock_holdings SET name = ?2 WHERE id = ?1",
      params![holding_id, input.name.trim()],
    )?;
    drop(conn);
    return Ok(holding_id);
  }

  let id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let currency = holding_currency(input.currency.as_ref());
  conn.execute(
    "INSERT INTO stock_holdings (id, name, symbol, buy_date, buy_price_cents, shares, currency, depot_account_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    params![id, input.name.trim(), symbol, input.buy_date, input.buy_price_cents, input.shares, currency, depot_account_id, now],
  )?;
  let lot_id = insert_stock_lot(
    &conn,
    &id,
    &input.buy_date,
    input.buy_price_cents,
    input.shares,
    payment_account_id.as_deref(),
    is_transfer,
  )?;
  if let Some(payment_id) = payment_account_id.as_deref() {
    book_stock_purchase_ledger(
      &conn,
      &lot_id,
      &input.buy_date,
      input.buy_price_cents,
      input.shares,
      &input.name,
      payment_id,
    )?;
  }
  drop(conn);
  Ok(id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStockHoldingInput {
  pub id: String,
  pub name: String,
  pub symbol: String,
  pub buy_date: String,
  pub buy_price_cents: i64,
  pub shares: f64,
  pub currency: Option<String>,
}

#[tauri::command]
pub fn update_stock_holding(state: State<'_, AppState>, input: UpdateStockHoldingInput) -> CmdResult<()> {
  to_cmd_result(update_stock_holding_inner(state, input))
}

fn update_stock_holding_inner(state: State<'_, AppState>, input: UpdateStockHoldingInput) -> AppResult<()> {
  if input.name.trim().is_empty() || input.symbol.trim().is_empty() {
    return Err(AppError::Invalid("name and symbol required".into()));
  }
  if input.buy_price_cents <= 0 || input.shares <= 0.0 {
    return Err(AppError::Invalid("invalid price or shares".into()));
  }
  let currency = holding_currency(input.currency.as_ref());
  let conn = state.conn.lock().unwrap();
  let lots = load_lots(&conn, &input.id)?;
  if lots.len() == 1 {
    let lot = &lots[0];
    conn.execute(
      "UPDATE stock_lots SET buy_date = ?2, buy_price_cents = ?3, shares = ?4 WHERE id = ?1",
      params![lot.id, input.buy_date, input.buy_price_cents, input.shares],
    )?;
    recompute_holding_from_lots(&conn, &input.id)?;
  }
  let n = conn.execute(
    "UPDATE stock_holdings SET name = ?2, symbol = ?3, currency = ?4 WHERE id = ?1",
    params![input.id, input.name.trim(), input.symbol.trim().to_uppercase(), currency],
  )?;
  if n == 0 {
    return Err(AppError::Invalid("holding not found".into()));
  }
  Ok(())
}

#[tauri::command]
pub fn delete_stock_holding(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_stock_holding_inner(state, id))
}

fn delete_stock_holding_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  conn.execute(
    "DELETE FROM ledger_transactions WHERE source_id IN (SELECT 'stock_lot:' || id FROM stock_lots WHERE holding_id = ?1)",
    params![id],
  )?;
  conn.execute("DELETE FROM stock_lots WHERE holding_id = ?1", params![id])?;
  conn.execute("DELETE FROM stock_holdings WHERE id = ?1", params![id])?;
  Ok(())
}

fn update_lot_ledger(
  conn: &rusqlite::Connection,
  lot_id: &str,
  buy_date: &str,
  buy_price_cents: i64,
  shares: f64,
  stock_name: &str,
) -> AppResult<()> {
  let source_id = format!("stock_lot:{lot_id}");
  let total_cents = (buy_price_cents as f64 * shares).round() as i64;
  let title = format!("Aktienkauf: {}", stock_name.trim());
  let updated = conn.execute(
    "UPDATE ledger_transactions SET date = ?2, amount_cents = ?3, title = ?4 WHERE source_id = ?1",
    params![source_id, buy_date, -total_cents, title],
  )?;
  if updated == 0 && total_cents > 0 {
    if let Some(payment_id) = conn.query_row(
      "SELECT payment_account_id FROM stock_lots WHERE id = ?1",
      params![lot_id],
      |r| r.get::<_, Option<String>>(0),
    ).optional()? {
      if let Some(account_id) = payment_id.filter(|s| !s.is_empty()) {
        book_stock_purchase_ledger(conn, lot_id, buy_date, buy_price_cents, shares, stock_name, &account_id)?;
      }
    }
  }
  Ok(())
}

fn book_stock_sale_ledger(
  conn: &rusqlite::Connection,
  sale_id: &str,
  sale_date: &str,
  net_proceeds_cents: i64,
  stock_name: &str,
  payment_account_id: &str,
) -> AppResult<()> {
  if net_proceeds_cents <= 0 {
    return Ok(());
  }
  let source_id = format!("stock_sale:{sale_id}");
  let exists: i64 = conn.query_row(
    "SELECT COUNT(*) FROM ledger_transactions WHERE source_id = ?1",
    params![source_id],
    |r| r.get(0),
  )?;
  if exists > 0 {
    return Ok(());
  }
  let tx_id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  let title = format!("Aktienverkauf: {}", stock_name.trim());
  conn.execute(
    "INSERT INTO ledger_transactions (id, date, amount_cents, account_id, from_account_id, to_account_id, kind, title, notes, source_id, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'income', ?5, NULL, ?6, ?7)",
    params![tx_id, sale_date, net_proceeds_cents, payment_account_id, title, source_id, now],
  )?;
  Ok(())
}

fn apply_fifo_sale(conn: &rusqlite::Connection, holding_id: &str, mut shares_to_sell: f64) -> AppResult<()> {
  if shares_to_sell <= 0.0 {
    return Err(AppError::Invalid("shares must be positive".into()));
  }
  let mut lots = load_lots(conn, holding_id)?;
  lots.sort_by(|a, b| a.buy_date.cmp(&b.buy_date).then(a.created_at.cmp(&b.created_at)));
  let total: f64 = lots.iter().map(|l| l.shares).sum();
  if shares_to_sell > total + f64::EPSILON {
    return Err(AppError::Invalid("not enough shares to sell".into()));
  }
  for lot in lots {
    if shares_to_sell <= f64::EPSILON {
      break;
    }
    if lot.shares <= shares_to_sell + f64::EPSILON {
      shares_to_sell -= lot.shares;
      delete_lot_ledger(conn, &lot.id)?;
      conn.execute("DELETE FROM stock_lots WHERE id = ?1", params![lot.id])?;
    } else {
      let remaining = lot.shares - shares_to_sell;
      conn.execute(
        "UPDATE stock_lots SET shares = ?2 WHERE id = ?1",
        params![lot.id, remaining],
      )?;
      shares_to_sell = 0.0;
    }
  }
  let remaining: i64 = conn.query_row(
    "SELECT COUNT(*) FROM stock_lots WHERE holding_id = ?1",
    params![holding_id],
    |r| r.get(0),
  )?;
  if remaining == 0 {
    conn.execute("DELETE FROM stock_holdings WHERE id = ?1", params![holding_id])?;
  } else {
    recompute_holding_from_lots(conn, holding_id)?;
  }
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStockLotInput {
  pub id: String,
  pub buy_date: String,
  pub buy_price_cents: i64,
  pub shares: f64,
}

#[tauri::command]
pub fn update_stock_lot(state: State<'_, AppState>, input: UpdateStockLotInput) -> CmdResult<()> {
  to_cmd_result(update_stock_lot_inner(state, input))
}

fn update_stock_lot_inner(state: State<'_, AppState>, input: UpdateStockLotInput) -> AppResult<()> {
  if input.buy_price_cents <= 0 || input.shares <= 0.0 {
    return Err(AppError::Invalid("invalid price or shares".into()));
  }
  let conn = state.conn.lock().unwrap();
  let (holding_id, is_transfer, payment_id): (String, i64, Option<String>) = conn.query_row(
    "SELECT holding_id, is_transfer, payment_account_id FROM stock_lots WHERE id = ?1",
    params![input.id],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
  )?;
  let holding = load_holding(&conn, &holding_id)?;
  conn.execute(
    "UPDATE stock_lots SET buy_date = ?2, buy_price_cents = ?3, shares = ?4 WHERE id = ?1",
    params![input.id, input.buy_date, input.buy_price_cents, input.shares],
  )?;
  recompute_holding_from_lots(&conn, &holding_id)?;
  if is_transfer == 0 {
    if let Some(account_id) = payment_id.filter(|s| !s.is_empty()) {
      update_lot_ledger(
        &conn,
        &input.id,
        &input.buy_date,
        input.buy_price_cents,
        input.shares,
        &holding.name,
      )?;
      let _ = account_id;
    }
  }
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SellStockHoldingInput {
  pub holding_id: String,
  pub date: String,
  pub shares: Option<f64>,
  pub percent: Option<f64>,
  pub sale_price_cents: i64,
  pub fees_cents: i64,
}

#[tauri::command]
pub fn sell_stock_holding(state: State<'_, AppState>, input: SellStockHoldingInput) -> CmdResult<bool> {
  to_cmd_result(sell_stock_holding_inner(state, input))
}

fn sell_stock_holding_inner(state: State<'_, AppState>, input: SellStockHoldingInput) -> AppResult<bool> {
  if input.sale_price_cents <= 0 {
    return Err(AppError::Invalid("sale price must be positive".into()));
  }
  if input.fees_cents < 0 {
    return Err(AppError::Invalid("fees must be >= 0".into()));
  }
  let conn = state.conn.lock().unwrap();
  let holding = load_holding(&conn, &input.holding_id)?;
  let depot_id = holding
    .depot_account_id
    .as_deref()
    .ok_or_else(|| AppError::Invalid("holding has no depot".into()))?;
  let payment_account_id = resolve_payment_account_id(&conn, depot_id, &None)?;
  let total_shares = holding.shares;
  let shares_to_sell = if let Some(sh) = input.shares {
    sh
  } else if let Some(pct) = input.percent {
    if pct <= 0.0 || pct > 100.0 {
      return Err(AppError::Invalid("percent must be between 0 and 100".into()));
    }
    total_shares * (pct / 100.0)
  } else {
    return Err(AppError::Invalid("shares or percent required".into()));
  };
  if shares_to_sell <= 0.0 {
    return Err(AppError::Invalid("shares must be positive".into()));
  }
  let gross_cents = (shares_to_sell * input.sale_price_cents as f64).round() as i64;
  let net_cents = gross_cents - input.fees_cents;
  let sale_id = Uuid::new_v4().to_string();
  apply_fifo_sale(&conn, &input.holding_id, shares_to_sell)?;
  book_stock_sale_ledger(
    &conn,
    &sale_id,
    &input.date,
    net_cents,
    &holding.name,
    &payment_account_id,
  )?;
  drop(conn);
  let remaining: i64 = {
    let conn = state.conn.lock().unwrap();
    conn.query_row(
      "SELECT COUNT(*) FROM stock_holdings WHERE id = ?1",
      params![input.holding_id],
      |r| r.get(0),
    )?
  };
  Ok(remaining > 0)
}

#[tauri::command]
pub fn get_stock_position_detail(
  state: State<'_, AppState>,
  id: String,
  skip_quotes: Option<bool>,
) -> CmdResult<StockPositionDetail> {
  to_cmd_result(get_stock_position_detail_inner(state, id, skip_quotes.unwrap_or(false)))
}

fn get_stock_position_detail_inner(
  state: State<'_, AppState>,
  id: String,
  skip_quotes: bool,
) -> AppResult<StockPositionDetail> {
  let conn = state.conn.lock().unwrap();
  let holding = load_holding(&conn, &id)?;
  let lots = load_lots(&conn, &id)?;
  drop(conn);

  let (quote, sparkline) = if skip_quotes {
    (None, None)
  } else {
    let mut fx = FxToEur::new();
    let _ = fx.foreign_per_eur("USD");
    match fetch_lsx_eur_quote_with_rate(&holding.symbol, &mut fx) {
      Ok((quote, sparkline)) => (
        Some(quote),
        if sparkline.is_empty() {
          None
        } else {
          Some(sparkline)
        },
      ),
      Err(_) => (None, None),
    }
  };
  let price_eur = quote.as_ref().map(|q| q.price);
  let position = build_holding_view(holding, quote, sparkline);
  let lot_views = lots
    .into_iter()
    .map(|lot| build_lot_view(lot, price_eur))
    .collect();

  Ok(StockPositionDetail {
    position,
    lots: lot_views,
  })
}

#[tauri::command]
pub fn get_stock_chart(
  state: State<'_, AppState>,
  symbol: String,
  range: String,
) -> CmdResult<StockChart> {
  let _ = state;
  to_cmd_result(get_stock_chart_inner(symbol, range))
}

fn get_stock_chart_inner(symbol: String, range: String) -> AppResult<StockChart> {
  let mut fx = FxToEur::new();
  fetch_stock_chart(&symbol, &range, &mut fx)
}

#[tauri::command]
pub fn delete_stock_lot(state: State<'_, AppState>, id: String) -> CmdResult<()> {
  to_cmd_result(delete_stock_lot_inner(state, id))
}

fn delete_stock_lot_inner(state: State<'_, AppState>, id: String) -> AppResult<()> {
  let conn = state.conn.lock().unwrap();
  let (holding_id,): (String,) = conn
    .query_row(
      "SELECT holding_id FROM stock_lots WHERE id = ?1",
      params![id],
      |r| Ok((r.get(0)?,)),
    )
    .map_err(|_| AppError::Invalid("Auftrag nicht gefunden".into()))?;

  delete_lot_ledger(&conn, &id)?;
  conn.execute("DELETE FROM stock_lots WHERE id = ?1", params![id])?;

  let remaining: i64 = conn.query_row(
    "SELECT COUNT(*) FROM stock_lots WHERE holding_id = ?1",
    params![holding_id],
    |r| r.get(0),
  )?;

  if remaining == 0 {
    conn.execute("DELETE FROM stock_holdings WHERE id = ?1", params![holding_id])?;
  } else {
    recompute_holding_from_lots(&conn, &holding_id)?;
  }
  Ok(())
}
