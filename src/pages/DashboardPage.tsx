import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Account, AccountKontostandRow, DashboardPeriodNavItem, DayView, DebtSummary, IsoDate, IsoMonth, MonthView, TimelineEvent } from '../lib/types';

import { AmountTable } from '../components/data/AmountTable';
import { useTablePagination, TablePaginationBar } from '../components/data/tablePagination';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';

import { ThAmount, TdAmount } from '../components/data/AmountCells';

import {

  formatDisplayDate,

  formatDisplayMonthLong,

  dashboardPeriodLabel,
  isoToday,
  isoToMonth,
  monthAdd,
  toIsoMonth,
} from '../lib/date';
import { formatBalanceEurFromCents, formatEurFromCents, formatExpenseEurFromCents, formatIncomeEurFromCents, formatSignedEurFromCents } from '../lib/money';
import {
  dashboardEventsForMonth,
  DASHBOARD_MIN_MONTH_FALLBACK,
  dashboardEventsWithRunningSubtotals,
  filterDashboardEvents,
  isCurrentDashboardPeriod,
  isFutureDashboardPeriod,
  isPastDashboardPeriod,
  type DashboardEventFilter,
  shouldShowKontostand,
  sumDayExpenses,
  sumDayIncome,
} from '../lib/summary';

import { getDayView, getDebtSummary, getDashboardSettings, getMonthView, listAccounts, listDashboardPeriods, refreshDashboardCache } from '../tauri/api';
import { buildDashboardAccountTreeRows, isSavingsPotAccount } from '../lib/accounts';

import { stockAccentColor } from '../lib/tableAccent';
import { useUi } from '../lib/ui';

import { useLocale } from '../i18n/LocaleProvider';

import { PageShell } from '../components/layout/PageShell';

import { DateInput } from '../components/DateInput';

import { DashboardAccountSelect } from '../components/dashboard/DashboardAccountSelect';

import { DashboardCard, formatDelta } from '../components/dashboard/DashboardCard';

function expensesCentsFromView(m: MonthView): number {
  return m.expenseCents;
}

function prevPeriodDelta(current: number, previous: number | undefined): number | null {
  if (previous == null) return null;
  return current - previous;
}

function formatRunningSubtotal(filter: DashboardEventFilter, cents: number): string {
  if (filter === 'income') return formatIncomeEurFromCents(cents);
  if (filter === 'expense' || filter === 'fixed_cost' || filter === 'variable_cost' || filter === 'buy') {
    return formatExpenseEurFromCents(cents);
  }
  return formatSignedEurFromCents(cents);
}

/** Farblogik für Zwischensumme: grün bei Plus, rot bei Minus. */
function runningSubtotalColorCents(filter: DashboardEventFilter, cents: number): number {
  if (filter === 'expense' || filter === 'fixed_cost' || filter === 'variable_cost' || filter === 'buy') {
    return -Math.abs(cents);
  }
  if (filter === 'income') {
    return Math.abs(cents);
  }
  return cents;
}

function costIdFromEventId(prefix: 'fixed_cost' | 'variable_cost', id: string): string | null {
  if (!id.startsWith(`${prefix}:`)) return null;
  return id.split(':')[1] ?? null;
}

function EventTitleCell({ ev, onGroupClick }: { ev: TimelineEvent; onGroupClick?: (groupId: string) => void }) {
  const ui = useUi();
  const navigate = useNavigate();
  const rawSubtitle = ev.notes?.trim();
  const subtitle = rawSubtitle?.startsWith('buy_group:') ? undefined : rawSubtitle;
  const fixedCostId = ev.fixedCostId ?? costIdFromEventId('fixed_cost', ev.id);
  const variableCostId = ev.variableCostId ?? costIdFromEventId('variable_cost', ev.id);

  if (ev.buyItemGroupId && onGroupClick) {
    return (
      <div style={ui.cellStack}>
        <button
          type="button"
          className="fh-link-button"
          style={ui.nameLink}
          onClick={() => onGroupClick(ev.buyItemGroupId!)}
        >
          {ev.title}
        </button>
        {subtitle ? <div style={ui.cellSub}>{subtitle}</div> : null}
      </div>
    );
  }
  if (fixedCostId) {
    return (
      <div style={ui.cellStack}>
        <button
          type="button"
          className="fh-link-button"
          style={ui.nameLink}
          onClick={() => navigate('/fixkosten', { state: { editId: fixedCostId } })}
        >
          {ev.title}
        </button>
        {subtitle ? <div style={ui.cellSub}>{subtitle}</div> : null}
      </div>
    );
  }
  if (variableCostId) {
    return (
      <div style={ui.cellStack}>
        <button
          type="button"
          className="fh-link-button"
          style={ui.nameLink}
          onClick={() => navigate(`/variable-kosten/${variableCostId}`)}
        >
          {ev.title}
        </button>
        {subtitle ? <div style={ui.cellSub}>{subtitle}</div> : null}
      </div>
    );
  }
  if (ev.buyItemId) {
    return (
      <div style={ui.cellStack}>
        <button
          type="button"
          className="fh-link-button"
          style={ui.nameLink}
          onClick={() => navigate('/buy-liste')}
        >
          {ev.title}
        </button>
        {subtitle ? <div style={ui.cellSub}>{subtitle}</div> : null}
      </div>
    );
  }
  if (subtitle) {
    return (
      <div style={ui.cellStack}>
        <div>{ev.title}</div>
        <div style={ui.cellSub}>{subtitle}</div>
      </div>
    );
  }
  return <div>{ev.title}</div>;
}

