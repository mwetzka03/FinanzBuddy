use crate::error::{AppError, AppResult};
use crate::models::NewsArticle;
use crate::news_cache::{self, StockNewsListResponse};
use crate::state::AppState;
use crate::stocks;
use chrono::{DateTime, Duration, Utc};
use regex::Regex;
use rusqlite::params;
use std::collections::HashSet;
use tauri::{AppHandle, State};

type CmdResult<T> = Result<T, String>;

fn to_cmd_result<T>(r: AppResult<T>) -> CmdResult<T> {
  r.map_err(|e| e.to_string())
}

fn strip_html(input: &str) -> String {
  let re = Regex::new(r"<[^>]+>").unwrap();
  let text = re.replace_all(input, " ");
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_entities(input: &str) -> String {
  input
    .replace("&amp;", "&")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
    .replace("&nbsp;", " ")
}

fn news_id(url: &str) -> String {
  use std::collections::hash_map::DefaultHasher;
  use std::hash::{Hash, Hasher};
  let mut hasher = DefaultHasher::new();
  url.hash(&mut hasher);
  format!("{:016x}", hasher.finish())
}

fn parse_rss_date(raw: &str) -> Option<DateTime<Utc>> {
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    return None;
  }
  if let Ok(dt) = DateTime::parse_from_rfc2822(trimmed) {
    return Some(dt.with_timezone(&Utc));
  }
  if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
    return Some(dt.with_timezone(&Utc));
  }
  None
}

fn item_body(item: &rss::Item) -> String {
  let mut parts: Vec<String> = Vec::new();
  if let Some(content) = item.content() {
    let text = strip_html(content);
    if !text.is_empty() {
      parts.push(text);
    }
  }
  if let Some(desc) = item.description() {
    let text = strip_html(desc);
    if !text.is_empty() && !parts.iter().any(|p| p == &text) {
      parts.push(text);
    }
  }
  decode_entities(&parts.join("\n\n"))
}

