import { useEffect, useMemo, useState } from 'react';
import type { VariableCost } from '../../lib/types';
import { Modal } from '../common/Modal';
import { EntityIconBadge } from '../common/AppIcon';
import { formatEurFromCents, parseEurToCents } from '../../lib/money';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';

export type VariableCostSplitDraft = {
  variableCostId: string;
  amountCents: number;
};

type VariableCostSplitModalProps = {
  open: boolean;
  variableCosts: VariableCost[];
  txAmountCents: number;
  initialSplits?: VariableCostSplitDraft[];
  onClose: () => void;
  onConfirm: (splits: VariableCostSplitDraft[]) => void;
};

export function VariableCostSplitModal({
  open,
  variableCosts,
  txAmountCents,
  initialSplits = [],
  onClose,
  onConfirm,
}: VariableCostSplitModalProps) {
  const { t } = useLocale();
  const ui = useUi();
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const split of initialSplits) {
      next[split.variableCostId] = (split.amountCents / 100).toFixed(2).replace('.', ',');
    }
    setAmounts(next);
  }, [open, initialSplits]);

  const assignedTotal = useMemo(() => {
    let sum = 0;
    for (const cost of variableCosts) {
      const raw = amounts[cost.id]?.trim();
      if (!raw) continue;
      try {
        sum += parseEurToCents(raw);
      } catch {
        return null;
      }
    }
    return sum;
  }, [amounts, variableCosts]);

  const remaining = assignedTotal == null ? null : txAmountCents - assignedTotal;
  const canConfirm = assignedTotal != null && assignedTotal === txAmountCents && assignedTotal > 0;

  function confirm() {
    if (!canConfirm) return;
    const splits: VariableCostSplitDraft[] = [];
    for (const cost of variableCosts) {
      const raw = amounts[cost.id]?.trim();
      if (!raw) continue;
      const cents = parseEurToCents(raw);
      if (cents > 0) splits.push({ variableCostId: cost.id, amountCents: cents });
    }
    onConfirm(splits);
  }

  return (
    <Modal open={open} nested title={t('transactions.variableCostSplitTitle')} onClose={onClose}>
      <div className="fh-form">
        <p className="fh-form-hint" style={{ marginTop: 0 }}>
          {t('transactions.variableCostSplitHint', { total: formatEurFromCents(txAmountCents) })}
        </p>
        {variableCosts.length === 0 ? (
          <p style={{ color: ui.colors.textMuted }}>{t('transactions.variableCostSplitEmpty')}</p>
        ) : (
          variableCosts.map((cost) => (
            <label key={cost.id}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <EntityIconBadge icon={cost.icon} color={cost.color} size={16} />
                {cost.name}
              </span>
              <input
                value={amounts[cost.id] ?? ''}
                onChange={(e) => setAmounts((current) => ({ ...current, [cost.id]: e.target.value }))}
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
