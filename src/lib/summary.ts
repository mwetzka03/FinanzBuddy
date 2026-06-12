import { isoToday, monthAdd, monthEndDate, monthStartDate } from './date';
import { incomeAccountingMonth } from './businessDays';
import type { IsoDate, IsoMonth, MonthView, TimelineEvent } from './types';

/** Fallback, wenn Dashboard-Einstellungen noch nicht geladen sind. */
export const DASHBOARD_MIN_MONTH_FALLBACK = '2020-01' as IsoMonth;

const PLANNED_EXPENSE_EVENT_TYPES = new Set(['fixed_cost', 'variable_cost', 'buy_planned', 'buy_apply']);

/** Wie Backend `aggregate_period_flows`: Adjustments/Depot und interne Transfers ohne Konto zählen nicht. */
function isBalanceOnlyEvent(
  ev: TimelineEvent,
  _savingsPot?: boolean,
  accountId?: string | null,
  isStockDepot?: boolean,
): boolean {
  if (ev.type === 'adjustment') return true;
  if (ev.type === 'stock_purchase') return isStockDepot === true;
  if (isInternalTransferEvent(ev) && !ev.accountId) return true;
  return false;
}

function isInternalTransferEvent(ev: TimelineEvent): boolean {
  return ev.internalTransfer === true || ev.type === 'transfer';
}

/** Gebuchte VK-Zuordnungen im laufenden Monat zählen nicht doppelt zur Prognose (wie Backend). */
function variableCostLedgerExcludedFromFlow(ev: TimelineEvent): boolean {
  if (ev.type !== 'expense' || ev.variableCostId == null) return false;
  const month = ev.date.slice(0, 7) as IsoMonth;
  return isoToday() <= monthEndDate(month);
}

/** Beitrag eines Ereignisses zu Einnahmen/Ausgaben-Summen (null = nicht in Flow). */
export function dashboardEventFlowContribution(
  ev: TimelineEvent,
  accountFilter?: string | null,
  isStockDepot?: boolean,
): number | null {
  if (isBalanceOnlyEvent(ev, false, accountFilter, isStockDepot)) return null;
  if (isInternalTransferEvent(ev) && !accountFilter) return null;
  if (variableCostLedgerExcludedFromFlow(ev)) return null;
  return ev.amountCents;
}

export function isDashboardFlowIncomeEvent(ev: TimelineEvent, accountFilter?: string | null): boolean {
  const contribution = dashboardEventFlowContribution(ev, accountFilter);
  return contribution !== null && contribution > 0;
}

export function isDashboardFlowExpenseEvent(ev: TimelineEvent, accountFilter?: string | null): boolean {
  const contribution = dashboardEventFlowContribution(ev, accountFilter);
  return contribution !== null && contribution < 0;
}

function subtotalStep(filter: DashboardEventFilter, contribution: number): number {
  if (filter === 'income') return contribution > 0 ? contribution : 0;
  if (filter === 'expense' || filter === 'fixed_cost' || filter === 'variable_cost' || filter === 'buy') {
    return Math.abs(contribution);
  }
  return contribution;
}

