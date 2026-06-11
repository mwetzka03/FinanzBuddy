import type { BuyItem, Cadence, FixedCost, IncomeForecast, IsoDate, IsoMonth, LedgerTransaction } from './types';
import { isoToday, monthEndDate, monthStartDate } from './date';
import { formatEurFromCents, formatExpenseEurFromCents, formatIncomeEurFromCents, formatSignedEurFromCents } from './money';

export type EntryKindFilter =
  | 'all'
  | 'income'
  | 'expense'
  | 'adjustment'
  | 'transfer'
  | 'income_forecast'
  | 'expense_forecast';

export const ENTRY_KIND_FILTERS: EntryKindFilter[] = [
  'all',
  'income',
  'expense',
  'adjustment',
  'transfer',
  'income_forecast',
  'expense_forecast',
];

/** Typen für die Mehrfach-Auswahl auf der Transaktionsseite (ohne „Alle“). */
export const CHECKABLE_ENTRY_KINDS: EntryKindFilter[] = ENTRY_KIND_FILTERS.filter((k) => k !== 'all');

export function defaultCheckedEntryKinds(): Set<EntryKindFilter> {
  return new Set(CHECKABLE_ENTRY_KINDS);
}

export type UnifiedEntrySource = 'ledger' | 'income_forecast' | 'expense_forecast' | 'buy_forecast';

export type UnifiedEntry = {
  id: string;
  source: UnifiedEntrySource;
  displayKind: string;
  sortDate: string;
  date: IsoDate | null;
  title: string;
  notes: string | null;
  amountCents: number;
  icon: string;
  color: string;
  ledger?: LedgerTransaction;
  incomeForecast?: IncomeForecast;
  fixedCost?: FixedCost;
  buyItem?: BuyItem;
  cadence?: Cadence;
  dueRule?: string;
  dayOfMonth?: number | null;
  categoryLabel?: string | null;
  nextDates?: IsoDate[];
};

export function kindFilterLabel(filter: EntryKindFilter, t: (key: string) => string): string {
  if (filter === 'all') return t('transactions.filterAll');
  const key = `transactions.kinds.${filter}`;
  const translated = t(key);
  return translated === key ? filter : translated;
}

export function dueRuleShort(rule: string, dayOfMonth: number | null | undefined, t: (key: string) => string): string {
  if (rule === 'calendar_day' && dayOfMonth) {
    return `${t(`dueRule.${rule}`)} (${dayOfMonth}.)`;
  }
  const key = `dueRule.${rule}`;
  const translated = t(key);
  return translated === key ? rule : translated;
}

function monthFromDate(date: IsoDate): IsoMonth {
  return date.slice(0, 7) as IsoMonth;
}

function usesMonthLevelBooking(cadence: Cadence): boolean {
  return cadence === 'monthly' || cadence === 'yearly' || cadence === 'once';
}

export function incomeForecastSourceId(forecastId: string, occurrenceDate: IsoDate): string {
  return `income_forecast:${forecastId}:${occurrenceDate}`;
}

export function parseIncomeForecastSourceId(sourceId: string | null | undefined): { forecastId: string; occurrenceDate: IsoDate } | null {
  if (!sourceId?.startsWith('income_forecast:')) return null;
  const rest = sourceId.slice('income_forecast:'.length);
  const splitAt = rest.lastIndexOf(':');
  if (splitAt <= 0) return null;
  const forecastId = rest.slice(0, splitAt);
  const occurrenceDate = rest.slice(splitAt + 1) as IsoDate;
  if (occurrenceDate.length !== 10) return null;
  return { forecastId, occurrenceDate };
}

/** Ist-Buchung für einen Prognose-Termin (inkl. Bankimport ohne source_id). */
export function findIncomeOccurrenceLedgerTx(
  forecast: IncomeForecast,
  occurrenceDate: IsoDate,
  ledger: LedgerTransaction[],
): LedgerTransaction | undefined {
  const exactSource = incomeForecastSourceId(forecast.id, occurrenceDate);
  return ledger.find((tx) => {
    if (tx.kind !== 'income') return false;
    if (tx.sourceId === exactSource) return true;
    const parsed = parseIncomeForecastSourceId(tx.sourceId);
    if (!parsed || parsed.forecastId !== forecast.id) return false;
    if (usesMonthLevelBooking(forecast.cadence)) {
      return tx.date.slice(0, 7) === occurrenceDate.slice(0, 7);
    }
    return tx.date === occurrenceDate;
  });
}

