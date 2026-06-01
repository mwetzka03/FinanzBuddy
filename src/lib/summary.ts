import { monthAdd, monthStartDate } from './date';
import { incomeAccountingMonth } from './businessDays';
import type { IsoDate, IsoMonth, MonthView, TimelineEvent } from './types';

/** Frühester Monat in der Monatsnavigation (Mai 2026). */
export const DASHBOARD_MIN_MONTH = '2026-05' as IsoMonth;

function isBalanceOnlyEvent(ev: TimelineEvent): boolean {
  return ev.type === 'adjustment' || ev.type === 'transfer' || ev.type === 'stock_purchase';
}

function isExpenseEvent(ev: TimelineEvent): boolean {
  return !isBalanceOnlyEvent(ev) && ev.amountCents < 0;
}

function isIncomeEvent(ev: TimelineEvent): boolean {
  return !isBalanceOnlyEvent(ev) && ev.amountCents > 0;
}

function matchesLiquidFilter(ev: TimelineEvent, liquidAccountIds?: Set<string>): boolean {
  if (!liquidAccountIds) return true;
  if (!ev.accountId) return false;
  return liquidAccountIds.has(ev.accountId);
}

export function monthWindowStart(month: IsoMonth): IsoDate {
  return monthStartDate(month);
}

export function sumIncomeFromEvents(
  events: TimelineEvent[],
  accountingMonth: IsoMonth,
  liquidAccountIds?: Set<string>,
): number {
  let total = 0;
  for (const ev of events) {
    if (!isIncomeEvent(ev)) continue;
    if (incomeAccountingMonth(ev.date) !== accountingMonth) continue;
    if (!matchesLiquidFilter(ev, liquidAccountIds)) continue;
    total += ev.amountCents;
  }
  return total;
}

export function sumExpensesFromEvents(
  events: TimelineEvent[],
  windowStart: IsoDate,
  liquidAccountIds?: Set<string>,
): number {
  let total = 0;
  for (const ev of events) {
    if (!isExpenseEvent(ev)) continue;
    if (ev.date < windowStart) continue;
    if (!matchesLiquidFilter(ev, liquidAccountIds)) continue;
    total += Math.abs(ev.amountCents);
  }
  return total;
}

/** Netto-Transfer auf liquiden Konten (Ausgang negativ, Eingang positiv). */
export function sumLiquidTransferNet(
  events: TimelineEvent[],
  windowStart: IsoDate,
  liquidAccountIds: Set<string>,
): number {
  let net = 0;
  for (const ev of events) {
    if (ev.type !== 'transfer') continue;
    if (ev.date < windowStart) continue;
    if (!ev.accountId || !liquidAccountIds.has(ev.accountId)) continue;
    net += ev.amountCents;
  }
  return net;
}

export function sumDayExpenses(events: TimelineEvent[], date: IsoDate): number {
  let total = 0;
  for (const ev of events) {
    if (ev.date !== date) continue;
    if (!isExpenseEvent(ev)) continue;
    total += Math.abs(ev.amountCents);
  }
  return total;
}

export function sumDayIncome(events: TimelineEvent[], date: IsoDate): number {
  let total = 0;
  for (const ev of events) {
    if (ev.date !== date) continue;
    if (!isIncomeEvent(ev)) continue;
    total += ev.amountCents;
  }
  return total;
}

export type DashboardMonthBalance = {
  month: IsoMonth;
  startBalanceCents: number;
  endBalanceCents: number;
  startLiquidCents: number;
  endLiquidCents: number;
  incomeCents: number;
  expensesCents: number;
  liquidIncomeCents: number;
  liquidExpensesCents: number;
  liquidTransferNetCents: number;
};

/** Monate von `from` bis `to` inklusive (ISO-YYYY-MM). */
export function monthsFromTo(from: IsoMonth, to: IsoMonth): IsoMonth[] {
  const out: IsoMonth[] = [];
  for (let m = from; m <= to; m = monthAdd(m, 1)) {
    out.push(m);
  }
  return out;
}

function collectEventsForIncomeAccounting(
  viewsByMonth: Map<IsoMonth, MonthView>,
  month: IsoMonth,
  fromMonth: IsoMonth,
  seedPrevMonthView?: MonthView | null,
): TimelineEvent[] {
  const view = viewsByMonth.get(month);
  const prevMonth = monthAdd(month, -1);
  const prevView =
    viewsByMonth.get(prevMonth) ?? (month === fromMonth ? seedPrevMonthView ?? null : null);
  const merged = [...(view?.events ?? []), ...(prevView?.events ?? [])];
  const seen = new Set<string>();
  const out: TimelineEvent[] = [];
  for (const ev of merged) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    out.push(ev);
  }
  return out;
}

/**
 * Einheitliche Saldo-Kette (alle Monate gleich, inkl. Prognosen):
 * Start(M) = prognostizierter Saldo zu Monatsbeginn (Ledger + Forecasts)
 * End(M) = Start(M) + Einnahmen(M) − Ausgaben(M)
 * Kontostand bleibt separat (nur Ist, ohne Prognosen).
 */
