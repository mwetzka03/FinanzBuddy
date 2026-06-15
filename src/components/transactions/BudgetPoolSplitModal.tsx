import { useEffect, useMemo, useState } from 'react';
import type { BudgetPool } from '../../lib/types';
import { Modal } from '../common/Modal';
import { EntityIconBadge } from '../common/AppIcon';
import { formatEurFromCents, parseEurToCents } from '../../lib/money';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';

export type BudgetPoolSplitDraft = {
  budgetPoolId: string;
  amountCents: number;
};

type BudgetPoolSplitModalProps = {
  open: boolean;
  budgetPools: BudgetPool[];
  txAmountCents: number;
  initialSplits?: BudgetPoolSplitDraft[];
  onClose: () => void;
  onConfirm: (splits: BudgetPoolSplitDraft[]) => void;
  onPoolClick?: (pool: BudgetPool) => void;
};

export function BudgetPoolSplitModal({
  open,
  budgetPools,
  txAmountCents,
  initialSplits = [],
  onClose,
  onConfirm,
  onPoolClick,
}: BudgetPoolSplitModalProps) {
  const { t } = useLocale();
  const ui = useUi();
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const split of initialSplits) {
      next[split.budgetPoolId] = (split.amountCents / 100).toFixed(2).replace('.', ',');
    }
    setAmounts(next);
  }, [open, initialSplits]);

  const assignedTotal = useMemo(() => {
    let sum = 0;
    for (const pool of budgetPools) {
      const raw = amounts[pool.id]?.trim();
      if (!raw) continue;
      try {
        sum += parseEurToCents(raw);
      } catch {
        return null;
      }
    }
    return sum;
  }, [amounts, budgetPools]);

  const remaining = assignedTotal == null ? null : txAmountCents - assignedTotal;
  const canConfirm = assignedTotal != null && assignedTotal === txAmountCents && assignedTotal > 0;

  function confirm() {
    if (!canConfirm) return;
    const splits: BudgetPoolSplitDraft[] = [];
    for (const pool of budgetPools) {
      const raw = amounts[pool.id]?.trim();
      if (!raw) continue;
      const cents = parseEurToCents(raw);
      if (cents > 0) splits.push({ budgetPoolId: pool.id, amountCents: cents });
    }
    onConfirm(splits);
  }

  return (
    <Modal open={open} wide title={t('transactions.budgetPoolSplitTitle')} onClose={onClose}>
      <div className="fh-form">
        <p className="fh-form-hint" style={{ marginTop: 0 }}>
          {t('transactions.budgetPoolSplitHint', { total: formatEurFromCents(txAmountCents) })}
        </p>
        {budgetPools.length === 0 ? (
          <p style={{ color: ui.colors.textMuted }}>{t('transactions.budgetPoolSplitEmpty')}</p>
        ) : (
          budgetPools.map((pool) => (
            <label key={pool.id}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <EntityIconBadge icon={pool.icon} color={pool.color} size={16} />
                {onPoolClick ? (
                  <button type="button" className="fh-link-button" onClick={() => onPoolClick(pool)}>
                    {pool.name}
                  </button>
                ) : (
                  pool.name
                )}
                <span style={{ color: ui.colors.textMuted, fontSize: 12 }}>
                  ({t(`budgetPools.periodMode.${pool.periodMode}`)})
                </span>
              </span>
              <input
                value={amounts[pool.id] ?? ''}
                onChange={(e) => setAmounts((current) => ({ ...current, [pool.id]: e.target.value }))}
                placeholder="0,00"
              />
            </label>
          ))
        )}
        <div style={{ fontSize: 13, color: ui.colors.textMuted }}>
          {assignedTotal == null
            ? t('transactions.buyGroupSplitInvalid')
            : t('transactions.buyGroupSplitRemaining', {
                assigned: formatEurFromCents(assignedTotal),
                remaining: formatEurFromCents(Math.abs(remaining ?? 0)),
              })}
        </div>
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={confirm} disabled={!canConfirm}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