/** Haupteinnahme: verknüpfte Ist-Buchung inkl. Bankimport am Prognosetag. */
export function findPrimaryIncomeOccurrenceLedgerTx(
  forecast: IncomeForecast,
  occurrenceDate: IsoDate,
  ledger: LedgerTransaction[],
): LedgerTransaction | undefined {
  const linked = findIncomeOccurrenceLedgerTx(forecast, occurrenceDate, ledger);
  if (linked) return linked;
  return ledger.find(
    (tx) =>
      tx.kind === 'income' &&
      tx.sourceId?.startsWith('bank_import:') &&
      tx.date === occurrenceDate,
  );
}

export function isIncomeOccurrenceBooked(
  forecast: IncomeForecast,
  occurrenceDate: IsoDate,
  ledger: LedgerTransaction[],
): boolean {
  return findIncomeOccurrenceLedgerTx(forecast, occurrenceDate, ledger) !== undefined;
}

/** Haupteinnahme aus dem Bankimport nicht als rohe Ist-Zeile anzeigen — nur als Prognose. */
export function isPrimarySalaryLedgerRow(
  row: LedgerTransaction,
  primaryForecastId: string | null | undefined,
  mainAccountId: string,
  ledger: LedgerTransaction[],
  forecastsById: Map<string, IncomeForecast>,
): boolean {
  if (!primaryForecastId || row.kind !== 'income' || row.accountId !== mainAccountId) return false;
  const parsed = parseIncomeForecastSourceId(row.sourceId);
  if (parsed?.forecastId === primaryForecastId) return true;
  const forecast = forecastsById.get(primaryForecastId);
  if (!forecast) return false;
  if (findPrimaryIncomeOccurrenceLedgerTx(forecast, row.date, ledger)?.id === row.id) {
    return true;
  }
  return false;
}

export function incomeForecastOccurrences(forecast: IncomeForecast, nextDates: IsoDate[] | undefined): IsoDate[] {
  const dates = [...(nextDates ?? [])];
  if (dates.length === 0 && forecast.firstChargeDate) {
    dates.push(forecast.firstChargeDate);
  }
  return dates;
}

/** Prognose-Termin ausblenden, wenn dafür bereits eine zugeordnete Ist-Buchung existiert. */
export function isFixedCostOccurrenceBooked(
  fixedCost: FixedCost,
  occurrenceDate: IsoDate,
  ledger: LedgerTransaction[],
): boolean {
  return ledger.some((tx) => {
    if (tx.fixedCostId !== fixedCost.id || tx.kind !== 'expense') return false;
    if (usesMonthLevelBooking(fixedCost.cadence)) {
      return tx.date.slice(0, 7) === occurrenceDate.slice(0, 7);
    }
    return tx.date === occurrenceDate;
  });
}

/** @deprecated Use isFixedCostOccurrenceBooked for a specific occurrence date. */
export function isFixedCostBookedInMonth(
  fixedCostId: string,
  month: IsoMonth,
  ledger: LedgerTransaction[],
): boolean {
  return ledger.some(
    (tx) => tx.fixedCostId === fixedCostId && tx.kind === 'expense' && tx.date.startsWith(month),
  );
}

export function fixedCostForecastOccurrences(
  fc: FixedCost,
  nextDates: IsoDate[] | undefined,
): IsoDate[] {
  const dates = [...(nextDates ?? [])];
  if (dates.length === 0 && fc.firstChargeDate) {
    dates.push(fc.firstChargeDate);
  }
  return dates;
}

function buyItemSortDate(item: BuyItem): IsoDate {
  if (item.plannedMonth) return `${item.plannedMonth}-01` as IsoDate;
  return isoToday();
}

function buyItemInMonth(item: BuyItem, month: IsoMonth): boolean {
  if (!item.plannedMonth) return true;
  return item.plannedMonth === month;
}

