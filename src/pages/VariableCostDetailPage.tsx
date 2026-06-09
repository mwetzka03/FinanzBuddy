import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { IsoMonth, VariableCostCategorizedTransaction, VariableCostDetail } from '../lib/types';
import { TdAmount } from '../components/data/AmountCells';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';
import {
  VARIABLE_COSTS_START_MONTH,
  formatDisplayDate,
  formatDisplayMonth,
  monthAdd,
  monthEndDate,
  toIsoMonth,
} from '../lib/date';
import { formatExpenseEurFromCents, formatSignedEurFromCents, parseEurToCents } from '../lib/money';
import { getVariableCostDetail, setVariableCostActual } from '../tauri/api';
import { useUi } from '../lib/ui';
import { VariableCostBudgetChart } from '../components/variableCosts/VariableCostBudgetChart';
import { SaveIconButton } from '../components/SaveIconButton';

const TABLE_COLS = '140px 120px 120px 160px 100px';

function buildMonthRange(): IsoMonth[] {
  const now = toIsoMonth(new Date());
  const end = monthAdd(now, 3);
  const months: IsoMonth[] = [];
  let cur: IsoMonth = VARIABLE_COSTS_START_MONTH;
  while (cur <= end) {
    months.push(cur);
    cur = monthAdd(cur, 1);
  }
  return months;
}

function isMonthEditable(month: IsoMonth): boolean {
  return month >= VARIABLE_COSTS_START_MONTH;
}

function monthFromDate(date: string): IsoMonth {
  return date.slice(0, 7) as IsoMonth;
}

function groupTransactionsByMonth(transactions: VariableCostCategorizedTransaction[]) {
  const map = new Map<IsoMonth, VariableCostCategorizedTransaction[]>();
  for (const tx of transactions) {
    const month = monthFromDate(tx.date);
    const list = map.get(month) ?? [];
    list.push(tx);
    map.set(month, list);
  }
  return map;
}

function txSumForMonth(txs: VariableCostCategorizedTransaction[]): number {
  return txs.reduce((sum, tx) => sum + Math.abs(tx.amountCents), 0);
}

