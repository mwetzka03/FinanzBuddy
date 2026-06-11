import { useEffect, useMemo, useState } from 'react';
import type { IsoMonth, VariableCostDetail } from '../../lib/types';
import { Modal } from '../common/Modal';
import { TdAmount } from '../data/AmountCells';
import { useTablePagination, TablePaginationBar } from '../data/tablePagination';
import { SortableTh, sortByState, type SortState } from '../data/tableSort';
import {
  VARIABLE_COSTS_START_MONTH,
  formatDisplayDate,
  formatDisplayMonth,
  monthAdd,
  monthEndDate,
  toIsoMonth,
} from '../../lib/date';
import { formatExpenseEurFromCents, parseEurToCents } from '../../lib/money';
import { getVariableCostDetail, setVariableCostActual } from '../../tauri/api';
import { useUi } from '../../lib/ui';
import { VariableCostBudgetChart } from './VariableCostBudgetChart';
import { SaveIconButton } from '../SaveIconButton';

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

type Props = {
  open: boolean;
  costId: string | null;
  onClose: () => void;
};

export function VariableCostDetailModal({ open, costId, onClose }: Props) {
  const ui = useUi();
  const [detail, setDetail] = useState<VariableCostDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingMonth, setSavingMonth] = useState<string | null>(null);
  const months = useMemo(() => buildMonthRange(), []);
  type MonthSortKey = 'month' | 'forecast' | 'budget' | 'actual';
  const [sort, setSort] = useState<SortState<MonthSortKey>>(null);
  const sortedMonths = useMemo(
    () =>
      sortByState(months, sort, {
        month: (m) => m,
        forecast: () => detail?.cost.amountCents ?? 0,
        budget: () => detail?.cost.amountCents ?? 0,
        actual: (m) => {
          const raw = drafts[m]?.trim() ?? '';
          return raw ? parseEurToCents(raw) : 0;
        },
      }),
    [months, sort, detail, drafts],
  );
  const pagination = useTablePagination(sortedMonths);

  useEffect(() => {
    if (!open || !costId) {
      setDetail(null);
      return;
    }
    setError(null);
    getVariableCostDetail(costId)
      .then((data) => {
        setDetail(data);
        const next: Record<string, string> = {};
        for (const month of buildMonthRange()) {
          const manual = data.actuals.find((a) => a.month === month && a.actualSource === 'manual');
          next[month] = manual ? (manual.amountCents / 100).toFixed(2).replace('.', ',') : '';
        }
        setDrafts(next);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, costId]);

  async function saveMonth(month: IsoMonth) {
    if (!costId) return;
    setSavingMonth(month);
    try {
      const raw = drafts[month]?.trim() ?? '';
      if (!raw) await setVariableCostActual({ id: costId, month, amountCents: null });
      else await setVariableCostActual({ id: costId, month, amountCents: parseEurToCents(raw) });
      const data = await getVariableCostDetail(costId);
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMonth(null);
    }
  }

  if (!costId) return null;

  return (
    <Modal open={open} wide title={detail?.cost.name ?? '…'} onClose={onClose}>
      {error ? <div style={ui.errorBox}>{error}</div> : null}
      {!detail ? (
        <div style={{ color: ui.colors.textMuted }}>Lade…</div>
      ) : (
        <>
          <p style={{ ...ui.sectionHint, marginTop: 0 }}>
            Budget: {formatExpenseEurFromCents(detail.cost.amountCents)} pro Monat · ab{' '}
            {formatDisplayMonth(VARIABLE_COSTS_START_MONTH)}
          </p>
          <section style={{ ...ui.listPanel, marginBottom: 16, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Aktueller Monat ({formatDisplayMonth(detail.cost.currentMonth)})</h3>
            <VariableCostBudgetChart
              forecastCents={detail.cost.currentMonthForecastCents}
              actualCents={detail.cost.currentMonthActualCents}
            />
          </section>
          <section style={ui.listPanel}>
            <h3 style={{ marginTop: 0 }}>Monatsübersicht</h3>
            <div style={ui.tableScroll}>
              <div style={{ ...ui.table, minWidth: 640 }}>
                <div className="fh-table-head" style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
                  <SortableTh label="Monat" sortKey="month" sort={sort} onSort={setSort} style={ui.thName} />
                  <SortableTh
                    label="Prognose"
                    sortKey="forecast"
                    sort={sort}
                    onSort={setSort}
                    style={ui.thAmount}
                    align="center"
                  />
                  <SortableTh
                    label="Budget"
                    sortKey="budget"
                    sort={sort}
                    onSort={setSort}
                    style={ui.thAmount}
                    align="center"
                  />
                  <SortableTh
                    label="Tatsächlich"
                    sortKey="actual"
                    sort={sort}
                    onSort={setSort}
                    style={ui.thAmount}
                    align="center"
                  />
                  <div />
                </div>
                <TablePaginationBar
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  totalItems={pagination.totalItems}
                  pageSize={pagination.pageSize}
                  onPageChange={pagination.setPage}
                />
                {pagination.pageItems.map((month) => (
                  <div key={month} style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
                    <div style={ui.tdName}>
                      <div>{formatDisplayMonth(month)}</div>
                      <div style={ui.cellSub}>{formatDisplayDate(monthEndDate(month))}</div>
                    </div>
                    <TdAmount col="forecast" amountCents={-detail.cost.amountCents}>
                      {formatExpenseEurFromCents(detail.cost.amountCents)}
                    </TdAmount>
                    <TdAmount col="budget" amountCents={-detail.cost.amountCents}>
                      {formatExpenseEurFromCents(detail.cost.amountCents)}
                    </TdAmount>
                    <TdAmount col="actual" amountCents={0}>
                      <input
                        value={drafts[month] ?? ''}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [month]: e.target.value }))}
                        placeholder="Manuell oder leer"
                        style={{ ...ui.input, width: '100%', textAlign: 'center', background: 'transparent', border: 'none' }}
                      />
                    </TdAmount>
                    <div style={ui.tdActions}>
                      <SaveIconButton label="Speichern" onClick={() => saveMonth(month)} disabled={savingMonth === month} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </Modal>
  );
}