export function computeDashboardMonthChain(input: {
  viewsByMonth: Map<IsoMonth, MonthView>;
  fromMonth: IsoMonth;
  toMonth: IsoMonth;
  liquidAccountIds: Set<string>;
  seedPrevMonthView?: MonthView | null;
}): Map<IsoMonth, DashboardMonthBalance> {
  const { viewsByMonth, fromMonth, toMonth, liquidAccountIds, seedPrevMonthView } = input;
  const results = new Map<IsoMonth, DashboardMonthBalance>();

  let prevEnd: number | undefined = undefined;
  let prevLiquidEnd: number | undefined = undefined;

  for (const m of monthsFromTo(fromMonth, toMonth)) {
    const view = viewsByMonth.get(m);
    if (!view) continue;

    const window = monthWindowStart(m);
    const incomeEvents = collectEventsForIncomeAccounting(viewsByMonth, m, fromMonth, seedPrevMonthView);
    const income = sumIncomeFromEvents(incomeEvents, m);
    const expenses = sumExpensesFromEvents(view.events, window);
    const liquidIncome = sumIncomeFromEvents(incomeEvents, m, liquidAccountIds);
    const liquidExpenses = sumExpensesFromEvents(view.events, window, liquidAccountIds);
    const liquidTransferNet = sumLiquidTransferNet(view.events, window, liquidAccountIds);

    const startBalanceCents: number = prevEnd ?? view.startBalanceCents;
    const endBalanceCents: number = startBalanceCents + income - expenses;

    const startLiquidCents: number = prevLiquidEnd ?? view.startLiquidCents;
    const endLiquidCents = startLiquidCents + liquidIncome - liquidExpenses + liquidTransferNet;

    results.set(m, {
      month: m,
      startBalanceCents,
      endBalanceCents,
      startLiquidCents,
      endLiquidCents,
      incomeCents: income,
      expensesCents: expenses,
      liquidIncomeCents: liquidIncome,
      liquidExpensesCents: liquidExpenses,
      liquidTransferNetCents: liquidTransferNet,
    });

    prevEnd = endBalanceCents;
    prevLiquidEnd = endLiquidCents;
  }

  return results;
}

/** Einnahmen und Ausgaben desselben Monats. */
export function dashboardMonthComparison(input: {
  incomeCents: number;
  expensesCents: number;
  liquidExpensesCents?: number;
}) {
  return {
    incomeCents: input.incomeCents,
    expensesCents: input.expensesCents,
    netCents: input.incomeCents - input.expensesCents,
    liquidExpensesCents: input.liquidExpensesCents ?? input.expensesCents,
  };
}

export type DashboardEventFilter =
  | 'all'
  | 'fixed_cost'
  | 'variable_cost'
  | 'income'
  | 'expense'
  | 'buy';

export function mergeDashboardMonthEvents(view: MonthView, prevView?: MonthView | null): TimelineEvent[] {
  const merged = [...view.events, ...(prevView?.events ?? [])];
  const seen = new Set<string>();
  const out: TimelineEvent[] = [];
  for (const ev of merged) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    out.push(ev);
  }
  return out;
}

/** Ereignisliste für einen Monat inkl. Einnahmen vom letzten Banktag des Vormonats. */
export function dashboardEventsForMonth(view: MonthView, prevView?: MonthView | null): TimelineEvent[] {
  const month = view.month;
  const inMonth = view.events.filter((ev) => {
    if (isIncomeEvent(ev) && incomeAccountingMonth(ev.date) !== month) return false;
    return true;
  });
  const carriedIncome = (prevView?.events ?? []).filter(
    (ev) => isIncomeEvent(ev) && incomeAccountingMonth(ev.date) === month,
  );
  return mergeDashboardMonthEvents({ ...view, events: inMonth }, { ...view, events: carriedIncome });
}

export function filterDashboardEvents(
  events: TimelineEvent[],
  filter: DashboardEventFilter,
  viewingMonth?: IsoMonth,
): TimelineEvent[] {
  if (filter === 'all') return events;
  if (filter === 'fixed_cost') return events.filter((ev) => ev.type === 'fixed_cost');
  if (filter === 'variable_cost') return events.filter((ev) => ev.type === 'variable_cost');
  if (filter === 'buy') return events.filter((ev) => ev.type === 'buy_apply' || ev.type === 'buy_planned');
  if (filter === 'income') {
    return events.filter((ev) => {
      if (isBalanceOnlyEvent(ev)) return false;
      if (ev.amountCents <= 0) return false;
      if (!viewingMonth) return true;
      return incomeAccountingMonth(ev.date) === viewingMonth;
    });
  }
  if (filter === 'expense') {
    return events.filter((ev) => {
      if (isBalanceOnlyEvent(ev)) return false;
      if (ev.amountCents >= 0) return false;
      if (ev.type === 'variable_cost') return false;
      return true;
    });
  }
  return events;
}

/** Kontostand nur in Vergangenheit oder am heutigen Tag anzeigen (nicht für Zukunft). */
export function shouldShowKontostand(asOf: IsoDate): boolean {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return asOf <= (`${yyyy}-${mm}-${dd}` as IsoDate);
}

export function isPastOrCurrentMonth(month: IsoMonth): boolean {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  return month <= (`${yyyy}-${mm}` as IsoMonth);
}
