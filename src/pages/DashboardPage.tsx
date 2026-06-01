import { useEffect, useMemo, useRef, useState } from 'react';

import type { Account, DayView, DebtSummary, IsoDate, IsoMonth, MonthView } from '../lib/types';

import { AmountTable } from '../components/data/AmountTable';

import { ThAmount, TdAmount } from '../components/data/AmountCells';

import {

  formatDisplayDate,

  formatDisplayMonthLong,

  isoToday,

  monthAdd,
  toIsoMonth,
} from '../lib/date';
import { formatEurFromCents, formatExpenseEurFromCents, formatIncomeEurFromCents, formatSignedEurFromCents } from '../lib/money';
import {
  computeDashboardMonthChain,
  dashboardMonthComparison,
  dashboardEventsForMonth,
  DASHBOARD_MIN_MONTH,
  filterDashboardEvents,
  monthsFromTo,
  isPastOrCurrentMonth,
  shouldShowKontostand,
  sumDayExpenses,
  sumDayIncome,
  type DashboardEventFilter,
} from '../lib/summary';

import { getDayView, getDebtSummary, getMonthView, listAccounts } from '../tauri/api';

import { useUi } from '../lib/ui';

import { useLocale } from '../i18n/LocaleProvider';

import { PageShell } from '../components/layout/PageShell';

import { DateInput } from '../components/DateInput';

import { DashboardAccountSelect } from '../components/dashboard/DashboardAccountSelect';

import { DashboardCard, formatDelta } from '../components/dashboard/DashboardCard';


function EventsTable({ events }: { events: MonthView['events'] }) {

  const ui = useUi();

  const { t } = useLocale();

  return (

    <AmountTable>

      <div style={{ ...ui.tableHead, gridTemplateColumns: '110px 140px 1fr 120px' }}>

        <div>{t('common.date')}</div>

        <div>{t('dashboard.accountLabel')}</div>

        <div style={ui.thName}>{t('transactions.titleField')}</div>

        <ThAmount col="amount">{t('common.amount')}</ThAmount>

      </div>

      {events.length === 0 ? (

        <div style={ui.emptyRow}>{t('dashboard.noEvents')}</div>

      ) : (

        events.map((ev) => (

          <div key={ev.id} style={{ ...ui.tableRow, gridTemplateColumns: '110px 140px 1fr 120px' }}>

            <div style={ui.tdMono}>{formatDisplayDate(ev.date)}</div>

            <div style={{ ...ui.tdCenter, color: ui.colors.textMuted, fontSize: 13 }}>{ev.accountName ?? '—'}</div>

            <div style={ui.tdName}>{ev.title}</div>

            <TdAmount col="amount" amountCents={ev.amountCents}>

              {formatSignedEurFromCents(ev.amountCents)}

            </TdAmount>

          </div>

        ))

      )}

    </AmountTable>

  );

}



