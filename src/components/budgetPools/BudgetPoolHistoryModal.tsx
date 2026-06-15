import { useEffect, useState } from 'react';
import type { BudgetPool, BudgetPoolPeriodHistory } from '../../lib/types';
import { Modal } from '../common/Modal';
import { AmountTable } from '../data/AmountTable';
import { TdAmount } from '../data/AmountCells';
import { formatExpenseEurFromCents, formatBalanceEurFromCents } from '../../lib/money';
import { getBudgetPoolPeriodHistory } from '../../tauri/api';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';

const TABLE_COLS = 'minmax(180px, 1.4fr) 120px 120px 120px';

type BudgetPoolHistoryModalProps = {
  open: boolean;
  pool: BudgetPool | null;
  onClose: () => void;
};

export function BudgetPoolHistoryModal({ open, pool, onClose }: BudgetPoolHistoryModalProps) {
  const ui = useUi();
  const { t } = useLocale();
  const [history, setHistory] = useState<BudgetPoolPeriodHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !pool) {
      setHistory(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    getBudgetPoolPeriodHistory(pool.id)
      .then(setHistory)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, pool]);

  if (!pool) return null;

  return (
    <Modal open={open} bleed wide title={pool.name} onClose={onClose}>
      <p style={{ ...ui.sectionHint, marginTop: 0 }}>{t('budgetPools.historyIntro')}</p>
      {pool.scalable ? <p style={{ ...ui.sectionHint, marginTop: 0 }}>{t('budgetPools.scalableHint')}</p> : null}
      {error ? <p style={{ color: ui.colors.amountNegative, marginTop: 0 }}>{error}</p> : null}
      {loading ? <p style={{ color: ui.colors.textMuted }}>{t('common.loading')}</p> : null}
      {!loading && history && history.rows.length === 0 ? (
        <p style={{ color: ui.colors.textMuted }}>{t('budgetPools.historyEmpty')}</p>
      ) : null}
      {!loading && history && history.rows.length > 0 ? (
        <AmountTable minWidth={640}>
          <div className="fh-table-head" style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
            <div>{t('budgetPools.historyPeriod')}</div>
            <div style={ui.thAmount}>{t('budgetPools.planned')}</div>
            <div style={ui.thAmount}>{t('budgetPools.actual')}</div>
            <div style={ui.thAmount}>{t('budgetPools.remaining')}</div>
          </div>
          {history.rows.map((row) => (
            <div
              key={row.periodKey}
              className="fh-table-row"
              style={{
                ...ui.tableRow,
                gridTemplateColumns: TABLE_COLS,
                fontWeight: row.isCurrent ? 600 : undefined,
              }}
            >
              <div style={ui.cellStack}>
                <div>{row.periodLabel}</div>
                {row.isCurrent ? <div style={ui.cellSub}>{t('budgetPools.currentPeriod')}</div> : null}
                {history.scalable && row.carryOverCents !== 0 ? (
                  <div style={ui.cellSub}>
                    {t('budgetPools.carryOverLine', {
                      amount: formatBalanceEurFromCents(row.carryOverCents),
                    })}
                  </div>
                ) : null}
              </div>
              <TdAmount col="forecast" amountCents={-row.plannedCents}>
                {formatExpenseEurFromCents(row.plannedCents)}
              </TdAmount>
              <TdAmount col="actual" amountCents={-row.actualCents}>
                {formatExpenseEurFromCents(row.actualCents)}
              </TdAmount>
              <TdAmount col="remaining" amountCents={row.remainingCents}>
                {formatBalanceEurFromCents(row.remainingCents)}
              </TdAmount>
            </div>
          ))}
        </AmountTable>
      ) : null}
    </Modal>
  );
}