export function sortDashboardEventsChronologically(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export type DashboardEventRow = {
  event: TimelineEvent;
  runningSubtotalCents: number;
};

export function dashboardEventSubtotalContribution(
  ev: TimelineEvent,
  filter: DashboardEventFilter,
  accountFilter?: string | null,
  isStockDepot?: boolean,
): number | null {
  const contribution = dashboardEventFlowContribution(ev, accountFilter, isStockDepot);
  if (contribution === null) return null;
  if (filter === 'fixed_cost' && ev.type === 'expense' && ev.fixedCostId != null) return null;
  if (filter === 'variable_cost' && ev.type === 'expense' && ev.variableCostId != null) return null;
  return contribution;
}

export function dashboardEventsWithRunningSubtotals(
  events: TimelineEvent[],
  filter: DashboardEventFilter,
  accountFilter?: string | null,
  isStockDepot?: boolean,
): DashboardEventRow[] {
  const sorted = sortDashboardEventsChronologically(events);
  let running = 0;
  return sorted.map((event) => {
    const contribution = dashboardEventSubtotalContribution(event, filter, accountFilter, isStockDepot);
    if (contribution !== null) {
      running += subtotalStep(filter, contribution);
    }
    return { event, runningSubtotalCents: running };
  });
}

function isExpenseEvent(ev: TimelineEvent, savingsPot?: boolean, accountId?: string | null): boolean {
  return !isBalanceOnlyEvent(ev, savingsPot, accountId) && ev.amountCents < 0;
}

function isIncomeEvent(ev: TimelineEvent, savingsPot?: boolean, accountId?: string | null): boolean {
  return !isBalanceOnlyEvent(ev, savingsPot, accountId) && ev.amountCents > 0;
}

function matchesLiquidFilter(ev: TimelineEvent, liquidAccountIds?: Set<string>): boolean {
  if (!liquidAccountIds) return true;
  if (!ev.accountId) return false;
  return liquidAccountIds.has(ev.accountId);
}

export function monthWindowStart(month: IsoMonth, view?: MonthView): IsoDate {
  if (view?.periodMode === 'since_last_salary' && view.periodStart) {
    return view.periodStart;
  }
  return monthStartDate(month);
}

export function monthWindowEnd(view?: MonthView, month?: IsoMonth): IsoDate {
  if (view?.periodMode === 'since_last_salary' && view.periodEnd) {
    return view.periodEnd;
  }
  return month ? monthEndDate(month) : view?.periodEnd ?? monthStartDate('2026-01' as IsoMonth);
}

/** Einnahmen des Buchungsmonats (letzter Banktag → Folgemonat). */
export function sumIncomeFromEvents(
  events: TimelineEvent[],
  accountingMonth: IsoMonth,
  liquidAccountIds?: Set<string>,
  view?: MonthView,
  savingsPot?: boolean,
  accountId?: string | null,
): number {
  let total = 0;
  for (const ev of events) {
    if (!isIncomeEvent(ev, savingsPot, accountId)) continue;
    if (view?.periodMode === 'since_last_salary') {
      if (ev.date < view.periodStart || ev.date > view.periodEnd) continue;
    } else if (incomeAccountingMonth(ev.date) !== accountingMonth) {
      continue;
    }
    if (!matchesLiquidFilter(ev, liquidAccountIds)) continue;
    total += ev.amountCents;
  }
  return total;
}

/** Ist-Ausgaben aus dem Ledger (ohne Prognose-/Buy-Ereignisse). */
export function sumActualLedgerExpensesFromEvents(
  events: TimelineEvent[],
  windowStart: IsoDate,
  liquidAccountIds?: Set<string>,
  windowEnd?: IsoDate,
  savingsPot?: boolean,
  accountId?: string | null,
): number {
  let total = 0;
  for (const ev of events) {
    if (PLANNED_EXPENSE_EVENT_TYPES.has(ev.type)) continue;
    if (!isExpenseEvent(ev, savingsPot, accountId)) continue;
    if (ev.date < windowStart) continue;
    if (windowEnd && ev.date > windowEnd) continue;
    if (!matchesLiquidFilter(ev, liquidAccountIds)) continue;
    total += Math.abs(ev.amountCents);
  }
  return total;
}

/** Ausgabenbetrag immer als positiver Betrag (Ausgabenmenge). */
export function expenseMagnitudeCents(cents: number): number {
  return Math.abs(cents);
}

/** Verbleibende Fix-/Variable Kosten + Buys laut Monatsansicht. */
export function dashboardPlannedExpensesCents(
  view: MonthView,
  accountId?: string | null,
  mainAccountId?: string | null,
): number {
  if (accountId && mainAccountId && accountId !== mainAccountId) {
    return expenseMagnitudeCents(view.appliedBuysCents ?? 0);
  }
  return (
    expenseMagnitudeCents(view.remainingFixedCostsCents ?? 0) +
    expenseMagnitudeCents(view.remainingVariableCostsCents ?? 0) +
    expenseMagnitudeCents(view.appliedBuysCents ?? 0)
  );
}

/** Ausgaben = Ist + verbleibende Fix/Variable + Buys. */
export function dashboardTotalExpensesCents(
  view: MonthView,
  events: TimelineEvent[],
  windowStart: IsoDate,
  liquidAccountIds?: Set<string>,
  accountId?: string | null,
  mainAccountId?: string | null,
): number {
  const actual = sumActualLedgerExpensesFromEvents(events, windowStart, liquidAccountIds);
  if (liquidAccountIds) {
    return actual;
  }
  return actual + dashboardPlannedExpensesCents(view, accountId, mainAccountId);
}

/** @deprecated use dashboardTotalExpensesCents */
export function sumExpensesFromEvents(
  events: TimelineEvent[],
  windowStart: IsoDate,
  liquidAccountIds?: Set<string>,
): number {
  return sumActualLedgerExpensesFromEvents(events, windowStart, liquidAccountIds);
}

export function sumLiquidTransferNet(
  events: TimelineEvent[],
  windowStart: IsoDate,
  liquidAccountIds: Set<string>,
  windowEnd?: IsoDate,
): number {
  let net = 0;
  for (const ev of events) {
    if (ev.type !== 'transfer') continue;
    if (ev.date < windowStart) continue;
    if (windowEnd && ev.date > windowEnd) continue;
    if (!ev.accountId || !liquidAccountIds.has(ev.accountId)) continue;
    net += ev.amountCents;
  }
  return net;
}

export function sumAccountTransferNet(
  events: TimelineEvent[],
  windowStart: IsoDate,
  accountId: string,
  windowEnd?: IsoDate,
): number {
  let net = 0;
  for (const ev of events) {
    if (ev.type !== 'transfer') continue;
    if (ev.date < windowStart) continue;
    if (windowEnd && ev.date > windowEnd) continue;
    if (ev.accountId !== accountId) continue;
    net += ev.amountCents;
  }
  return net;
}

function resolveStartBalanceCents(
  prevEnd: number | undefined,
  firstMonthStartCents: number,
  accountId: string | null | undefined,
  savingsPot?: boolean,
): number {
  if (prevEnd === undefined) {
    return firstMonthStartCents;
  }
  if (savingsPot) return prevEnd;
  if (accountId && prevEnd === 0 && firstMonthStartCents !== 0) {
    return firstMonthStartCents;
  }
  return prevEnd;
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
  actualExpensesCents: number;
  plannedExpensesCents: number;
  liquidIncomeCents: number;
  liquidExpensesCents: number;
  liquidTransferNetCents: number;
};

export function monthsFromTo(from: IsoMonth, to: IsoMonth): IsoMonth[] {
  const out: IsoMonth[] = [];
  for (let m = from; m <= to; m = monthAdd(m, 1)) {
    out.push(m);
  }
  return out;
}

function eventInDashboardWindow(ev: TimelineEvent, view: MonthView): boolean {
  if (view.periodMode === 'since_last_salary') {
    return ev.date >= view.periodStart && ev.date <= view.periodEnd;
  }
  return true;
}

function collectEventsForIncomeAccounting(
  viewsByMonth: Map<IsoMonth, MonthView>,
  month: IsoMonth,
  fromMonth: IsoMonth,
  seedPrevMonthView?: MonthView | null,
): TimelineEvent[] {
  const view = viewsByMonth.get(month);
  if (!view) return [];

  if (view.periodMode === 'since_last_salary') {
    return view.events.filter((ev) => eventInDashboardWindow(ev, view));
  }

  const prevMonth = monthAdd(month, -1);
  const prevView =
    viewsByMonth.get(prevMonth) ?? (month === fromMonth ? seedPrevMonthView ?? null : null);
  const inMonth = view.events.filter((ev) => {
    if (isIncomeEvent(ev) && incomeAccountingMonth(ev.date) !== month) return false;
    return true;
  });
  const carriedIncome = (prevView?.events ?? []).filter(
    (ev) => isIncomeEvent(ev) && incomeAccountingMonth(ev.date) === month,
  );
  const merged = [...inMonth, ...carriedIncome];
  const seen = new Set<string>();
  const out: TimelineEvent[] = [];
  for (const ev of merged) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    out.push(ev);
  }
  return out;
}

