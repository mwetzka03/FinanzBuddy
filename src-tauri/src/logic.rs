use crate::models::parse_iso_date;
use chrono::{Datelike, Duration, NaiveDate, Weekday};

pub fn month_bounds(month: &str) -> Option<(NaiveDate, NaiveDate)> {
  let parts: Vec<&str> = month.split('-').collect();
  if parts.len() != 2 {
    return None;
  }
  let y: i32 = parts[0].parse().ok()?;
  let m: u32 = parts[1].parse().ok()?;
  let start = NaiveDate::from_ymd_opt(y, m, 1)?;
  let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
  let next_month_start = NaiveDate::from_ymd_opt(ny, nm, 1)?;
  let end = next_month_start.pred_opt()?;
  Some((start, end))
}

pub fn month_add_iso(month: &str, delta_months: i32) -> Option<String> {
  let (start, _) = month_bounds(month)?;
  let next = add_months_keep_dom(start, delta_months);
  Some(format!("{}-{:02}", next.year(), next.month()))
}

pub fn last_day_of_month_iso(month: &str) -> Option<String> {
  let (_, end) = month_bounds(month)?;
  Some(date_to_iso(end))
}

pub fn date_to_iso(d: NaiveDate) -> String {
  d.format("%Y-%m-%d").to_string()
}

pub fn add_months_keep_dom(d: NaiveDate, months: i32) -> NaiveDate {
  let y = d.year();
  let m0 = (d.month0() as i32) + months;
  let ny = y + (m0.div_euclid(12));
  let nm0 = m0.rem_euclid(12);
  let nm = (nm0 as u32) + 1;
  let dom = d.day();
  if let Some(cand) = NaiveDate::from_ymd_opt(ny, nm, dom) {
    return cand;
  }
  let first_next = if nm == 12 {
    NaiveDate::from_ymd_opt(ny + 1, 1, 1).unwrap()
  } else {
    NaiveDate::from_ymd_opt(ny, nm + 1, 1).unwrap()
  };
  first_next.pred_opt().unwrap()
}

pub fn add_years_keep_dom(d: NaiveDate, years: i32) -> NaiveDate {
  let ny = d.year() + years;
  let m = d.month();
  let dom = d.day();
  if let Some(x) = NaiveDate::from_ymd_opt(ny, m, dom) {
    return x;
  }
  let first_next = if m == 12 {
    NaiveDate::from_ymd_opt(ny + 1, 1, 1).unwrap()
  } else {
    NaiveDate::from_ymd_opt(ny, m + 1, 1).unwrap()
  };
  first_next.pred_opt().unwrap()
}

pub fn next_occurrence(d: NaiveDate, cadence: &str) -> NaiveDate {
  match cadence {
    "once" => d + Duration::days(36500),
    "weekly" => d + Duration::days(7),
    "biweekly" => d + Duration::days(14),
    "monthly" => add_months_keep_dom(d, 1),
    "yearly" => add_years_keep_dom(d, 1),
    _ => d + Duration::days(30),
  }
}

fn end_cap(end_charge_date: Option<&str>) -> Option<NaiveDate> {
  end_charge_date.and_then(parse_iso_date)
}

pub fn generate_occurrences(
  first_charge_date: &str,
  cadence: &str,
  range_start: &str,
  range_end: &str,
  limit: usize,
  end_charge_date: Option<&str>,
) -> Vec<String> {
  let mut out = Vec::new();
  let first = match parse_iso_date(first_charge_date) {
    Some(d) => d,
    None => return out,
  };
  let rs = match parse_iso_date(range_start) {
    Some(d) => d,
    None => return out,
  };
  let re = match parse_iso_date(range_end) {
    Some(d) => d,
    None => return out,
  };
  if re < rs {
    return out;
  }
  let cap = end_cap(end_charge_date);
  if cadence == "once" {
    if first >= rs && first <= re {
      if let Some(end) = cap {
        if first <= end {
          out.push(date_to_iso(first));
        }
      } else {
        out.push(date_to_iso(first));
      }
    }
    return out;
  }

  let mut cur = first;
  while cur < rs {
    cur = next_occurrence(cur, cadence);
    if out.len() > limit {
      break;
    }
  }
  while cur <= re && out.len() < limit {
    if let Some(end) = cap {
      if cur > end {
        break;
      }
    }
    if cur >= first {
      out.push(date_to_iso(cur));
    }
    cur = next_occurrence(cur, cadence);
  }
  out
}