export function VariableCostDetailPage() {
  const ui = useUi();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<VariableCostDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingMonth, setSavingMonth] = useState<string | null>(null);

  const months = useMemo(() => buildMonthRange(), []);
  type MonthSortKey = 'month' | 'forecast' | 'budget' | 'actual';
  const [sort, setSort] = useState<SortState<MonthSortKey>>(null);
  const sortedMonths = useMemo(() => {
    if (!detail) return months;
    const actualMap = new Map(detail.actuals.map((a) => [a.month, a]));
    const txByMonth = groupTransactionsByMonth(detail.transactions);
    const forecastCents = detail.cost.amountCents;
    return sortByState(months, sort, {
      month: (m) => m,
      forecast: () => forecastCents,
      budget: () => forecastCents,
      actual: (m) => {
        const actual = actualMap.get(m);
        if (actual?.actualSource === 'manual') return actual.amountCents;
        return txSumForMonth(txByMonth.get(m) ?? []);
      },
    });
  }, [months, sort, detail]);

  async function refresh() {
    if (!id) return;
    const data = await getVariableCostDetail(id);
    setDetail(data);
    setDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const month of buildMonthRange()) {
        const manual = data.actuals.find((a) => a.month === month && a.actualSource === 'manual');
        if (manual) {
          next[month] = (manual.amountCents / 100).toFixed(2).replace('.', ',');
        } else {
          next[month] = prev[month] ?? '';
        }
      }
      return next;
    });
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  async function saveMonth(month: IsoMonth) {
    if (!id) return;
    setError(null);
    setSavingMonth(month);
    try {
      const raw = drafts[month]?.trim() ?? '';
      if (!raw) {
        await setVariableCostActual({ id, month, amountCents: null });
      } else {
        await setVariableCostActual({ id, month, amountCents: parseEurToCents(raw) });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMonth(null);
    }
  }

  if (!id) {
    return <div>Eintrag nicht gefunden.</div>;
  }

  if (!detail) {
    return <div style={{ color: ui.colors.textMuted }}>Lade…</div>;
  }

  const actualMap = new Map(detail.actuals.map((a) => [a.month, a]));
  const txByMonth = groupTransactionsByMonth(detail.transactions);
  const forecastCents = detail.cost.amountCents;

  function displayActualCents(month: IsoMonth): number {
    const actual = actualMap.get(month);
    if (actual?.actualSource === 'manual') return actual.amountCents;
    return txSumForMonth(txByMonth.get(month) ?? []);
  }

  return (
    <div style={ui.pageNarrow}>
      <Link to="/variable-kosten" style={{ color: ui.colors.textMuted, textDecoration: 'none', fontSize: 14 }}>
        ← Variable Kosten
      </Link>

      <h2 style={{ marginTop: 8, marginBottom: 4, color: ui.colors.accentDark }}>{detail.cost.name}</h2>
      <p style={{ ...ui.pageIntro, marginTop: 0 }}>
        Budget (Prognose): <strong>{formatExpenseEurFromCents(forecastCents)}</strong> pro Monat · Tatsächlich =
        Summe kategorisierter Transaktionen, optional manuell überschreibbar · ab{' '}
        {formatDisplayMonth(VARIABLE_COSTS_START_MONTH)}
      </p>
      {detail.cost.notes && (
        <p style={{ color: ui.colors.textMuted, marginTop: 0, fontSize: 14 }}>{detail.cost.notes}</p>
      )}
      {error && <div style={ui.errorBox}>{error}</div>}

      <section style={{ ...ui.listPanel, marginBottom: 16, padding: 20 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Aktueller Monat ({formatDisplayMonth(detail.cost.currentMonth)})</h3>
        <VariableCostBudgetChart
          forecastCents={detail.cost.currentMonthForecastCents}
          actualCents={detail.cost.currentMonthActualCents}
        />
        {!detail.cost.currentMonthClosed ? (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: ui.colors.textMuted }}>
            Laufender Monat: Prognose bleibt für die Saldo-Prognose aktiv. Kategorisierte Transaktionen (
            {formatExpenseEurFromCents(detail.cost.currentMonthSpentCents)}) fließen in Tatsächlich ein, werden aber
            nicht doppelt im Saldo gezählt.
          </p>
        ) : null}
      </section>

      <section style={ui.listPanel}>
        <h3 style={{ marginTop: 0 }}>Monatsübersicht</h3>
        <p style={{ color: ui.colors.textMuted, fontSize: 13, marginTop: 0 }}>
          Budget = Prognose. Tatsächlich = Summe aller Transaktionen mit dieser Kategorie — oder dein manueller Wert.
          Feld leer lassen und speichern hebt eine manuelle Überschreibung auf.
        </p>
        <div style={ui.tableScroll}>
          <div style={{ ...ui.table, minWidth: 640 }}>
            <div style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
              <SortableTh label="Monat" sortKey="month" sort={sort} onSort={setSort} />
              <SortableTh
                label="Prognose"
                sortKey="forecast"
                sort={sort}
                onSort={setSort}
                style={ui.thAmount}
                align="right"
              />
              <SortableTh
                label="Budget"
                sortKey="budget"
                sort={sort}
                onSort={setSort}
                style={ui.thAmount}
                align="right"
              />
              <SortableTh
                label="Tatsächlich"
                sortKey="actual"
                sort={sort}
                onSort={setSort}
                style={ui.thAmount}
                align="right"
              />
              <div />
            </div>
            {sortedMonths.map((month) => {
              const editable = isMonthEditable(month);
              const monthTxs = txByMonth.get(month) ?? [];
              const txSum = txSumForMonth(monthTxs);
              const manual = actualMap.get(month)?.actualSource === 'manual';
              const displayActual = displayActualCents(month);
              const draftEmpty = !(drafts[month]?.trim() ?? '');

              return (
                <div key={month}>
                  <div style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
                    <div style={ui.tdCenter}>
                      <div>{formatDisplayMonth(month)}</div>
                      <div style={{ fontSize: 12, color: ui.colors.textMuted }}>{formatDisplayDate(monthEndDate(month))}</div>
                    </div>
                    <TdAmount col="forecast" amountCents={-forecastCents}>
                      {formatExpenseEurFromCents(forecastCents)}
                    </TdAmount>
                    <TdAmount col="budget" amountCents={-forecastCents}>
                      {formatExpenseEurFromCents(forecastCents)}
                    </TdAmount>
                    <TdAmount col="actual" amountCents={-displayActual}>
                      {!manual && draftEmpty && displayActual > 0 ? (
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>
                          {formatExpenseEurFromCents(displayActual)}
                        </div>
                      ) : null}
                      <input
                        value={drafts[month] ?? ''}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [month]: e.target.value }))}
                        placeholder={txSum > 0 ? txSum.toFixed(2).replace('.', ',') : 'Manuell oder leer'}
                        disabled={!editable}
                        title={
                          manual
                            ? 'Manuell überschrieben — leer speichern = zurück zu Transaktionen'
                            : txSum > 0
                              ? `Summe Transaktionen: ${formatExpenseEurFromCents(txSum)}`
                              : 'Keine Transaktionen — leer = 0 €'
                        }
                        style={{
                          ...ui.input,
                          width: '100%',
                          textAlign: 'center',
                          background: manual ? ui.colors.accentSoft : 'transparent',
                          border: manual ? `1px solid ${ui.colors.accent}` : 'none',
                          opacity: editable ? 1 : 0.6,
                        }}
                      />
                      {draftEmpty && txSum > 0 ? (
                        <div style={{ fontSize: 11, color: ui.colors.textMuted, marginTop: 4 }}>
                          Summe: {formatExpenseEurFromCents(txSum)}
                        </div>
                      ) : null}
                    </TdAmount>
                    <div style={ui.tdActions}>
                      <SaveIconButton
                        label="Speichern"
                        onClick={() => saveMonth(month)}
                        disabled={!editable || savingMonth === month}
                      />
                    </div>
                  </div>
                  {manual && (
                    <div style={ui.rowPreview}>
                      Manuell überschrieben: {formatExpenseEurFromCents(displayActual)} — Feld leeren und speichern
                      setzt wieder die Transaktionssumme (
                      {txSum > 0 ? formatExpenseEurFromCents(txSum) : '0 €'}).
                    </div>
                  )}
                  {monthTxs.length > 0 && (
                    <div style={{ padding: '8px 16px 12px', borderBottom: `1px solid ${ui.colors.border}` }}>
                      {monthTxs.map((tx) => (
                        <div
                          key={tx.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '120px 1fr 120px',
                            gap: 12,
                            padding: '6px 0',
                            fontSize: 13,
                            color: ui.colors.textMuted,
                          }}
                        >
                          <span style={{ fontFamily: 'monospace' }}>{formatDisplayDate(tx.date)}</span>
                          <span>
                            {tx.title}
                            {tx.notes ? ` · ${tx.notes}` : ''}
                          </span>
                          <span style={{ textAlign: 'right' }}>{formatSignedEurFromCents(tx.amountCents)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