export function DashboardPage() {

  const ui = useUi();

  const { t, locale } = useLocale();

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

  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const [debtSummary, setDebtSummary] = useState<DebtSummary | null>(null);

  const loadGenRef = useRef(0);



  useEffect(() => {

    listAccounts().then(setAccounts).catch(() => undefined);

    getDebtSummary().then(setDebtSummary).catch(() => undefined);

  }, []);



  const accountId = accountFilter || null;

  const selectedAccount = useMemo(

    () => (accountFilter ? accounts.find((a) => a.id === accountFilter) : null),

    [accountFilter, accounts],

  );

  const isStockDepot = selectedAccount?.balanceSource === 'stock_portfolio';

  const canGoPrevMonth = month > DASHBOARD_MIN_MONTH;

  const liquidAccountIds = useMemo(

    () => new Set(accounts.filter((a) => a.isLiquid).map((a) => a.id)),

    [accounts],

  );



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



      const selectedMonth = month;
      const prevMonth = monthAdd(selectedMonth, -1);
      const chainMonths = monthsFromTo(DASHBOARD_MIN_MONTH, selectedMonth);
      const seedMonth = monthAdd(DASHBOARD_MIN_MONTH, -1);

      Promise.all([
        ...chainMonths.map((m) => getMonthView(m, accountId)),
        getMonthView(seedMonth, accountId).catch(() => null),
        prevMonth >= DASHBOARD_MIN_MONTH ? getMonthView(prevMonth, accountId).catch(() => null) : Promise.resolve(null),
      ])
        .then((results) => {
          if (!alive || loadGenRef.current !== reqId) return;

          const prevMonthData = results[results.length - 1] as MonthView | null;
          const seedPrevMonthView = results[results.length - 2] as MonthView | null;
          const views = results.slice(0, -2) as MonthView[];
          const viewsByMonth = new Map<IsoMonth, MonthView>();
          chainMonths.forEach((m, i) => viewsByMonth.set(m, views[i]));

          const monthData = viewsByMonth.get(selectedMonth)!;
          setData(monthData);
          setPrevMonthView(prevMonthData);

          const chain = computeDashboardMonthChain({
            viewsByMonth,
            fromMonth: DASHBOARD_MIN_MONTH,
            toMonth: selectedMonth,
            liquidAccountIds,
            seedPrevMonthView,
          });

          const row = chain.get(selectedMonth);
          if (!row) return;

          const summary = dashboardMonthComparison({
            incomeCents: row.incomeCents,
            expensesCents: row.expensesCents,
            liquidExpensesCents: row.liquidExpensesCents,
          });

          let startBalanceCents = row.startBalanceCents;
          let endBalanceCents = row.endBalanceCents;
          let startLiquidCents = row.startLiquidCents;
          let endLiquidCents = row.endLiquidCents;
          const kontostandCents = monthData.kontostandCents;
          const prevKontostandCents = monthData.prevKontostandCents;

          if (isStockDepot) {
            endBalanceCents = kontostandCents;
            startLiquidCents = 0;
            endLiquidCents = 0;
          }

          setComparison({
            ...summary,
            incomeCents: row.incomeCents,
            liquidExpensesCents: row.liquidExpensesCents,
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

  }, [month, mode, day, accountId, liquidAccountIds, isStockDepot]);



  const incomeCardTitle = comparison

    ? t('dashboard.cards.incomeWithMonth', { month: formatDisplayMonthLong(comparison.incomeMonth, locale) })

    : t('dashboard.cards.income');

  const expenseCardTitle = comparison

    ? t('dashboard.cards.expensesWithMonth', { month: formatDisplayMonthLong(comparison.expenseMonth, locale) })

    : t('dashboard.cards.expenses');



  const startBalanceCents = comparison?.startBalanceCents ?? 0;

  const endBalanceCents = comparison?.endBalanceCents ?? 0;

  const startLiquidCents = comparison?.startLiquidCents ?? 0;

  const endLiquidCents = comparison?.endLiquidCents ?? 0;

  const kontostandCents = comparison?.kontostandCents ?? 0;

  const prevKontostandCents = comparison?.prevKontostandCents ?? 0;

  const kontostandDeltaCents = kontostandCents - prevKontostandCents;

  const balanceDeltaCents = endBalanceCents - startBalanceCents;

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

  const cardRow4 = { ...cardRow2, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', marginBottom: 16 };



  const dayExpenses = dayData ? sumDayExpenses(dayData.events, dayData.date) : 0;

  const dayIncome = dayData ? sumDayIncome(dayData.events, dayData.date) : 0;

  const dayKontostandDelta = dayData ? dayData.kontostandCents - dayData.prevKontostandCents : 0;

  const showMonthKontostand = isPastOrCurrentMonth(month);
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
    () => filterDashboardEvents(monthEvents, eventFilter, month),
    [monthEvents, eventFilter, month],
  );



  function toggleEventFilter(next: DashboardEventFilter) {

    setEventFilter((cur) => (cur === next ? 'all' : next));

  }



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

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexShrink: 0, marginLeft: 'auto' }}>
            <div style={{ display: 'flex', border: `1px solid ${ui.colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
              <button onClick={() => setMode('day')} style={{ ...ui.btn, border: 'none', background: mode === 'day' ? ui.colors.accentSoft : 'transparent' }}>
                {t('dashboard.modeDay')}
              </button>
              <button onClick={() => setMode('month')} style={{ ...ui.btn, border: 'none', background: mode === 'month' ? ui.colors.accentSoft : 'transparent' }}>
                {t('dashboard.modeMonth')}
              </button>
            </div>

            {mode === 'month' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button style={ui.btn} onClick={() => setMonth((m) => monthAdd(m, -1))} disabled={!canGoPrevMonth}>
                  ◀
                </button>
                <div style={{ minWidth: 120, textAlign: 'center' }}>{formatDisplayMonthLong(month, locale)}</div>
                <button style={ui.btn} onClick={() => setMonth((m) => monthAdd(m, 1))}>
                  ▶
                </button>
              </div>
            ) : (
              <label style={{ ...ui.field, width: 190 }}>
                <span style={ui.label}>{t('common.date')}</span>
                <DateInput value={day} onChange={setDay} />
              </label>
            )}
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
                  value={formatEurFromCents(kontostandCents)}
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

            <EventsTable events={data.events} />

          </>

        ) : (

          <>

            <div style={showMonthKontostand ? cardRow3 : cardRow2}>

              {showMonthKontostand && (
                <DashboardCard
                  title={t('dashboard.cards.kontostand')}
                  value={formatEurFromCents(kontostandCents)}
                  subtitle={kontostandSubtitle}
                  info={t('dashboard.info.kontostand')}
                />
              )}

              <DashboardCard title={t('dashboard.cards.startBalance')} value={formatEurFromCents(startBalanceCents)} info={t('dashboard.info.startBalance')} />

              <DashboardCard title={t('dashboard.cards.startLiquid')} value={formatEurFromCents(startLiquidCents)} info={t('dashboard.info.startLiquid')} />

            </div>

            <div style={cardRow3}>

              <DashboardCard title={incomeCardTitle} value={formatIncomeEurFromCents(comparison.incomeCents)} info={t('dashboard.info.income')} active={eventFilter === 'income'} onClick={() => toggleEventFilter('income')} />

              <DashboardCard title={expenseCardTitle} value={formatExpenseEurFromCents(comparison.expensesCents)} info={t('dashboard.info.expenses')} active={eventFilter === 'expense'} onClick={() => toggleEventFilter('expense')} />

              <DashboardCard

                title={t('dashboard.cards.net')}

                value={formatSignedEurFromCents(comparison.netCents)}

                valueColor={comparison.netCents >= 0 ? ui.colors.amountPositive : ui.colors.amountNegative}

                info={t('dashboard.info.net')}

              />

            </div>

            <div style={cardRow3}>

              <DashboardCard

                title={t('dashboard.cards.fixedCosts')}

                value={formatExpenseEurFromCents(data.fixedCostsCents)}

                info={t('dashboard.info.fixedCosts')}

                active={eventFilter === 'fixed_cost'}

                onClick={() => toggleEventFilter('fixed_cost')}

              />

              <DashboardCard

                title={t('dashboard.cards.variableCosts')}

                value={formatExpenseEurFromCents(data.variableCostsCents ?? 0)}

                info={t('dashboard.info.variableCosts')}

                active={eventFilter === 'variable_cost'}

                onClick={() => toggleEventFilter('variable_cost')}

              />

              <DashboardCard title={t('dashboard.cards.buys')} value={formatExpenseEurFromCents(data.appliedBuysCents)} info={t('dashboard.info.buys')} active={eventFilter === 'buy'} onClick={() => toggleEventFilter('buy')} />

            </div>

            <div style={cardRow2}>

              <DashboardCard title={t('dashboard.cards.debtOwed')} value={formatEurFromCents(debtSummary?.owedToMeCents ?? 0)} valueColor={ui.colors.accentDark} info={t('dashboard.info.debtOwed')} />

              <DashboardCard title={t('dashboard.cards.debtIOwe')} value={formatEurFromCents(debtSummary?.iOweCents ?? 0)} valueColor={ui.colors.amountNegative} info={t('dashboard.info.debtIOwe')} />

            </div>

            <div style={cardRow4}>

              <DashboardCard title={t('dashboard.cards.endBalance')} value={formatEurFromCents(endBalanceCents)} info={t('dashboard.info.endBalance')} />

              <DashboardCard

                title={t('dashboard.cards.deltaBalance')}

                value={formatDelta(balanceDeltaCents)}

                valueColor={balanceDeltaCents >= 0 ? ui.colors.amountPositive : ui.colors.amountNegative}

                info={t('dashboard.info.deltaBalance')}

              />

              <DashboardCard title={t('dashboard.cards.endLiquid')} value={formatEurFromCents(endLiquidCents)} info={t('dashboard.info.endLiquid')} />

              <DashboardCard

                title={t('dashboard.cards.deltaLiquid')}

                value={formatDelta(liquidDeltaCents)}

                valueColor={liquidDeltaCents >= 0 ? ui.colors.amountPositive : ui.colors.amountNegative}

                info={t('dashboard.info.deltaLiquid')}

              />

            </div>

            <h3 style={{ marginTop: 0 }}>

              {t('dashboard.events')}

              {eventFilter !== 'all' && (

                <button type="button" style={{ ...ui.btn, marginLeft: 12, fontSize: 12, padding: '4px 10px' }} onClick={() => setEventFilter('all')}>

                  {t('dashboard.resetFilter')}

                </button>

              )}

            </h3>

            <EventsTable events={eventFilter === 'all' ? monthEvents : filteredEvents} />

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

            <EventsTable events={dayData.events} />

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

            <EventsTable events={dayData.events} />

          </>

        )

      ) : null}

    </PageShell>

  );

}