pub fn is_weekend(d: NaiveDate) -> bool {
  matches!(d.weekday(), Weekday::Sat | Weekday::Sun)
}

pub fn easter_sunday(year: i32) -> NaiveDate {
  let a = year % 19;
  let b = year / 100;
  let c = year % 100;
  let d = b / 4;
  let e = b % 4;
  let f = (b + 8) / 25;
  let g = (b - f + 1) / 3;
  let h = (19 * a + b - d - g + 15) % 30;
  let i = c / 4;
  let k = c % 4;
  let l = (32 + 2 * e + 2 * i - h - k) % 7;
  let m = (a + 11 * h + 22 * l) / 451;
  let month = (h + l - 7 * m + 114) / 31;
  let day = ((h + l - 7 * m + 114) % 31) + 1;
  NaiveDate::from_ymd_opt(year, month as u32, day as u32).unwrap()
}

pub fn is_holiday_rp(d: NaiveDate) -> bool {
  let y = d.year();
  let fixed = [(1, 1), (5, 1), (10, 3), (11, 1), (12, 25), (12, 26)];
  if fixed.iter().any(|(m, day)| d.month() == *m && d.day() == *day) {
    return true;
  }
  let easter = easter_sunday(y);
  let karfreitag = easter - Duration::days(2);
  let ostermontag = easter + Duration::days(1);
  let himmelfahrt = easter + Duration::days(39);
  let pfingstmontag = easter + Duration::days(50);
  let fronleichnam = easter + Duration::days(60);
  d == karfreitag
    || d == ostermontag
    || d == himmelfahrt
    || d == pfingstmontag
    || d == fronleichnam
}

pub fn is_business_day_rp(d: NaiveDate) -> bool {
  !is_weekend(d) && !is_holiday_rp(d)
}

pub fn first_business_day_of_month_rp(year: i32, month: u32) -> NaiveDate {
  let mut d = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
  while !is_business_day_rp(d) {
    d = d + Duration::days(1);
  }
  d
}

pub fn last_business_day_of_month_rp(year: i32, month: u32) -> NaiveDate {
  let first_next = if month == 12 {
    NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap()
  } else {
    NaiveDate::from_ymd_opt(year, month + 1, 1).unwrap()
  };
  let mut d = first_next.pred_opt().unwrap();
  while !is_business_day_rp(d) {
    d -= Duration::days(1);
  }
  d
}

/// Buchungsmonat für Einnahmen: am letzten Bankarbeitstag → Folgemonat.
pub fn income_accounting_month(iso_date: &str) -> Option<String> {
  let d = parse_iso_date(iso_date)?;
  let month = format!("{:04}-{:02}", d.year(), d.month());
  let last_bd = last_business_day_of_month_rp(d.year(), d.month());
  if d == last_bd {
    return month_add_iso(&month, 1);
  }
  Some(month)
}

pub fn resolve_month_due_date_rp(year: i32, month: u32, due_rule: &str, day_of_month: Option<u32>) -> NaiveDate {
  match due_rule {
    "first_business_day" => first_business_day_of_month_rp(year, month),
    "last_business_day" => last_business_day_of_month_rp(year, month),
    "calendar_day" | _ => {
      let dom = day_of_month.unwrap_or(1);
      if let Some(d) = NaiveDate::from_ymd_opt(year, month, dom) {
        d
      } else {
        let first_next = if month == 12 {
          NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap()
        } else {
          NaiveDate::from_ymd_opt(year, month + 1, 1).unwrap()
        };
        first_next.pred_opt().unwrap()
      }
    }
  }
}

pub fn effective_day_of_month(first: NaiveDate, due_rule: &str, day_of_month: Option<u32>) -> Option<u32> {
  if due_rule != "calendar_day" {
    return None;
  }
  let dom = day_of_month.filter(|&d| (1..=31).contains(&d));
  match dom {
    // Legacy/default: day_of_month=1 but first charge on another day → use first charge day.
    Some(d) if d == 1 && first.day() != 1 => Some(first.day()),
    Some(d) => Some(d),
    None => Some(first.day()),
  }
}

fn clamp_due_to_first_charge(due: NaiveDate, first: NaiveDate) -> NaiveDate {
  if due < first && due.year() == first.year() && due.month() == first.month() {
    first
  } else {
    due
  }
}