function AccountBalanceBreakdownTable({
  rows,
  accounts,
  amountLabel,
}: {
  rows: AccountKontostandRow[];
  accounts: Account[];
  amountLabel: string;
}) {
  const ui = useUi();
  const { t } = useLocale();
  type RowSortKey = 'account' | 'balance' | 'subtotal';
  const [sort, setSort] = useState<SortState<RowSortKey>>(null);

  const sortedRows = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.accountId, r]));
    const ordered: AccountKontostandRow[] = [];
    for (const { account } of buildDashboardAccountTreeRows(accounts)) {
      const row = byId.get(account.id);
      if (row) ordered.push(row);
    }
    for (const row of rows) {
      if (!ordered.some((r) => r.accountId === row.accountId)) ordered.push(row);
    }
    let running = 0;
    return ordered.map((row) => {
      running += row.balanceCents;
      return { row, runningSubtotalCents: running };
    });
  }, [rows, accounts]);

  const displayRows = useMemo(
    () =>
      sortByState(sortedRows, sort, {
        account: (r) => r.row.accountName,
        balance: (r) => r.row.balanceCents,
        subtotal: (r) => r.runningSubtotalCents,
      }),
    [sortedRows, sort],
  );
  const pagination = useTablePagination(displayRows);
  const tableCols = '1fr 160px 160px';

  return (
    <AmountTable>
      <div style={{ ...ui.tableHead, gridTemplateColumns: tableCols }} className="fh-table-head">
        <SortableTh label={t('dashboard.accountLabel')} sortKey="account" sort={sort} onSort={setSort} style={ui.thName} />
        <SortableTh label={amountLabel} sortKey="balance" sort={sort} onSort={setSort} style={ui.thAmount} align="center" />
        <SortableTh
          label={t('dashboard.runningSubtotal')}
          sortKey="subtotal"
          sort={sort}
          onSort={setSort}
          style={ui.thAmount}
          align="center"
        />
      </div>
      <TablePaginationBar
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        pageSize={pagination.pageSize}
        onPageChange={pagination.setPage}
      />
      {displayRows.length === 0 ? (
        <div style={ui.emptyRow} className="fh-empty-row">{t('dashboard.noEvents')}</div>
      ) : (
        pagination.pageItems.map(({ row, runningSubtotalCents }) => (
          <div
            key={row.accountId}
            className="fh-table-row"
            style={{ ...ui.tableRow, gridTemplateColumns: tableCols }}
          >
            <div style={ui.tdName}>{row.accountName}</div>
            <TdAmount col="balance" amountCents={row.balanceCents}>
              {formatBalanceEurFromCents(row.balanceCents)}
            </TdAmount>
            <TdAmount col="subtotal" amountCents={runningSubtotalCents}>
              {formatBalanceEurFromCents(runningSubtotalCents)}
            </TdAmount>
          </div>
        ))
      )}
    </AmountTable>
  );
}

function EventsTable({
  events,
  filter = 'all',
  accountFilter = null,
  isStockDepot = false,
  onGroupClick,
}: {
  events: MonthView['events'];
  filter?: DashboardEventFilter;
  accountFilter?: string | null;
  isStockDepot?: boolean;
  onGroupClick?: (groupId: string) => void;
}) {
  const ui = useUi();
  const { t } = useLocale();
  type EventSortKey = 'date' | 'account' | 'title' | 'amount' | 'subtotal';
  const [sort, setSort] = useState<SortState<EventSortKey>>(null);
  const rows = useMemo(
    () => dashboardEventsWithRunningSubtotals(events, filter, accountFilter, isStockDepot),
    [events, filter, accountFilter, isStockDepot],
  );
  const sortedRows = useMemo(
    () =>
      sortByState(rows, sort, {
        date: (r) => r.event.date,
        account: (r) => r.event.accountName ?? '',
        title: (r) => r.event.title,
        amount: (r) => r.event.amountCents,
        subtotal: (r) => r.runningSubtotalCents,
      }),
    [rows, sort],
  );
  const pagination = useTablePagination(sortedRows);
  const tableCols = '110px 140px 1fr 120px 120px';

  return (
    <AmountTable>
      <div style={{ ...ui.tableHead, gridTemplateColumns: tableCols }} className="fh-table-head">
        <SortableTh label={t('common.date')} sortKey="date" sort={sort} onSort={setSort} style={ui.thName} />
        <SortableTh label={t('dashboard.accountLabel')} sortKey="account" sort={sort} onSort={setSort} style={ui.thName} />
        <SortableTh label={t('transactions.titleField')} sortKey="title" sort={sort} onSort={setSort} style={ui.thName} />
        <SortableTh label={t('common.amount')} sortKey="amount" sort={sort} onSort={setSort} style={ui.thAmount} align="center" />
        <SortableTh
          label={t('dashboard.runningSubtotal')}
          sortKey="subtotal"
          sort={sort}
          onSort={setSort}
          style={ui.thAmount}
          align="center"
        />
      </div>

      <TablePaginationBar
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        pageSize={pagination.pageSize}
        onPageChange={pagination.setPage}
      />

      {sortedRows.length === 0 ? (
        <div style={ui.emptyRow} className="fh-empty-row">{t('dashboard.noEvents')}</div>
      ) : (
        pagination.pageItems.map(({ event: ev, runningSubtotalCents }) => {
          const accent = stockAccentColor(ev);
          return (
          <div
            key={ev.id}
            className="fh-table-row"
            style={{
              ...ui.tableRow,
              ...(accent ? ui.tableRowAccent(accent) : {}),
              gridTemplateColumns: tableCols,
            }}
          >
            <div style={{ ...ui.tdMono, textAlign: 'left' }}>{formatDisplayDate(ev.date)}</div>
            <div style={{ ...ui.tdName, color: ui.colors.textMuted, fontSize: 13 }}>{ev.accountName ?? '—'}</div>
            <div style={ui.tdName}>
              <EventTitleCell ev={ev} onGroupClick={onGroupClick} />
            </div>
            <TdAmount col="amount" amountCents={ev.amountCents} neutral={ev.type === 'transfer'}>
              {ev.type === 'transfer'
                ? formatEurFromCents(Math.abs(ev.amountCents))
                : formatSignedEurFromCents(ev.amountCents)}
            </TdAmount>
            <TdAmount col="subtotal" amountCents={runningSubtotalColorCents(filter, runningSubtotalCents)}>
              {formatRunningSubtotal(filter, runningSubtotalCents)}
            </TdAmount>
          </div>
          );
        })
      )}
    </AmountTable>
  );
}



