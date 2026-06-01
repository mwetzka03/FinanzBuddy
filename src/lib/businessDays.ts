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

/** Buchungsmonat für Einnahmen: am letzten Bankarbeitstag → Folgemonat. */
export function incomeAccountingMonth(iso: IsoDate): IsoMonth {
  const d = parseIsoDate(iso);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` as IsoMonth;
  const lastBd = lastBusinessDayOfMonthRp(month);
  if (iso === lastBd) {
    return monthAdd(month, 1);
  }
  return month;
}
