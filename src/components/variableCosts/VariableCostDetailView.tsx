import { useEffect, useMemo, useState } from 'react';
import type { DashboardPeriodMode, DashboardPeriodNavItem, IsoDate, IsoMonth, VariableCostDetail } from '../../lib/types';
import {
  VARIABLE_COSTS_START_MONTH,
  formatDisplayDate,
  formatDisplayMonth,
  monthAdd,
  monthEndDate,
  monthStartDate,
  toIsoMonth,
} from '../../lib/date';
import { formatExpenseEurFromCents, formatSignedEurFromCents, parseEurToCents } from '../../lib/money';
import { getDashboardSettings, getVariableCostDetail, listDashboardPeriods, setVariableCostActual } from '../../tauri/api';
import { useUi } from '../../lib/ui';
import { useLocale } from '../../i18n/LocaleProvider';
import { VariableCostBudgetChart } from './VariableCostBudgetChart';
import { SaveIconButton } from '../SaveIconButton';

export type VariableCostPeriod = {
  storageMonth: IsoMonth;
  label: string;
  start: IsoDate;
  end: IsoDate;
  isCurrent: boolean;
};

function buildCalendarPeriods(): VariableCostPeriod[] {
  const now = toIsoMonth(new Date());
  const end = monthAdd(now, 3);
  const periods: VariableCostPeriod[] = [];
  let cur: IsoMonth = VARIABLE_COSTS_START_MONTH;
  while (cur <= end) {
    periods.push({
      storageMonth: cur,
      label: formatDisplayMonth(cur),
      start: monthStartDate(cur),
      end: monthEndDate(cur),
      isCurrent: cur === now,
    });
    cur = monthAdd(cur, 1);
  }
  return periods;
}

function salaryPeriodsToVariableCostPeriods(items: DashboardPeriodNavItem[]): VariableCostPeriod[] {
  return items.map((p) => ({
    storageMonth: p.periodStart.slice(0, 7) as IsoMonth,
    label: `${formatDisplayDate(p.periodStart)} – ${formatDisplayDate(p.periodEnd)}`,
    start: p.periodStart,
    end: p.periodEnd,
    isCurrent: p.isCurrent,
  }));
}

function txAmountForCost(tx: VariableCostDetail['transactions'][number]): number {
  return Math.abs(tx.splitAmountCents ?? tx.amountCents);
}

function transactionsInPeriod(detail: VariableCostDetail, period: VariableCostPeriod) {
  return detail.transactions.filter((tx) => tx.date >= period.start && tx.date <= period.end);
}

type VariableCostDetailViewProps = {
  costId: string;
  onError?: (message: string | null) => void;
  onDetailLoaded?: (detail: VariableCostDetail) => void;
};