function computeSingleMonthBalance(input: {
  view: MonthView;
  prevEnd: number | undefined;
  prevLiquidEnd: number | undefined;
  incomeEvents: TimelineEvent[];
  liquidAccountIds: Set<string>;
  accountId?: string | null;
  mainAccountId?: string | null;
  savingsPot?: boolean;
}): DashboardMonthBalance {
  const { view, prevEnd, prevLiquidEnd, incomeEvents, liquidAccountIds, accountId, mainAccountId, savingsPot } =
    input;
  const m = view.month;
  const windowStart = monthWindowStart(m, view);
  const windowEnd = monthWindowEnd(view, m);
  const skipTransferNet = Boolean(savingsPot);
  const plannedExpenses = savingsPot ? 0 : dashboardPlannedExpensesCents(view, accountId, mainAccountId);

  if (view.periodMode === 'since_last_salary') {
    const income = sumIncomeFromEvents(incomeEvents, m, undefined, view, savingsPot, accountId);
    const actualExpenses = sumActualLedgerExpensesFromEvents(
      view.events,
      windowStart,
      undefined,
      windowEnd,
      savingsPot,
      accountId,
    );
    const expenses = expenseMagnitudeCents(actualExpenses + plannedExpenses);
    const startBalanceCents =
      prevEnd !== undefined ? prevEnd : (view.startBalanceCents ?? 0);
    const startLiquidCents =
      prevLiquidEnd !== undefined
        ? prevLiquidEnd
        : (view.startLiquidCents ?? startBalanceCents);
    const endBalanceCents = startBalanceCents + income - expenses;
    const endLiquidCents = startLiquidCents + income - actualExpenses;
    return {
      month: m,
      startBalanceCents,
      endBalanceCents,
      startLiquidCents,
      endLiquidCents,
      incomeCents: income,
      expensesCents: expenses,
      actualExpensesCents: actualExpenses,
      plannedExpensesCents: plannedExpenses,
      liquidIncomeCents: income,
      liquidExpensesCents: actualExpenses,
      liquidTransferNetCents: 0,
    };
  }

  const income = sumIncomeFromEvents(incomeEvents, m, undefined, view, savingsPot, accountId);
  const actualExpenses = sumActualLedgerExpensesFromEvents(
    view.events,
    windowStart,
    undefined,
    windowEnd,
    savingsPot,
    accountId,
  );
  const expenses = expenseMagnitudeCents(actualExpenses + plannedExpenses);

  const liquidIncome = sumIncomeFromEvents(incomeEvents, m, liquidAccountIds, undefined, savingsPot);
  const liquidActual = expenseMagnitudeCents(
    sumActualLedgerExpensesFromEvents(view.events, windowStart, liquidAccountIds, windowEnd, savingsPot),
  );
  const liquidTransferNet = skipTransferNet
    ? 0
    : sumLiquidTransferNet(view.events, windowStart, liquidAccountIds, windowEnd);

  const firstMonthStartCents =
    view.kontostandStartSaldoCents ?? view.kontostandStartCents ?? view.startBalanceCents ?? 0;

  const startBalanceCents = resolveStartBalanceCents(prevEnd, firstMonthStartCents, accountId, savingsPot);
  const endBalanceCents = startBalanceCents + income - expenses;

  const firstLiquidStartCents = view.startLiquidCents ?? firstMonthStartCents;
  const startLiquidCents = resolveStartBalanceCents(prevLiquidEnd, firstLiquidStartCents, accountId, savingsPot);
  const endLiquidCents = startLiquidCents + liquidIncome - liquidActual + liquidTransferNet;

  return {
    month: m,
    startBalanceCents,
    endBalanceCents,
    startLiquidCents,
    endLiquidCents,
    incomeCents: income,
    expensesCents: expenses,
    actualExpensesCents: actualExpenses,
    plannedExpensesCents: plannedExpenses,
    liquidIncomeCents: liquidIncome,
    liquidExpensesCents: liquidActual,
    liquidTransferNetCents: accountId ? 0 : liquidTransferNet,
  };
}

