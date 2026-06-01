import type { IsoDate, IsoMonth } from './types';

export function isoToday(): IsoDate {
  const d = new Date();
  return toIsoDate(d);
}

export function toIsoDate(d: Date): IsoDate {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}` as IsoDate;
}

export function toIsoMonth(d: Date): IsoMonth {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}` as IsoMonth;
}

export function monthAdd(month: IsoMonth, deltaMonths: number): IsoMonth {
  const [y, m] = month.split('-').map((x) => Number(x));
  const base = new Date(y, m - 1, 1);
  base.setMonth(base.getMonth() + deltaMonths);
  return toIsoMonth(base);
}

export function monthStartDate(month: IsoMonth): IsoDate {
  return `${month}-01` as IsoDate;
}

/** Display as DD.MM.YYYY */
export function formatDisplayDate(iso: IsoDate | string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`;
}

/** RFC3339 / ISO-Zeitstempel → DD.MM.YYYY, HH:MM */
export function formatDisplayDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy}, ${hh}:${min}`;
}

export function formatDisplayMonth(isoMonth: IsoMonth | string): string {
  const [y, m] = isoMonth.split('-');
  if (!y || !m) return isoMonth;
  return `${m.padStart(2, '0')}.${y}`;
}

/** Anzeige z. B. „Mai 2026“ / „May 2026“. */
export function formatDisplayMonthLong(isoMonth: IsoMonth | string, locale: 'de' | 'en' = 'de'): string {
  const [y, m] = isoMonth.split('-');
  if (!y || !m) return isoMonth;
  const date = new Date(Number(y), Number(m) - 1, 1);
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'de-DE', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function isoToMonth(iso: IsoDate): IsoMonth {
  return iso.slice(0, 7) as IsoMonth;
}

export function monthEndDate(month: IsoMonth): IsoDate {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(last).padStart(2, '0')}` as IsoDate;
}

export const VARIABLE_COSTS_START_MONTH = '2026-06' as IsoMonth;

export function dayAdd(iso: IsoDate, deltaDays: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return toIsoDate(dt);
}

/** Monat abgeschlossen (heute liegt nach dem letzten Kalendertag). */
export function isMonthClosed(month: IsoMonth): boolean {
  return isoToday() > monthEndDate(month);
}