export function buildUnifiedEntries(input: {
  ledger: LedgerTransaction[];
  incomeForecasts: IncomeForecast[];
  fixedCosts: FixedCost[];
  buyItems?: BuyItem[];
  accountId: string;
  mainAccountId: string;
  primaryIncomeForecastId?: string | null;
  variableCostNames: Map<string, string>;
  fixedCostNames: Map<string, string>;
  buyItemNames?: Map<string, string>;
  buyItemGroupNames?: Map<string, string>;
  buyItemById?: Map<string, BuyItem>;
  buyItemGroupById?: Map<string, { icon: string; color: string }>;
  nextDatesByForecastId: Map<string, IsoDate[]>;
  nextDatesByFixedCostId: Map<string, IsoDate[]>;
}): UnifiedEntry[] {
  const items: UnifiedEntry[] = [];

  for (const row of input.ledger) {
    let categoryLabel: string | null = null;
    if (row.variableCostId) {
      categoryLabel = input.variableCostNames.get(row.variableCostId) ?? null;
    } else if (row.fixedCostId) {
      categoryLabel = input.fixedCostNames.get(row.fixedCostId) ?? null;
    } else if (row.buyItemGroupId) {
      categoryLabel = input.buyItemGroupNames?.get(row.buyItemGroupId) ?? null;
    } else if (row.buyItemId) {
      categoryLabel = input.buyItemNames?.get(row.buyItemId) ?? null;
    }

    let icon = row.icon;
    let color = row.color;
    if (row.buyItemId) {
      const buy = input.buyItemById?.get(row.buyItemId);
      if (buy) {
        icon = buy.icon;
        color = buy.color;
      }
    } else if (row.buyItemGroupId) {
      const groupStyle = input.buyItemGroupById?.get(row.buyItemGroupId);
      if (groupStyle) {
        icon = groupStyle.icon;
        color = groupStyle.color;
      }
    }

    items.push({
      id: `ledger:${row.id}`,
      source: 'ledger',
      displayKind: row.kind,
      sortDate: row.date,
      date: row.date,
      title: row.title,
      notes: row.notes,
      amountCents: row.amountCents,
      icon,
      color,
      ledger: row,
      categoryLabel,
    });
  }

  for (const forecast of input.incomeForecasts) {
    if (!forecast.active) continue;
    if (input.accountId && forecast.accountId !== input.accountId) continue;
    const nextDates = input.nextDatesByForecastId.get(forecast.id);
    const occurrences = incomeForecastOccurrences(forecast, nextDates);
    const occDate = occurrences.find(
      (date) => !findPrimaryIncomeOccurrenceLedgerTx(forecast, date, input.ledger),
    );
    if (!occDate) continue;
    items.push({
      id: `income_forecast:${forecast.id}:${occDate}`,
      source: 'income_forecast',
      displayKind: 'income_forecast',
      sortDate: occDate,
      date: occDate,
      title: forecast.name,
      notes: null,
      amountCents: forecast.amountCents,
      icon: forecast.icon,
      color: forecast.color,
      incomeForecast: forecast,
      cadence: forecast.cadence,
      dueRule: forecast.dueRule,
      dayOfMonth: forecast.dayOfMonth,
      nextDates,
    });
  }

  for (const item of input.buyItems ?? []) {
    if (item.status !== 'parked') continue;
    const sortDate = buyItemSortDate(item);
    items.push({
      id: `buy_forecast:${item.id}`,
      source: 'buy_forecast',
      displayKind: 'expense_forecast',
      sortDate,
      date: sortDate,
      title: item.name,
      notes: item.description,
      amountCents: item.amountCents,
      icon: item.icon,
      color: item.color,
      buyItem: item,
    });
  }

  for (const fc of input.fixedCosts) {
    if (!fc.active) continue;
    if (input.accountId && fc.accountId !== input.accountId) continue;
    const nextDates = input.nextDatesByFixedCostId.get(fc.id);
    const occurrences = fixedCostForecastOccurrences(fc, nextDates);
    const occDate = occurrences.find((date) => !isFixedCostOccurrenceBooked(fc, date, input.ledger));
    if (!occDate) continue;
    items.push({
      id: `expense_forecast:${fc.id}:${occDate}`,
      source: 'expense_forecast',
      displayKind: 'expense_forecast',
      sortDate: occDate,
      date: occDate,
      title: fc.name,
      notes: fc.notes,
      amountCents: fc.amountCents,
      icon: fc.icon,
      color: fc.color,
      fixedCost: fc,
      cadence: fc.cadence,
      dueRule: fc.dueRule,
      dayOfMonth: fc.dayOfMonth,
      nextDates,
    });
  }

  items.sort((a, b) => b.sortDate.localeCompare(a.sortDate) || a.title.localeCompare(b.title));
  return items;
}