export function VariableCostDetailView({ costId, onError, onDetailLoaded }: VariableCostDetailViewProps) {
  const ui = useUi();
  const { t } = useLocale();
  const [detail, setDetail] = useState<VariableCostDetail | null>(null);
  const [periodMode, setPeriodMode] = useState<DashboardPeriodMode>('calendar_month');
  const [periods, setPeriods] = useState<VariableCostPeriod[]>(() => buildCalendarPeriods());
  const [periodIndex, setPeriodIndex] = useState(0);
  const [draftActual, setDraftActual] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedPeriod = periods[periodIndex] ?? periods[0];

  useEffect(() => {
    Promise.all([getDashboardSettings(), listDashboardPeriods()])
      .then(([settings, salaryPeriods]) => {
        setPeriodMode(settings.periodMode);
        const next =
          settings.periodMode === 'since_last_salary' && salaryPeriods.length > 0
            ? salaryPeriodsToVariableCostPeriods(salaryPeriods)
            : buildCalendarPeriods();
        setPeriods(next);
        const currentIdx = next.findIndex((p) => p.isCurrent);
        setPeriodIndex(currentIdx >= 0 ? currentIdx : Math.max(0, next.length - 1));
      })
      .catch(() => {
        setPeriods(buildCalendarPeriods());
      });
  }, [costId]);

  async function refreshDetail() {
    const data = await getVariableCostDetail(costId);
    setDetail(data);
    onDetailLoaded?.(data);
    return data;
  }

  useEffect(() => {
    onError?.(null);
    refreshDetail().catch((e) => onError?.(e instanceof Error ? e.message : String(e)));
  }, [costId]);

  useEffect(() => {
    if (!detail || !selectedPeriod) return;
    const manual = detail.actuals.find(
      (a) => a.month === selectedPeriod.storageMonth && a.actualSource === 'manual',
    );
    setDraftActual(manual ? (manual.amountCents / 100).toFixed(2).replace('.', ',') : '');
  }, [detail, selectedPeriod?.storageMonth]);

  const periodTransactions = useMemo(
    () => (detail && selectedPeriod ? transactionsInPeriod(detail, selectedPeriod) : []),
    [detail, selectedPeriod],
  );

  const txSum = useMemo(
    () => periodTransactions.reduce((sum, tx) => sum + txAmountForCost(tx), 0),
    [periodTransactions],
  );

  const manualActual = detail?.actuals.find(
    (a) => a.month === selectedPeriod?.storageMonth && a.actualSource === 'manual',
  );
  const displayActual = manualActual?.amountCents ?? txSum;
  const forecastCents = detail?.cost.amountCents ?? 0;
  const periodLabel =
    periodMode === 'since_last_salary' ? t('variableCosts.periodSalary') : t('variableCosts.periodCalendar');

  async function saveActual() {
    if (!selectedPeriod) return;
    setSaving(true);
    onError?.(null);
    try {
      const raw = draftActual.trim();
      if (!raw) {
        await setVariableCostActual({ id: costId, month: selectedPeriod.storageMonth, amountCents: null });
      } else {
        await setVariableCostActual({
          id: costId,
          month: selectedPeriod.storageMonth,
          amountCents: parseEurToCents(raw),
        });
      }
      await refreshDetail();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!detail || !selectedPeriod) {
    return <div style={{ color: ui.colors.textMuted }}>{t('common.loading')}</div>;
  }

  return (
    <>
      <p style={{ ...ui.sectionHint, marginTop: 0 }}>
        {t('variableCosts.detailIntro', {
          budget: formatExpenseEurFromCents(forecastCents),
          mode: periodLabel,
        })}
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 13, color: ui.colors.textMuted }}>
          {t('variableCosts.periodLabel')}: <strong style={{ color: ui.colors.text }}>{selectedPeriod.label}</strong>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="fh-btn ghost"
            disabled={periodIndex <= 0}
            onClick={() => setPeriodIndex((i) => Math.max(0, i - 1))}
          >
            ←
          </button>
          <span style={{ fontSize: 13, minWidth: 48, textAlign: 'center' }}>
            {periodIndex + 1} / {periods.length}
          </span>
          <button
            type="button"
            className="fh-btn ghost"
            disabled={periodIndex >= periods.length - 1}
            onClick={() => setPeriodIndex((i) => Math.min(periods.length - 1, i + 1))}
          >
            →
          </button>
        </div>
      </div>

      <section style={{ ...ui.listPanel, marginBottom: 16, padding: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>
          {t('variableCosts.currentPeriodSection', { period: selectedPeriod.label })}
        </h3>
        <VariableCostBudgetChart forecastCents={forecastCents} actualCents={displayActual} />
        {selectedPeriod.isCurrent && !detail.cost.currentMonthClosed ? (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: ui.colors.textMuted }}>
            {t('variableCosts.openPeriodHint', {
              spent: formatExpenseEurFromCents(txSum),
            })}
          </p>
        ) : null}
      </section>

      <section style={{ ...ui.listPanel, marginBottom: 16, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>{t('variableCosts.periodTransactionsTitle')}</h3>
        {periodTransactions.length === 0 ? (
          <p style={{ color: ui.colors.textMuted, fontSize: 13, margin: 0 }}>{t('variableCosts.noPeriodTransactions')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {periodTransactions.map((tx) => (
              <div
                key={tx.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '110px 1fr 120px',
                  gap: 12,
                  padding: '8px 0',
                  borderBottom: `1px solid ${ui.colors.border}`,
                  fontSize: 13,
                }}
              >
                <span style={{ fontFamily: 'monospace' }}>{formatDisplayDate(tx.date)}</span>
                <span>
                  {tx.title}
                  {tx.notes ? ` · ${tx.notes}` : ''}
                </span>
                <span style={{ textAlign: 'right', fontWeight: 600 }}>
                  {formatExpenseEurFromCents(txAmountForCost(tx))}
                </span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 13, paddingTop: 4 }}>
              <span style={{ color: ui.colors.textMuted, marginRight: 8 }}>{t('variableCosts.transactionsSum')}:</span>
              <strong>{formatExpenseEurFromCents(txSum)}</strong>
            </div>
          </div>
        )}
      </section>

      <section style={{ ...ui.listPanel, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>{t('variableCosts.manualActualTitle')}</h3>
        <p style={{ color: ui.colors.textMuted, fontSize: 13, marginTop: 0 }}>
          {t('variableCosts.manualActualHint')}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={draftActual}
            onChange={(e) => setDraftActual(e.target.value)}
            placeholder={txSum > 0 ? txSum.toFixed(2).replace('.', ',') : t('variableCosts.manualActualPlaceholder')}
            style={{ ...ui.input, flex: '1 1 160px', maxWidth: 220 }}
          />
          <SaveIconButton label={t('common.save')} onClick={() => void saveActual()} disabled={saving} />
        </div>
        {!draftActual.trim() && txSum > 0 ? (
          <p style={{ fontSize: 12, color: ui.colors.textMuted, marginBottom: 0 }}>
            {t('variableCosts.manualActualFallback', { sum: formatExpenseEurFromCents(txSum) })}
          </p>
        ) : null}
        {manualActual ? (
          <p style={{ fontSize: 12, color: ui.colors.textMuted, marginBottom: 0 }}>
            {t('variableCosts.manualActualActive', { amount: formatExpenseEurFromCents(manualActual.amountCents) })}
          </p>
        ) : null}
      </section>
    </>
  );
}