export function DashboardPage() {

  const ui = useUi();
  const navigate = useNavigate();

  const { t, locale } = useLocale();

  const openBuyGroup = (groupId: string) => {
    navigate('/buy-liste', { state: { groupId } });
  };

  const [mode, setMode] = useState<'day' | 'month'>('month');

  const [day, setDay] = useState<IsoDate>(() => isoToday());

  const [month, setMonth] = useState<IsoMonth>(() => toIsoMonth(new Date()));

  const [accounts, setAccounts] = useState<Account[]>([]);

  const [accountFilter, setAccountFilter] = useState<string>('');

  const [data, setData] = useState<MonthView | null>(null);
  const [prevMonthView, setPrevMonthView] = useState<MonthView | null>(null);

  const [dayData, setDayData] = useState<DayView | null>(null);

  const [comparison, setComparison] = useState<{

    incomeCents: number;

    expensesCents: number;

    netCents: number;

    liquidExpensesCents: number;

    incomeMonth: IsoMonth;
    expenseMonth: IsoMonth;
    startBalanceCents: number;
    endBalanceCents: number;
    startLiquidCents: number;
    endLiquidCents: number;
    kontostandCents: number;
    prevKontostandCents: number;
  } | null>(null);

  const [eventFilter, setEventFilter] = useState<DashboardEventFilter>('all');
  const [tableMode, setTableMode] = useState<'events' | 'kontostand' | 'startBalance' | 'endBalance'>('events');

  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const [debtSummary, setDebtSummary] = useState<DebtSummary | null>(null);

  const loadGenRef = useRef(0);



  const [minMonth, setMinMonth] = useState<IsoMonth>(DASHBOARD_MIN_MONTH_FALLBACK);
  const [periodMode, setPeriodMode] = useState<'calendar_month' | 'since_last_salary'>('calendar_month');
  const [salaryPeriods, setSalaryPeriods] = useState<DashboardPeriodNavItem[]>([]);
  const [periodStart, setPeriodStart] = useState<IsoDate | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {

    listAccounts().then(setAccounts).catch(() => undefined);

    getDebtSummary().then(setDebtSummary).catch(() => undefined);

    getDashboardSettings()
      .then(async (settings) => {
        if (settings.minMonth) setMinMonth(settings.minMonth);
        setPeriodMode(settings.periodMode);
        if (settings.periodMode === 'since_last_salary') {
          try {
            const periods = await listDashboardPeriods();
            setSalaryPeriods(periods);
          } catch {
            /* ignore */
          }
          if (settings.currentPeriodStart) {
            setPeriodStart(settings.currentPeriodStart);
            setMonth(isoToMonth(settings.currentPeriodStart));
          }
        }
      })
      .catch(() => undefined);

  }, []);



  const accountId = accountFilter || null;
  const useSalaryPeriodNav = periodMode === 'since_last_salary' && salaryPeriods.length > 0;
  const periodIndex = useMemo(
    () => (periodStart ? salaryPeriods.findIndex((p) => p.periodStart === periodStart) : -1),
    [salaryPeriods, periodStart],
  );

  const selectedAccount = useMemo(

    () => (accountFilter ? accounts.find((a) => a.id === accountFilter) : null),

    [accountFilter, accounts],

  );

  const isSavingsPotView = selectedAccount ? isSavingsPotAccount(selectedAccount) : false;
  const showLiquidCards = !accountFilter;
  const showForecastExpenseCards = !isSavingsPotView;

  const isStockDepot = selectedAccount?.balanceSource === 'stock_portfolio';

  useEffect(() => {
    setTableMode('events');
  }, [accountFilter]);

  const canGoPrevMonth = useSalaryPeriodNav ? periodIndex > 0 : month > minMonth;
  const canGoNextMonth = useSalaryPeriodNav
    ? periodIndex >= 0 && periodIndex < salaryPeriods.length - 1
    : true;

  function goPrevPeriod() {
    if (useSalaryPeriodNav && periodIndex > 0) {
      const prev = salaryPeriods[periodIndex - 1];
      setPeriodStart(prev.periodStart);
      setMonth(isoToMonth(prev.periodStart));
      return;
    }
    setMonth((m) => monthAdd(m, -1));
  }

  function goNextPeriod() {
    if (useSalaryPeriodNav && periodIndex >= 0 && periodIndex < salaryPeriods.length - 1) {
      const next = salaryPeriods[periodIndex + 1];
      setPeriodStart(next.periodStart);
      setMonth(isoToMonth(next.periodStart));
      return;
    }
    setMonth((m) => monthAdd(m, 1));
  }

  const isOnCurrentPeriod = useMemo(() => {
    if (mode === 'day') return day === isoToday();
    if (useSalaryPeriodNav) {
      const current = salaryPeriods.find((p) => p.isCurrent);
      return current ? periodStart === current.periodStart : false;
    }
    return month === toIsoMonth(new Date());
  }, [mode, day, useSalaryPeriodNav, salaryPeriods, periodStart, month]);

  function goToCurrentPeriod() {
    if (mode === 'day') {
      setDay(isoToday());
      return;
    }
    if (useSalaryPeriodNav) {
      const current = salaryPeriods.find((p) => p.isCurrent);
      if (current) {
        setPeriodStart(current.periodStart);
        setMonth(isoToMonth(current.periodStart));
      }
      return;
    }
    setMonth(toIsoMonth(new Date()));
  }

  async function handleRefreshCalculations() {
    setRefreshing(true);
    setError(null);
    try {
      await refreshDashboardCache();
      const selectedMonth = useSalaryPeriodNav && periodStart ? isoToMonth(periodStart) : month;
      const prevPeriodStart =
        useSalaryPeriodNav && periodIndex > 0 ? salaryPeriods[periodIndex - 1].periodStart : null;
      const prevMonth = monthAdd(selectedMonth, -1);
      const [monthData, prevMonthData] = await Promise.all([
        getMonthView(selectedMonth, accountId, useSalaryPeriodNav ? periodStart : null),
        prevPeriodStart
          ? getMonthView(isoToMonth(prevPeriodStart), accountId, prevPeriodStart).catch(() => null)
          : !useSalaryPeriodNav && prevMonth >= minMonth
            ? getMonthView(prevMonth, accountId).catch(() => null)
            : Promise.resolve(null),
      ]);
      setData(monthData);
      setPrevMonthView(prevMonthData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {

    let alive = true;

    const reqId = ++loadGenRef.current;

    setError(null);

    setLoading(true);

    setEventFilter('all');



    if (mode === 'month') {

      setDayData(null);

      setData(null);
      setPrevMonthView(null);

      setComparison(null);



      const selectedMonth = useSalaryPeriodNav && periodStart ? isoToMonth(periodStart) : month;
      const prevPeriodStart =
        useSalaryPeriodNav && periodIndex > 0 ? salaryPeriods[periodIndex - 1].periodStart : null;
      const prevMonth = monthAdd(selectedMonth, -1);

      Promise.all([
        getMonthView(selectedMonth, accountId, useSalaryPeriodNav ? periodStart : null),
        prevPeriodStart
          ? getMonthView(isoToMonth(prevPeriodStart), accountId, prevPeriodStart).catch(() => null)
          : !useSalaryPeriodNav && prevMonth >= minMonth
            ? getMonthView(prevMonth, accountId).catch(() => null)
            : Promise.resolve(null),
      ])
        .then((results) => {
          if (!alive || loadGenRef.current !== reqId) return;

          const monthData = results[0] as MonthView;
          const prevMonthData = results[1] as MonthView | null;
          setData(monthData);
          setPrevMonthView(prevMonthData);

          const incomeCents = monthData.incomeCents;
          const expensesCents = monthData.expenseCents;
          const netCents = monthData.incomeCents - monthData.expenseCents;

          let startBalanceCents = monthData.startBalanceCents;
          let endBalanceCents = monthData.endBalanceCents;
          let startLiquidCents = monthData.startLiquidCents;
          let endLiquidCents = monthData.totalLiquidCents;
          const kontostandCents = monthData.kontostandCents;
          const prevKontostandCents = monthData.prevKontostandCents;

          if (isStockDepot) {
            endBalanceCents = kontostandCents;
            startLiquidCents = 0;
            endLiquidCents = 0;
          }

          setComparison({
            incomeCents,
            expensesCents,
            netCents,
            liquidExpensesCents: expensesCents,
            incomeMonth: selectedMonth,
            expenseMonth: selectedMonth,
            startBalanceCents,
            endBalanceCents,
            startLiquidCents,
            endLiquidCents,
            kontostandCents,
            prevKontostandCents,
          });
        })

        .catch((e) => {

          if (alive && loadGenRef.current === reqId) {

            setError(e instanceof Error ? e.message : String(e));

          }

        })

        .finally(() => {

          if (alive && loadGenRef.current === reqId) setLoading(false);

        });

    } else {

      setData(null);

      setComparison(null);

      setDayData(null);



      getDayView(day, accountId)

        .then((d) => {

          if (!alive || loadGenRef.current !== reqId) return;

          setDayData(d);

        })

        .catch((e) => {

          if (alive && loadGenRef.current === reqId) {

            setError(e instanceof Error ? e.message : String(e));

          }

        })

        .finally(() => {

          if (alive && loadGenRef.current === reqId) setLoading(false);

        });

    }



    return () => {

      alive = false;

    };

  }, [month, mode, day, accountId, isStockDepot, minMonth, periodStart, useSalaryPeriodNav, periodIndex, salaryPeriods]);



  const incomeCardTitle = comparison
    ? data?.periodMode === 'since_last_salary'
      ? t('dashboard.cards.incomeWithPeriod', { period: dashboardPeriodLabel(data, month, locale) })
      : t('dashboard.cards.incomeWithMonth', { month: formatDisplayMonthLong(comparison.incomeMonth, locale) })
    : t('dashboard.cards.income');

  const expenseCardTitle = comparison
    ? data?.periodMode === 'since_last_salary'
      ? t('dashboard.cards.expensesWithPeriod', { period: dashboardPeriodLabel(data, month, locale) })
      : t('dashboard.cards.expensesWithMonth', { month: formatDisplayMonthLong(comparison.expenseMonth, locale) })
    : t('dashboard.cards.expenses');

  const periodNavLabel = dashboardPeriodLabel(data, month, locale);



  const startBalanceCents = comparison?.startBalanceCents ?? 0;

  const endBalanceCents = comparison?.endBalanceCents ?? 0;

  const startLiquidCents = comparison?.startLiquidCents ?? 0;

  const endLiquidCents = comparison?.endLiquidCents ?? 0;

  const kontostandCents = comparison?.kontostandCents ?? 0;

  const prevKontostandCents = comparison?.prevKontostandCents ?? 0;

  const kontostandDeltaCents = kontostandCents - prevKontostandCents;

  const liquidDeltaCents = endLiquidCents - startLiquidCents;



  const cardRow2 = {

    display: 'grid',

    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',

    gap: 12,

    marginBottom: 12,

    overflow: 'visible',

    position: 'relative' as const,

  };

  const cardRow3 = { ...cardRow2, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' };

  const cardRow1 = { ...cardRow2, gridTemplateColumns: '1fr' };

  const cardRow4 = { ...cardRow2, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', marginBottom: 16 };



  const dayExpenses = dayData ? sumDayExpenses(dayData.events, dayData.date) : 0;

  const dayIncome = dayData ? sumDayIncome(dayData.events, dayData.date) : 0;

  const dayKontostandDelta = dayData ? dayData.kontostandCents - dayData.prevKontostandCents : 0;

  const showMonthKontostand = data ? isCurrentDashboardPeriod(data) : false;
  const showRemainingCostCards = data ? isCurrentDashboardPeriod(data) : true;
  const isPastPeriod = data != null && isPastDashboardPeriod(data);
  const isFuturePeriod = data != null && isFutureDashboardPeriod(data);
  const fixedCostsTileCents = data
    ? isPastPeriod
      ? data.bookedFixedCostsCents
      : isFuturePeriod
        ? data.fixedCostsCents
        : (data.remainingFixedCostsCents ?? data.fixedCostsCents)
    : 0;
  const variableCostsTileCents = data
    ? isPastPeriod
      ? data.bookedVariableCostsCents
      : isFuturePeriod
        ? data.variableCostsCents
        : (data.remainingVariableCostsCents ?? data.variableCostsCents ?? 0)
    : 0;
  const prevIncomeDelta = prevPeriodDelta(comparison?.incomeCents ?? 0, prevMonthView?.incomeCents);
  const prevExpensesDelta = prevPeriodDelta(
    comparison?.expensesCents ?? 0,
    prevMonthView ? expensesCentsFromView(prevMonthView) : undefined,
  );
  const prevBuysDelta = prevPeriodDelta(
    data?.appliedBuysCents ?? 0,
    prevMonthView?.appliedBuysCents,
  );
  const balanceDeltaCents = endBalanceCents - startBalanceCents;

  const kontostandSubtitle =
    data && data.kontostandAsOf !== isoToday()
      ? t('common.balanceAsOf', { date: formatDisplayDate(data.kontostandAsOf) })
      : undefined;
  const showDayKontostand = dayData ? shouldShowKontostand(dayData.date) : false;



  const monthEvents = useMemo(
    () => (data ? dashboardEventsForMonth(data, prevMonthView) : []),
    [data, prevMonthView],
  );

  const filteredEvents = useMemo(
    () => filterDashboardEvents(monthEvents, eventFilter, month, isSavingsPotView, accountId),
    [monthEvents, eventFilter, month, isSavingsPotView, accountId],
  );



  function setBreakdownMode(next: typeof tableMode) {
    setTableMode((cur) => {
      const mode = cur === next ? 'events' : next;
      if (mode !== 'events') setEventFilter('all');
      return mode;
    });
  }

  function toggleEventFilter(next: DashboardEventFilter) {
    setTableMode('events');
    setEventFilter((cur) => (cur === next ? 'all' : next));
  }

  const hasAccountBreakdown = !accountId && (data?.accountKontostandRows.length ?? 0) > 0;
  const showKontostandBreakdown = tableMode === 'kontostand' && hasAccountBreakdown;
  const showStartBalanceBreakdown = tableMode === 'startBalance' && hasAccountBreakdown;
  const showEndBalanceBreakdown = tableMode === 'endBalance' && hasAccountBreakdown;
  const showBalanceBreakdown = showKontostandBreakdown || showStartBalanceBreakdown || showEndBalanceBreakdown;
  const breakdownRows = showStartBalanceBreakdown
    ? data?.accountStartBalanceRows ?? []
    : showEndBalanceBreakdown
      ? data?.accountEndBalanceRows ?? []
      : data?.accountKontostandRows ?? [];
  const breakdownTitle = showStartBalanceBreakdown
    ? t('dashboard.startBalanceBreakdown')
    : showEndBalanceBreakdown
      ? t('dashboard.endBalanceBreakdown')
      : t('dashboard.kontostandBreakdown');
  const breakdownAmountLabel = showStartBalanceBreakdown
    ? t('dashboard.cards.startBalance')
    : showEndBalanceBreakdown
      ? t('dashboard.cards.endBalance')
      : t('dashboard.cards.kontostand');



  return (

    <PageShell title={t('dashboard.title')} error={error}>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>

        <div
          style={{
            ...ui.toolbar,
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <DashboardAccountSelect accounts={accounts} value={accountFilter} onChange={setAccountFilter} />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              marginLeft: 'auto',
              padding: '8px 10px',
              borderRadius: 12,
              border: `1px solid ${ui.colors.border}`,
              background: ui.colors.bgMuted,
            }}
          >
            <div style={{ display: 'flex', border: `1px solid ${ui.colors.border}`, borderRadius: 10, overflow: 'hidden', background: ui.colors.bgCard }}>
              <button
                type="button"
                onClick={() => setMode('day')}
                style={{ ...ui.btn, border: 'none', borderRadius: 0, boxShadow: 'none', background: mode === 'day' ? ui.colors.accentSoft : 'transparent' }}
              >
                {t('dashboard.modeDay')}
              </button>
              <button
                type="button"
                onClick={() => setMode('month')}
                style={{ ...ui.btn, border: 'none', borderRadius: 0, boxShadow: 'none', background: mode === 'month' ? ui.colors.accentSoft : 'transparent' }}
              >
                {t('dashboard.modeMonth')}
              </button>
            </div>

            {mode === 'month' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button type="button" style={{ ...ui.btn, padding: '8px 12px' }} onClick={goPrevPeriod} disabled={!canGoPrevMonth}>
                  ◀
                </button>
                <div style={{ minWidth: 168, textAlign: 'center', fontWeight: 600, fontSize: 14 }}>{periodNavLabel}</div>
                <button type="button" style={{ ...ui.btn, padding: '8px 12px' }} onClick={goNextPeriod} disabled={!canGoNextMonth}>
                  ▶
                </button>
              </div>
            ) : (
              <label style={{ ...ui.field, width: 190, marginBottom: 0 }}>
                <span style={ui.label}>{t('common.date')}</span>
                <DateInput value={day} onChange={setDay} />
              </label>
            )}

            <button
              type="button"
              style={{ ...ui.btn, padding: '8px 12px' }}
              onClick={goToCurrentPeriod}
              disabled={isOnCurrentPeriod}
              title={t('dashboard.goToCurrentPeriod')}
            >
              {t('dashboard.currentPeriodShort')}
            </button>

            <button
              type="button"
              style={{
                ...ui.btn,
                width: 40,
                height: 40,
                padding: 0,
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                lineHeight: 1,
              }}
              onClick={() => void handleRefreshCalculations()}
              disabled={refreshing || loading}
              title={t('dashboard.refreshCalculations')}
            >
              {refreshing ? '…' : '↻'}
            </button>
          </div>
        </div>

      </div>



      {loading ? (

        <div>{t('common.loading')}</div>

      ) : mode === 'month' && data && comparison ? (

        isStockDepot ? (

          <>

            {showMonthKontostand && (
              <div style={cardRow2}>
                <DashboardCard
                  title={t('dashboard.cards.kontostand')}
                  value={formatBalanceEurFromCents(kontostandCents)}
                  valueColor={kontostandCents < 0 ? ui.colors.amountNegative : undefined}
                  subtitle={kontostandSubtitle}
                  info={t('dashboard.info.kontostand')}
                />
                <DashboardCard
                  title={t('dashboard.cards.kontostandDeltaPrevMonth')}
                  value={formatDelta(kontostandDeltaCents)}
                  valueColor={kontostandDeltaCents >= 0 ? ui.colors.amountPositive : ui.colors.amountNegative}
                  info={t('dashboard.info.kontostandDelta')}
                />
              </div>
            )}

            <h3 style={{ marginTop: 0 }}>{t('dashboard.events')}</h3>

            <EventsTable events={data.events} accountFilter={accountId} isStockDepot={isStockDepot} onGroupClick={openBuyGroup} />

          </>

        ) : isSavingsPotView ? (

          <>

            <div style={showMonthKontostand ? cardRow3 : cardRow2}>
              {showMonthKontostand ? (
                <DashboardCard
                  title={t('dashboard.cards.kontostand')}
                  value={formatBalanceEurFromCents(kontostandCents)}
                  valueColor={kontostandCents < 0 ? ui.colors.amountNegative : undefined}
                  subtitle={kontostandSubtitle}
                  info={t('dashboard.info.kontostand')}
                />
              ) : null}
              <DashboardCard
                title={t('dashboard.cards.startBalance')}
                value={formatBalanceEurFromCents(startBalanceCents)}
                valueColor={startBalanceCents < 0 ? ui.colors.amountNegative : undefined}
                info={t('dashboard.info.startBalance')}
              />
              <DashboardCard
                title={t('dashboard.cards.endBalance')}
                value={formatBalanceEurFromCents(endBalanceCents)}
                valueColor={endBalanceCents < 0 ? ui.colors.amountNegative : undefined}
                info={t('dashboard.info.endBalance')}
                inlineDelta={{ cents: balanceDeltaCents, tooltip: t('dashboard.info.deltaBalance') }}
              />
            </div>

            <div style={cardRow3}>
              <DashboardCard
                title={incomeCardTitle}
                value={formatIncomeEurFromCents(comparison.incomeCents)}
                info={t('dashboard.info.income')}
                active={eventFilter === 'income'}
                onClick={() => toggleEventFilter('income')}
                inlineDelta={
                  prevIncomeDelta != null
                    ? { cents: prevIncomeDelta, tooltip: t('dashboard.info.incomeDeltaPrev') }
                    : undefined
                }
              />
              <DashboardCard
                title={expenseCardTitle}
                value={formatExpenseEurFromCents(comparison.expensesCents)}
                valueColor={comparison.expensesCents > 0 ? ui.colors.amountNegative : ui.colors.textMuted}
                info={t('dashboard.info.expenses')}
                active={eventFilter === 'expense'}
                onClick={() => toggleEventFilter('expense')}
                inlineDelta={
                  prevExpensesDelta != null
                    ? { cents: prevExpensesDelta, tooltip: t('dashboard.info.expensesDeltaPrev'), invertColors: true }
                    : undefined
                }
              />
              <DashboardCard
                title={t('dashboard.cards.net')}
                value={formatSignedEurFromCents(comparison.netCents)}
                valueColor={comparison.netCents >= 0 ? ui.colors.amountPositive : ui.colors.amountNegative}
                info={t('dashboard.info.net')}
              />
            </div>

            <h3 style={{ marginTop: 0 }}>{t('dashboard.events')}</h3>

            <EventsTable
              events={eventFilter === 'all' ? monthEvents : filteredEvents}
              filter={eventFilter}
              accountFilter={accountId}
              isStockDepot={isStockDepot}
              onGroupClick={openBuyGroup}
            />

          </>

        ) : (

          <>

            <div style={cardRow3}>
              {showMonthKontostand ? (
                <DashboardCard
                  title={t('dashboard.cards.kontostand')}
                  value={formatBalanceEurFromCents(kontostandCents)}
                  valueColor={kontostandCents < 0 ? ui.colors.amountNegative : undefined}
                  subtitle={kontostandSubtitle}
                  info={t('dashboard.info.kontostand')}
                  active={tableMode === 'kontostand'}
                  onClick={hasAccountBreakdown ? () => setBreakdownMode('kontostand') : undefined}
                />
              ) : (
                <div />
              )}
              {showForecastExpenseCards ? (
                <DashboardCard
                  title={t('dashboard.cards.buys')}
                  value={formatExpenseEurFromCents(data.appliedBuysCents)}
                  info={t('dashboard.info.buys')}
                  active={eventFilter === 'buy'}
                  onClick={() => toggleEventFilter('buy')}
                  inlineDelta={
                    prevBuysDelta != null
                      ? { cents: prevBuysDelta, tooltip: t('dashboard.info.buysDeltaPrev'), invertColors: true }
                      : undefined
                  }
                />
              ) : (
                <div />
              )}
              <DashboardCard
                title={incomeCardTitle}
                value={formatIncomeEurFromCents(comparison.incomeCents)}
                info={t('dashboard.info.income')}
                active={eventFilter === 'income'}
                onClick={() => toggleEventFilter('income')}
                inlineDelta={
                  prevIncomeDelta != null
                    ? { cents: prevIncomeDelta, tooltip: t('dashboard.info.incomeDeltaPrev') }
                    : undefined
                }
              />
            </div>

            <div style={cardRow3}>
              {showForecastExpenseCards ? (
                <DashboardCard
                  title={isPastPeriod || isFuturePeriod ? t('dashboard.cards.fixedCosts') : t('dashboard.cards.remainingFixedCosts')}
                  value={formatExpenseEurFromCents(fixedCostsTileCents)}
                  info={isPastPeriod || isFuturePeriod ? t('dashboard.info.fixedCosts') : t('dashboard.info.remainingFixedCosts')}
                  active={eventFilter === 'fixed_cost'}
                  onClick={() => toggleEventFilter('fixed_cost')}
                />
              ) : (
                <div />
              )}
              {showForecastExpenseCards ? (
                <DashboardCard
                  title={isPastPeriod || isFuturePeriod ? t('dashboard.cards.variableCosts') : t('dashboard.cards.remainingVariableCosts')}
                  value={formatExpenseEurFromCents(variableCostsTileCents)}
                  info={isPastPeriod || isFuturePeriod ? t('dashboard.info.variableCosts') : t('dashboard.info.remainingVariableCosts')}
                  active={eventFilter === 'variable_cost'}
                  onClick={() => toggleEventFilter('variable_cost')}
                />
              ) : (
                <div />
              )}
              <DashboardCard
                title={expenseCardTitle}
                value={formatExpenseEurFromCents(comparison.expensesCents)}
                valueColor={comparison.expensesCents > 0 ? ui.colors.amountNegative : ui.colors.textMuted}
                info={t('dashboard.info.expenses')}
                active={eventFilter === 'expense'}
                onClick={() => toggleEventFilter('expense')}
                inlineDelta={
                  prevExpensesDelta != null
                    ? { cents: prevExpensesDelta, tooltip: t('dashboard.info.expensesDeltaPrev'), invertColors: true }
                    : undefined
                }
              />
            </div>

            <div style={cardRow3}>
              <DashboardCard
                title={t('dashboard.cards.startBalance')}
                value={formatBalanceEurFromCents(startBalanceCents)}
                valueColor={startBalanceCents < 0 ? ui.colors.amountNegative : undefined}
                info={t('dashboard.info.startBalance')}
                active={tableMode === 'startBalance'}
                onClick={hasAccountBreakdown ? () => setBreakdownMode('startBalance') : undefined}
              />
              <DashboardCard
                title={t('dashboard.cards.endBalance')}
                value={formatBalanceEurFromCents(endBalanceCents)}
                valueColor={endBalanceCents < 0 ? ui.colors.amountNegative : undefined}
                info={t('dashboard.info.endBalance')}
                active={tableMode === 'endBalance'}
                onClick={hasAccountBreakdown ? () => setBreakdownMode('endBalance') : undefined}
                inlineDelta={
                  showLiquidCards
                    ? { cents: balanceDeltaCents, tooltip: t('dashboard.info.deltaBalance') }
                    : undefined
                }
              />
              <DashboardCard
                title={t('dashboard.cards.net')}
                value={formatSignedEurFromCents(comparison.netCents)}
                valueColor={comparison.netCents >= 0 ? ui.colors.amountPositive : ui.colors.amountNegative}
                info={t('dashboard.info.net')}
              />
            </div>

            {showLiquidCards ? (
              <div style={{ ...cardRow2, marginBottom: 12 }}>
                <DashboardCard
                  title={t('dashboard.cards.startLiquid')}
                  value={formatBalanceEurFromCents(startLiquidCents)}
                  valueColor={startLiquidCents < 0 ? ui.colors.amountNegative : undefined}
                  info={t('dashboard.info.startLiquid')}
                />
                <DashboardCard
                  title={t('dashboard.cards.endLiquid')}
                  value={formatBalanceEurFromCents(endLiquidCents)}
                  valueColor={endLiquidCents < 0 ? ui.colors.amountNegative : undefined}
                  info={t('dashboard.info.endLiquid')}
                  inlineDelta={{ cents: liquidDeltaCents, tooltip: t('dashboard.info.deltaLiquid') }}
                />
              </div>
            ) : null}

            {showLiquidCards ? (
              <div style={{ ...cardRow2, marginBottom: 16 }}>
                <DashboardCard
                  title={t('dashboard.cards.debtOwed')}
                  value={formatEurFromCents(debtSummary?.owedToMeCents ?? 0)}
                  valueColor={ui.colors.accentDark}
                  info={t('dashboard.info.debtOwed')}
                />
                <DashboardCard
                  title={t('dashboard.cards.debtIOwe')}
                  value={formatEurFromCents(debtSummary?.iOweCents ?? 0)}
                  valueColor={ui.colors.amountNegative}
                  info={t('dashboard.info.debtIOwe')}
                />
              </div>
            ) : null}

            <h3 style={{ marginTop: 0 }}>
              {showBalanceBreakdown ? breakdownTitle : t('dashboard.events')}
              {(eventFilter !== 'all' || showBalanceBreakdown) && (
                <button
                  type="button"
                  style={{ ...ui.btn, marginLeft: 12, fontSize: 12, padding: '4px 10px' }}
                  onClick={() => {
                    setEventFilter('all');
                    setTableMode('events');
                  }}
                >
                  {t('dashboard.resetFilter')}
                </button>
              )}
            </h3>

            {showBalanceBreakdown ? (
              <AccountBalanceBreakdownTable rows={breakdownRows} accounts={accounts} amountLabel={breakdownAmountLabel} />
            ) : (
              <EventsTable
                events={eventFilter === 'all' ? monthEvents : filteredEvents}
                filter={eventFilter}
                accountFilter={accountId}
                isStockDepot={isStockDepot}
                onGroupClick={openBuyGroup}
              />
            )}

          </>

        )

      ) : mode === 'day' && dayData ? (

        isStockDepot ? (

          <>

            {showDayKontostand && (
              <div style={cardRow2}>
                <DashboardCard title={t('dashboard.cards.kontostand')} value={formatEurFromCents(dayData.kontostandCents)} info={t('dashboard.info.kontostand')} />
                <DashboardCard
                  title={t('dashboard.cards.kontostandDeltaPrevDay')}
                  value={formatDelta(dayKontostandDelta)}
                  valueColor={dayKontostandDelta >= 0 ? ui.colors.amountPositive : ui.colors.amountNegative}
                  info={t('dashboard.info.kontostandDelta')}
                />
              </div>
            )}

            <h3 style={{ marginTop: 0 }}>{t('dashboard.eventsOnDay', { date: formatDisplayDate(dayData.date) })}</h3>

            <EventsTable events={dayData.events} accountFilter={accountId} isStockDepot={isStockDepot} onGroupClick={openBuyGroup} />

          </>

        ) : (

          <>

            <div style={showDayKontostand ? cardRow3 : cardRow2}>

              {showDayKontostand && (
                <DashboardCard title={t('dashboard.cards.kontostand')} value={formatEurFromCents(dayData.kontostandCents)} info={t('dashboard.info.kontostand')} />
              )}

              <DashboardCard title={t('dashboard.cards.dayIncome')} value={formatEurFromCents(dayIncome)} valueColor={ui.colors.accentDark} info={t('dashboard.info.dayIncome')} />

              <DashboardCard title={t('dashboard.cards.dayExpenses')} value={formatEurFromCents(-dayExpenses)} valueColor={ui.colors.amountNegative} info={t('dashboard.info.dayExpenses')} />

            </div>

            <h3 style={{ marginTop: 0 }}>{t('dashboard.eventsOnDay', { date: formatDisplayDate(dayData.date) })}</h3>

            <EventsTable events={dayData.events} accountFilter={accountId} isStockDepot={isStockDepot} onGroupClick={openBuyGroup} />

          </>

        )

      ) : null}

    </PageShell>

  );

}

