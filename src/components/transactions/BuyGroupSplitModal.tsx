import { useEffect, useMemo, useState } from 'react';
import type { BuyItem, BuyItemGroup } from '../../lib/types';
import { Modal } from '../common/Modal';
import { formatEurFromCents, parseEurToCents } from '../../lib/money';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';

export type BuyGroupSplitDraft = {
  buyItemId: string;
  amountCents: number;
};

type BuyGroupSplitModalProps = {
  open: boolean;
  group: BuyItemGroup | null;
  buyItems: BuyItem[];
  txAmountCents: number;
  initialSplits?: BuyGroupSplitDraft[];
  onClose: () => void;
  onConfirm: (splits: BuyGroupSplitDraft[]) => void;
};

export function BuyGroupSplitModal({
  open,
  group,
  buyItems,
  txAmountCents,
  initialSplits = [],
  onClose,
  onConfirm,
}: BuyGroupSplitModalProps) {
  const { t } = useLocale();
  const ui = useUi();
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const candidates = useMemo(() => {
    if (!group) return [];
    const initialIds = new Set(initialSplits.map((s) => s.buyItemId));
    return buyItems.filter(
      (item) =>
        item.groupId === group.id &&
        (item.status === 'parked' || initialIds.has(item.id)),
    );
  }, [buyItems, group, initialSplits]);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const split of initialSplits) {
      next[split.buyItemId] = (split.amountCents / 100).toFixed(2).replace('.', ',');
    }
    setAmounts(next);
  }, [open, initialSplits]);

  const assignedTotal = useMemo(() => {
    let sum = 0;
    for (const item of candidates) {
      const raw = amounts[item.id]?.trim();
      if (!raw) continue;
      try {
        sum += parseEurToCents(raw);
      } catch {
        return null;
      }
    }
    return sum;
  }, [amounts, candidates]);

  const remaining = assignedTotal == null ? null : txAmountCents - assignedTotal;
  const canConfirm = assignedTotal != null && assignedTotal === txAmountCents && assignedTotal > 0;

  function confirm() {
    if (!canConfirm) return;
    const splits: BuyGroupSplitDraft[] = [];
    for (const item of candidates) {
      const raw = amounts[item.id]?.trim();
      if (!raw) continue;
      const cents = parseEurToCents(raw);
      if (cents > 0) {
        splits.push({ buyItemId: item.id, amountCents: cents });
      }
    }
    onConfirm(splits);
  }

  return (
    <Modal open={open} wide title={t('transactions.buyGroupSplitTitle')} onClose={onClose}>
      <div className="fh-form">
        <p className="fh-form-hint" style={{ marginTop: 0 }}>
          {t('transactions.buyGroupSplitHint', {
            group: group?.name ?? '',
            total: formatEurFromCents(txAmountCents),
          })}
        </p>
        {candidates.length === 0 ? (
          <p style={{ color: ui.colors.textMuted }}>{t('transactions.buyGroupSplitEmpty')}</p>
        ) : (
          candidates.map((item) => (
            <label key={item.id}>
              {item.name}
              <span style={{ marginLeft: 8, color: ui.colors.textMuted, fontSize: 12 }}>
                ({formatEurFromCents(item.amountCents)})
              </span>
              <input
                value={amounts[item.id] ?? ''}
                onChange={(e) => setAmounts((current) => ({ ...current, [item.id]: e.target.value }))}
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
