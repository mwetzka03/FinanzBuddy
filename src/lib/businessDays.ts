import { monthAdd } from './date';
import type { IsoDate, IsoMonth } from './types';

function parseIsoDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIsoFromDate(d: Date): IsoDate {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}` as IsoDate;
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isHolidayRp(d: Date): boolean {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const fixed = [
    [1, 1],
    [5, 1],
    [10, 3],
    [11, 1],
    [12, 25],
    [12, 26],
  ];
  if (fixed.some(([fm, fd]) => m === fm && day === fd)) return true;

  const easter = easterSunday(y);
  const holidays = [
    addDays(easter, -2),
    addDays(easter, 1),
    addDays(easter, 39),
    addDays(easter, 50),
    addDays(easter, 60),
  ];
  return holidays.some((h) => sameDay(h, d));
}

export function isBusinessDayRp(iso: IsoDate): boolean {
  const d = parseIsoDate(iso);
  return !isWeekend(d) && !isHolidayRp(d);
}

export function lastBusinessDayOfMonthRp(month: IsoMonth): IsoDate {
  const [y, m] = month.split('-').map(Number);
  let d = new Date(y, m, 0);
  while (!isBusinessDayRp(toIsoFromDate(d))) {
    d.setDate(d.getDate() - 1);
  }
  return toIsoFromDate(d);
}

export function firstBusinessDayOfMonthRp(month: IsoMonth): IsoDate {
  const [y, m] = month.split('-').map(Number);
  let d = new Date(y, m - 1, 1);
  while (!isBusinessDayRp(toIsoFromDate(d))) {
    d.setDate(d.getDate() + 1);
  }
  return toIsoFromDate(d);
}

function sameIsoDay(a: IsoDate, b: IsoDate): boolean {
  return a === b;
}

export function inferIncomeDueRule(date: IsoDate): {
  dueRule: 'calendar_day' | 'first_business_day' | 'last_business_day';
  dayOfMonth: number | null;
} {
  const month = date.slice(0, 7) as IsoMonth;
  const [year, monthNum, day] = date.split('-').map(Number);
  const firstBd = firstBusinessDayOfMonthRp(month);
  const lastBd = lastBusinessDayOfMonthRp(month);
  if (sameIsoDay(date, firstBd)) {
    return { dueRule: 'first_business_day', dayOfMonth: null };
  }
  if (sameIsoDay(date, lastBd)) {
    return { dueRule: 'last_business_day', dayOfMonth: null };
  }
  const monthEnd = new Date(year, monthNum, 0);
  const monthEndIso = toIsoFromDate(monthEnd);
  if (day === 1 || sameIsoDay(date, monthEndIso)) {
    return { dueRule: 'calendar_day', dayOfMonth: day };
  }
  return { dueRule: 'calendar_day', dayOfMonth: day };
}

/** income_date für Backend: 0 = 1. Bankarbeitstag, 99 = letzter, 1–31 = Kalendertag. */
export function deriveIncomeDate(
  periodMode: 'calendar_month' | 'since_last_salary',
  dueRule: 'calendar_day' | 'first_business_day' | 'last_business_day',
  dayOfMonth?: number | null,
): number {
  if (periodMode === 'calendar_month') return 0;
  if (dueRule === 'first_business_day') return 0;
  if (dueRule === 'last_business_day') return 99;
  return dayOfMonth ?? 1;
}

/** Kalender-Monat der Einnahme (YYYY-MM). */
export function incomeAccountingMonth(iso: IsoDate): IsoMonth {
  return iso.slice(0, 7) as IsoMonth;
}