/**
 * Saldo-Kette:
 * Start(M) = End(M−1) — Einnahmen am letzten Banktag des Vormonats zählen in M, nicht in Start(M).
 * Einnahmen(M) = alle Einnahmen mit Buchungsmonat M.
 * Ausgaben(M) = Ist-Ausgaben + verbleibende Fix/Variable + Buys.
 * End(M) = Start(M) + Einnahmen(M) − Ausgaben(M).
 */
export function computeDashboardMonthChain(input: {
  viewsByMonth: Map<IsoMonth, MonthView>;
  fromMonth: IsoMonth;
  toMonth: IsoMonth;
  liquidAccountIds: Set<string>;
  seedPrevMonthView?: MonthView | null;
  accountId?: string | null;
  mainAccountId?: string | null;
  savingsPot?: boolean;
}): Map<IsoMonth, DashboardMonthBalance> {
  const {
    viewsByMonth,
    fromMonth,
    toMonth,
    liquidAccountIds,
    seedPrevMonthView,
    accountId,
    mainAccountId,
    savingsPot,
  } = input;
  const results = new Map<IsoMonth, DashboardMonthBalance>();

  const chainFrom =
    seedPrevMonthView && seedPrevMonthView.month === monthAdd(fromMonth, -1)
      ? seedPrevMonthView.month
      : fromMonth;

  if (seedPrevMonthView && seedPrevMonthView.month === chainFrom && !viewsByMonth.has(chainFrom)) {
    viewsByMonth.set(chainFrom, seedPrevMonthView);
  }

  let prevEnd: number | undefined = undefined;
  let prevLiquidEnd: number | undefined = undefined;

  for (const m of monthsFromTo(chainFrom, toMonth)) {
    const view = viewsByMonth.get(m);
    if (!view) continue;

    const incomeEvents = collectEventsForIncomeAccounting(viewsByMonth, m, chainFrom, seedPrevMonthView);
    const row = computeSingleMonthBalance({
      view,
      prevEnd,
      prevLiquidEnd,
      incomeEvents,
      liquidAccountIds,
      accountId,
      mainAccountId,
      savingsPot,
    });

    if (m >= fromMonth) {
      results.set(m, row);
    }

    prevEnd = row.endBalanceCents;
    prevLiquidEnd = row.endLiquidCents;
  }

  return results;
}