fn clean_article_text(input: &str) -> String {
  let mut text = decode_entities(input);
  let noise_patterns = [
    r"(?i)zur navigation springen.*?",
    r"(?i)zum hauptinhalt springen.*?",
    r"(?i)yahoo finanzen.*?anmelden",
    r"(?i)copyright © \d{4} yahoo.*",
    r"(?i)deutsche märkte sind geschlossen.*",
    r"(?i)mein portfolio.*",
    r"(?i)aktuelle trends.*",
    r"(?i)skip to (main )?content.*",
    r"(?i)sign in.*",
  ];
  for pat in noise_patterns {
    if let Ok(re) = Regex::new(pat) {
      text = re.replace_all(&text, "").to_string();
    }
  }
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_rss_text(input: &str) -> String {
  clean_article_text(input)
}

fn fetch_rss(url: &str, source: &str, category: &str, symbol: Option<&str>) -> AppResult<Vec<NewsArticle>> {
  let client = reqwest::blocking::Client::builder()
    .timeout(std::time::Duration::from_secs(12))
    .user_agent("FinanzBuddy/1.0 (personal finance app)")
    .build()
    .map_err(|e| AppError::Invalid(e.to_string()))?;
  let body = client
    .get(url)
    .send()
    .map_err(|e| AppError::Invalid(format!("News-Quelle nicht erreichbar ({source}): {e}")))?
    .text()
    .map_err(|e| AppError::Invalid(e.to_string()))?;

  let channel = rss::Channel::read_from(body.as_bytes()).map_err(|e| AppError::Invalid(e.to_string()))?;
  let cutoff = Utc::now() - Duration::days(7);
  let mut out = Vec::new();

  for item in channel.items() {
    let title = clean_rss_text(&decode_entities(item.title().unwrap_or("Ohne Titel").trim()));
    let link = item.link().unwrap_or("").trim().to_string();
    if link.is_empty() {
      continue;
    }
    let published = item
      .pub_date()
      .and_then(parse_rss_date)
      .unwrap_or_else(Utc::now);
    if published < cutoff {
      continue;
    }
    let description = clean_rss_text(&item_body(item));
    let summary = if description.chars().count() > 220 {
      format!("{}…", description.chars().take(220).collect::<String>())
    } else {
      description.clone()
    };
    out.push(NewsArticle {
      id: news_id(&link),
      title,
      summary: summary.clone(),
      body: if description.is_empty() { summary } else { description },
      url: link,
      source: source.to_string(),
      published_at: published.to_rfc3339(),
      category: category.to_string(),
      symbol: symbol.map(|s| s.to_string()),
    });
  }
  Ok(out)
}

struct DepotHolding {
  symbol: String,
  name: String,
}

fn depot_holdings(conn: &rusqlite::Connection, depot_account_id: Option<&str>) -> AppResult<Vec<DepotHolding>> {
  if let Some(id) = depot_account_id {
    let mut stmt = conn.prepare(
      "SELECT DISTINCT sh.symbol, sh.name FROM stock_holdings sh WHERE sh.depot_account_id = ?1 ORDER BY sh.name ASC",
    )?;
    let rows = stmt.query_map(params![id], |r| {
      Ok(DepotHolding {
        symbol: r.get(0)?,
        name: r.get(1)?,
      })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
  } else {
    let mut stmt =
      conn.prepare("SELECT DISTINCT symbol, name FROM stock_holdings ORDER BY name ASC")?;
    let rows = stmt.query_map([], |r| {
      Ok(DepotHolding {
        symbol: r.get(0)?,
        name: r.get(1)?,
      })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
  }
}

fn article_haystack(article: &NewsArticle) -> String {
  format!("{} {} {}", article.title, article.summary, article.body).to_lowercase()
}

fn haystack_contains_token(hay: &str, token: &str) -> bool {
  let t = token.trim().to_lowercase();
  if t.len() < 2 {
    return false;
  }
  hay.contains(&t)
}

fn article_matches_holding(article: &NewsArticle, holding: &DepotHolding, yahoo_symbols: &[String]) -> bool {
  let hay = article_haystack(article);
  if haystack_contains_token(&hay, &holding.name) {
    return true;
  }
  if haystack_contains_token(&hay, &holding.symbol) {
    return true;
  }
  if stocks::looks_like_isin(&holding.symbol) && hay.contains(&holding.symbol.to_lowercase()) {
    return true;
  }
  for sym in yahoo_symbols {
    if haystack_contains_token(&hay, sym) {
      return true;
    }
    if let Some(base) = sym.strip_suffix(".DE") {
      if haystack_contains_token(&hay, base) {
        return true;
      }
    }
  }
  false
}

fn is_stock_market_relevant(article: &NewsArticle) -> bool {
  let hay = article_haystack(article);
  let exclude = [
    "car insurance",
    "auto insurance",
    "kfz-versicherung",
    "military families",
    "veterans",
    "recipe",
    "rezept",
    "weather forecast",
    "wettervorhersage",
    "cnbc top news",
  ];
  if exclude.iter().any(|kw| hay.contains(kw)) {
    return false;
  }
  let include = [
    "aktie",
    "aktien",
    "stock",
    "shares",
    "equity",
    "börse",
    "dax",
    "index",
    "earnings",
    "quarter",
    "quartal",
    "dividend",
    "analyst",
    "market",
    "markt",
    "finance",
    "finanz",
    "invest",
    "depot",
    "portfolio",
    "nasdaq",
    "s&p",
  ];
  include.iter().any(|kw| hay.contains(kw))
}

pub fn fetch_market_news() -> AppResult<Vec<NewsArticle>> {
  let mut articles: Vec<NewsArticle> = Vec::new();
  let general_feeds = [
    (
      "https://www.tagesschau.de/wirtschaft/index~rss2.xml",
      "tagesschau Wirtschaft",
    ),
    (
      "https://feeds.bbci.co.uk/news/business/rss.xml",
      "BBC Business",
    ),
    (
      "https://feeds.reuters.com/reuters/businessNews",
      "Reuters Business",
    ),
    (
      "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGDAXI&region=DE&lang=de-DE",
      "Yahoo Finance · DAX",
    ),
    (
      "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US",
      "Yahoo Finance · S&P 500",
    ),
  ];

  for (url, source) in general_feeds {
    if let Ok(mut batch) = fetch_rss(url, source, "market", None) {
      articles.append(&mut batch);
    }
  }

  let mut seen = HashSet::new();
  articles.retain(|a| is_stock_market_relevant(a) && seen.insert(a.id.clone()));
  Ok(articles)
}

pub fn fetch_depot_news(conn: &rusqlite::Connection, depot_account_id: Option<&str>) -> AppResult<Vec<NewsArticle>> {
  let mut articles: Vec<NewsArticle> = Vec::new();
  let holdings = depot_holdings(conn, depot_account_id)?;
  for holding in holdings.iter().take(12) {
    let yahoo_symbols = stocks::news_yahoo_symbols_for_holding(&holding.symbol, &holding.name);
    if yahoo_symbols.is_empty() {
      continue;
    }
    for yahoo in yahoo_symbols.iter().take(4) {
      let lang = if yahoo.contains(".DE") || yahoo.ends_with(".DE") {
        "de-DE"
      } else {
        "en-US"
      };
      let region = if lang == "de-DE" { "DE" } else { "US" };
      let url = format!(
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s={yahoo}&region={region}&lang={lang}"
      );
      let source = format!("Yahoo Finance · {}", holding.name);
      if let Ok(mut batch) = fetch_rss(&url, &source, "depot", Some(holding.symbol.as_str())) {
        batch.retain(|a| {
          article_matches_holding(a, holding, &yahoo_symbols) && is_stock_market_relevant(a)
        });
        articles.append(&mut batch);
      }
    }
  }
  let mut seen = HashSet::new();
  articles.retain(|a| seen.insert(a.id.clone()));
  Ok(articles)
}

fn should_skip_page_fetch(url: &str) -> bool {
  let lower = url.to_lowercase();
  lower.contains("finance.yahoo.com")
    || lower.contains("cnbc.com")
    || lower.contains("marketwatch.com")
}

fn fetch_prnewswire_body(html: &str) -> Option<String> {
  if let Ok(re) = Regex::new(r#"(?is)<section[^>]*class="[^"]*release-body[^"]*"[^>]*>(.*?)</section>"#) {
    if let Some(cap) = re.captures(html) {
      let text = clean_article_text(&strip_html(cap.get(1)?.as_str()));
      if text.chars().count() >= 120 {
        return Some(text);
      }
    }
  }
  if let Ok(re) = Regex::new(r#"(?is)<div[^>]*class="[^"]*release-body[^"]*"[^>]*>(.*?)</div>"#) {
    if let Some(cap) = re.captures(html) {
      let text = clean_article_text(&strip_html(cap.get(1)?.as_str()));
      if text.chars().count() >= 120 {
        return Some(text);
      }
    }
  }
  None
}

fn fetch_page_text(url: &str) -> AppResult<String> {
  if should_skip_page_fetch(url) {
    return Err(AppError::Invalid("Seitenabruf für diese Quelle deaktiviert".into()));
  }

  let client = reqwest::blocking::Client::builder()
    .timeout(std::time::Duration::from_secs(15))
    .user_agent("FinanzBuddy/1.0 (personal finance app)")
    .build()
    .map_err(|e| AppError::Invalid(e.to_string()))?;
  let html = client
    .get(url)
    .send()
    .map_err(|e| AppError::Invalid(format!("Artikel nicht erreichbar: {e}")))?
    .text()
    .map_err(|e| AppError::Invalid(e.to_string()))?;

  if url.contains("prnewswire.com") {
    if let Some(body) = fetch_prnewswire_body(&html) {
      return Ok(body);
    }
  }

  let without_scripts = Regex::new(r"(?is)<script[^>]*>.*?</script>")
    .unwrap()
    .replace_all(&html, " ");
  let without_styles = Regex::new(r"(?is)<style[^>]*>.*?</style>")
    .unwrap()
    .replace_all(&without_scripts, " ");
  let without_nav = Regex::new(r"(?is)<nav[^>]*>.*?</nav>")
    .unwrap()
    .replace_all(&without_styles, " ");
  let without_header = Regex::new(r"(?is)<header[^>]*>.*?</header>")
    .unwrap()
    .replace_all(&without_nav, " ");
  let without_footer = Regex::new(r"(?is)<footer[^>]*>.*?</footer>")
    .unwrap()
    .replace_all(&without_header, " ");

  let paragraphs = Regex::new(r"(?is)<p[^>]*>(.*?)</p>").unwrap();
  let mut chunks: Vec<String> = Vec::new();
  for cap in paragraphs.captures_iter(&without_footer) {
    if let Some(inner) = cap.get(1) {
      let text = clean_article_text(&strip_html(inner.as_str()));
      if text.chars().count() >= 60 {
        chunks.push(text);
      }
    }
  }

  let body = if chunks.is_empty() {
    clean_article_text(&strip_html(&without_footer))
  } else {
    chunks.join("\n\n")
  };

  if body.chars().count() > 8000 {
    Ok(format!("{}…", body.chars().take(8000).collect::<String>()))
  } else if body.chars().count() < 120 {
    Err(AppError::Invalid("Kein Artikeltext extrahiert".into()))
  } else {
    Ok(body)
  }
}

fn enrich_article(article: &mut NewsArticle) {
  article.body = clean_article_text(&article.body);
  article.summary = clean_article_text(&article.summary);
  if article.body.chars().count() >= 500 {
    return;
  }
  if should_skip_page_fetch(&article.url) {
    return;
  }
  if let Ok(text) = fetch_page_text(&article.url) {
    if text.chars().count() > article.body.chars().count() {
      article.body = text;
      if article.summary.chars().count() < 220 {
        article.summary = if article.body.chars().count() > 220 {
          format!("{}…", article.body.chars().take(220).collect::<String>())
        } else {
          article.body.clone()
        };
      }
    }
  }
}

#[tauri::command]
pub fn list_stock_news(
  app: AppHandle,
  state: State<'_, AppState>,
  depot_account_id: Option<String>,
) -> CmdResult<StockNewsListResponse> {
  to_cmd_result(list_stock_news_inner(app, state, depot_account_id))
}

fn list_stock_news_inner(
  _app: AppHandle,
  state: State<'_, AppState>,
  depot_account_id: Option<String>,
) -> AppResult<StockNewsListResponse> {
  let (response, _needs_refresh) = news_cache::list_cached(&state, depot_account_id)?;
  Ok(response)
}

#[tauri::command]
pub fn refresh_stock_news(
  state: State<'_, AppState>,
  depot_account_id: Option<String>,
) -> CmdResult<StockNewsListResponse> {
  to_cmd_result(refresh_stock_news_inner(state, depot_account_id))
}

fn refresh_stock_news_inner(
  state: State<'_, AppState>,
  depot_account_id: Option<String>,
) -> AppResult<StockNewsListResponse> {
  let entry = news_cache::refresh_now(&state, depot_account_id)?;
  Ok(StockNewsListResponse {
    depot_articles: entry.depot,
    market_articles: entry.market,
    cached_at: Some(entry.updated_at),
    refreshing: false,
  })
}

#[tauri::command]
pub fn get_stock_news(
  state: State<'_, AppState>,
  depot_account_id: Option<String>,
  id: String,
) -> CmdResult<NewsArticle> {
  to_cmd_result(get_stock_news_inner(state, depot_account_id, id))
}

fn get_stock_news_inner(
  state: State<'_, AppState>,
  depot_account_id: Option<String>,
  id: String,
) -> AppResult<NewsArticle> {
  let mut article = news_cache::find_article(&state, depot_account_id, &id)
    .ok_or_else(|| AppError::Invalid("News-Artikel nicht gefunden — bitte News-Liste zuerst laden".into()))?;
  enrich_article(&mut article);
  Ok(article)
}

#[tauri::command]
pub fn open_external_url(url: String) -> CmdResult<()> {
  if !url.starts_with("http://") && !url.starts_with("https://") {
    return Err("Ungültige URL".into());
  }
  open::that(url).map_err(|e| e.to_string())
}