export function filterUnifiedEntries(items: UnifiedEntry[], kindFilter: EntryKindFilter): UnifiedEntry[] {
  if (kindFilter === 'all') return items;
  if (kindFilter === 'income_forecast' || kindFilter === 'expense_forecast') {
    return items.filter((e) => e.displayKind === kindFilter);
  }
  if (kindFilter === 'income') {
    return items.filter((e) => e.source === 'ledger' && e.displayKind === 'income');
  }
  return items.filter((e) => e.source === 'ledger' && e.displayKind === kindFilter);
}

export function filterUnifiedEntriesByKinds(items: UnifiedEntry[], kinds: Set<EntryKindFilter>): UnifiedEntry[] {
  if (kinds.size === 0) return [];
  if (kinds.size === CHECKABLE_ENTRY_KINDS.length) return items;
  return items.filter((e) => {
    if (e.source === 'buy_forecast') {
      return kinds.has('expense_forecast');
    }
    return kinds.has(e.displayKind as EntryKindFilter);
  });
}

export function filterUnifiedEntriesByMonth(items: UnifiedEntry[], month: IsoMonth | 'all'): UnifiedEntry[] {
  if (month === 'all') return items;
  const start = monthStartDate(month);
  const end = monthEndDate(month);
  return items.filter((entry) => {
    if (entry.source === 'buy_forecast' && entry.buyItem) {
      return buyItemInMonth(entry.buyItem, month);
    }
    if (!entry.date) return false;
    return entry.date >= start && entry.date <= end;
  });
}

export function formatEntryAmount(entry: UnifiedEntry): string {
  if (entry.displayKind === 'transfer' || entry.displayKind === 'adjustment') {
    return formatEurFromCents(Math.abs(entry.amountCents));
  }
  if (entry.displayKind === 'income_forecast') {
    return formatIncomeEurFromCents(entry.amountCents);
  }
  if (entry.displayKind === 'expense_forecast') {
    return formatExpenseEurFromCents(entry.amountCents);
  }
  return formatSignedEurFromCents(entry.amountCents);
}

export function entryAmountCentsForTable(entry: UnifiedEntry): number {
  if (entry.displayKind === 'transfer') {
    return Math.abs(entry.amountCents);
  }
  if (entry.displayKind === 'adjustment') {
    return Math.abs(entry.amountCents);
  }
  if (entry.displayKind === 'expense_forecast') {
    return -Math.abs(entry.amountCents);
  }
  return entry.amountCents;
}

export function ledgerRowTitle(
  row: LedgerTransaction,
  accountMap: Map<string, string>,
  fixedCostNames?: Map<string, string>,
  variableCostNames?: Map<string, string>,
  buyItemNames?: Map<string, string>,
  buyItemGroupNames?: Map<string, string>,
): string {
  if (row.kind === 'expense' && row.variableCostId) {
    return variableCostNames?.get(row.variableCostId) ?? row.title;
  }
  if (row.kind === 'expense' && row.fixedCostId) {
    return fixedCostNames?.get(row.fixedCostId) ?? row.title;
  }
  if (row.kind === 'expense' && row.buyItemGroupId) {
    return buyItemGroupNames?.get(row.buyItemGroupId) ?? row.title;
  }
  if (row.kind === 'expense' && row.buyItemId) {
    return buyItemNames?.get(row.buyItemId) ?? row.title;
  }
  if (row.kind === 'transfer') {
    const from = accountMap.get(row.fromAccountId ?? '') ?? '—';
    const to = accountMap.get(row.toAccountId ?? '') ?? '—';
    return `${from} → ${to}`;
  }
  return row.title;
}

export function ledgerEntriesForFixedCost(fixedCostId: string, ledger: LedgerTransaction[]): LedgerTransaction[] {
  return ledger
    .filter((tx) => tx.fixedCostId === fixedCostId && tx.kind === 'expense')
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