pub fn generate_occurrences_with_due_rule_rp(
  first_charge_date: &str,
  cadence: &str,
  due_rule: &str,
  day_of_month: Option<u32>,
  range_start: &str,
  range_end: &str,
  limit: usize,
  end_charge_date: Option<&str>,
) -> Vec<String> {
  if cadence == "weekly" || cadence == "biweekly" {
    return generate_occurrences(
      first_charge_date,
      cadence,
      range_start,
      range_end,
      limit,
      end_charge_date,
    );
  }

  let first = match parse_iso_date(first_charge_date) {
    Some(d) => d,
    None => return Vec::new(),
  };
  let rs = match parse_iso_date(range_start) {
    Some(d) => d,
    None => return Vec::new(),
  };
  let re = match parse_iso_date(range_end) {
    Some(d) => d,
    None => return Vec::new(),
  };
  if re < rs {
    return Vec::new();
  }
  let cap = end_cap(end_charge_date);
  if cadence == "once" {
    let due = resolve_month_due_date_rp(
      first.year(),
      first.month(),
      due_rule,
      effective_day_of_month(first, due_rule, day_of_month),
    );
    let due = clamp_due_to_first_charge(due, first);
    if due >= rs && due <= re {
      if let Some(end) = cap {
        if due <= end {
          return vec![date_to_iso(due)];
        }
      } else {
        return vec![date_to_iso(due)];
      }
    }
    return Vec::new();
  }
  let effective_dom = effective_day_of_month(first, due_rule, day_of_month);

  let mut period = first;
  let max_iters = 5000;

  for _ in 0..max_iters {
    let due = resolve_month_due_date_rp(period.year(), period.month(), due_rule, effective_dom);
    if due >= rs {
      break;
    }
    let next = next_occurrence(period, cadence);
    if next <= period {
      break;
    }
    period = next;
  }

  let mut out = Vec::new();
  for _ in 0..max_iters {
    if out.len() >= limit {
      break;
    }
    let due = clamp_due_to_first_charge(
      resolve_month_due_date_rp(period.year(), period.month(), due_rule, effective_dom),
      first,
    );
    if let Some(end) = cap {
      if due > end {
        break;
      }
    }
    if due > re {
      break;
    }
    if due >= rs && due >= first {
      out.push(date_to_iso(due));
    }
    let next = next_occurrence(period, cadence);
    if next <= period {
      break;
    }
    period = next;
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn monthly_fixed_cost_mid_month_not_shifted_to_first() {
    let june = generate_occurrences_with_due_rule_rp(
      "2026-06-08",
      "monthly",
      "calendar_day",
      Some(1),
      "2026-06-01",
      "2026-06-30",
      10,
      None,
    );
    assert_eq!(june, vec!["2026-06-08"]);

    let july = generate_occurrences_with_due_rule_rp(
      "2026-06-08",
      "monthly",
      "calendar_day",
      Some(1),
      "2026-07-01",
      "2026-07-31",
      10,
      None,
    );
    assert_eq!(july, vec!["2026-07-08"]);
  }

  #[test]
  fn monthly_fixed_cost_repeats_after_first_month() {
    let first = "2026-06-15";
    let june = generate_occurrences_with_due_rule_rp(
      first,
      "monthly",
      "calendar_day",
      Some(15),
      "2026-06-01",
      "2026-06-30",
      10,
      None,
    );
    assert_eq!(june, vec!["2026-06-15"]);

    let july = generate_occurrences_with_due_rule_rp(
      first,
      "monthly",
      "calendar_day",
      Some(15),
      "2026-07-01",
      "2026-07-31",
      10,
      None,
    );
    assert_eq!(july, vec!["2026-07-15"]);

    let august = generate_occurrences_with_due_rule_rp(
      first,
      "monthly",
      "calendar_day",
      Some(15),
      "2026-08-01",
      "2026-08-31",
      10,
      None,
    );
    assert_eq!(august, vec!["2026-08-15"]);

    let september = generate_occurrences_with_due_rule_rp(
      first,
      "monthly",
      "calendar_day",
      Some(15),
      "2026-09-01",
      "2026-09-30",
      10,
      None,
    );
    assert_eq!(september, vec!["2026-09-15"]);
  }

  #[test]
  fn fixed_cost_respects_end_date() {
    let occ = generate_occurrences_with_due_rule_rp(
      "2026-06-15",
      "monthly",
      "calendar_day",
      Some(15),
      "2026-06-01",
      "2026-12-31",
      20,
      Some("2026-08-15"),
    );
    assert_eq!(occ, vec!["2026-06-15", "2026-07-15", "2026-08-15"]);
  }
}