export function dashboardMonthComparison(input: {
  incomeCents: number;
  expensesCents: number;
  liquidExpensesCents?: number;
  startBalanceCents?: number;
  endBalanceCents?: number;
}) {
  const expenses = expenseMagnitudeCents(input.expensesCents);
  const netCents = input.incomeCents - expenses;
  return {
    incomeCents: input.incomeCents,
    expensesCents: expenses,
    netCents,
    liquidExpensesCents: input.liquidExpensesCents ?? expenses,
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

function dedupeDashboardIncomeEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.filter((ev) => {
    if (!(ev.id.startsWith('income:') || ev.id.startsWith('income_actual:'))) {
      return true;
    }
    const account = ev.accountId ?? '';
    return !events.some(
      (ledger) =>
        ledger.id.startsWith('ledger:income:') &&
        ledger.date === ev.date &&
        ledger.amountCents === ev.amountCents &&
        (ledger.accountId ?? '') === account,
    );
  });
}

export function dashboardEventsForMonth(view: MonthView, prevView?: MonthView | null): TimelineEvent[] {
  if (view.periodMode === 'since_last_salary') {
    return dedupeDashboardIncomeEvents(view.events.filter((ev) => eventInDashboardWindow(ev, view)));
  }
  const month = view.month;
  const inMonth = view.events.filter((ev) => {
    if (isIncomeEvent(ev) && incomeAccountingMonth(ev.date) !== month) return false;
    return true;
  });
  const carriedIncome = (prevView?.events ?? []).filter(
    (ev) => isIncomeEvent(ev) && incomeAccountingMonth(ev.date) === month,
  );
  return dedupeDashboardIncomeEvents(
    mergeDashboardMonthEvents({ ...view, events: inMonth }, { ...view, events: carriedIncome }),
  );
}

export function filterDashboardEvents(
  events: TimelineEvent[],
  filter: DashboardEventFilter,
  viewingMonth?: IsoMonth,
  savingsPot?: boolean,
  accountFilter?: string | null,
): TimelineEvent[] {
  if (filter === 'all') return events;
  if (filter === 'fixed_cost') {
    return events.filter((ev) => ev.type === 'fixed_cost' || (ev.type === 'expense' && ev.fixedCostId != null));
  }
  if (filter === 'variable_cost') {
    return events.filter(
      (ev) => ev.type === 'variable_cost' || (ev.type === 'expense' && ev.variableCostId != null),
    );
  }
  if (filter === 'buy') {
    return events.filter(
      (ev) =>
        ev.type === 'buy_apply' ||
        ev.type === 'buy_planned' ||
        (ev.type === 'expense' && ev.buyItemId) ||
        (ev.type === 'expense' && ev.buyItemGroupId),
    );
  }
  if (filter === 'income') {
    return events.filter((ev) => isDashboardFlowIncomeEvent(ev, accountFilter));
  }
  if (filter === 'expense') {
    return events.filter((ev) => isDashboardFlowExpenseEvent(ev, accountFilter));
  }
  return events;
}

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

export function isCurrentDashboardPeriod(view: Pick<MonthView, 'periodIsCurrent'>): boolean {
  return view.periodIsCurrent;
}

export function isPastDashboardPeriod(view: Pick<MonthView, 'periodEnd'>): boolean {
  return isoToday() > view.periodEnd;
}

export function isFutureDashboardPeriod(view: Pick<MonthView, 'periodStart'>): boolean {
  return isoToday() < view.periodStart;
}
