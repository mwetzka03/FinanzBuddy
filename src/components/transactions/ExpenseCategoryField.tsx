import { useMemo, useState } from 'react';
import type { BuyItem, FixedCost, VariableCost } from '../../lib/types';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';

export type ExpenseCategoryKind = 'none' | 'variable' | 'fixed' | 'buy';

export type ExpenseCategoryValue = {
  kind: ExpenseCategoryKind;
  id: string | null;
};

type ExpenseCategoryFieldProps = {
  variableCosts: VariableCost[];
  fixedCosts: FixedCost[];
  buyItems: BuyItem[];
  value: ExpenseCategoryValue;
  onChange: (value: ExpenseCategoryValue) => void;
  disabled?: boolean;
};

export function expenseCategoryFromLedger(
  variableCostId: string | null | undefined,
  fixedCostId: string | null | undefined,
  buyItemId?: string | null | undefined,
): ExpenseCategoryValue {
  if (variableCostId) return { kind: 'variable', id: variableCostId };
  if (fixedCostId) return { kind: 'fixed', id: fixedCostId };
  if (buyItemId) return { kind: 'buy', id: buyItemId };
  return { kind: 'none', id: null };
}

export function ledgerCategoryIds(value: ExpenseCategoryValue): {
  variableCostId: string | null;
  fixedCostId: string | null;
  buyItemId: string | null;
} {
  if (value.kind === 'variable') {
    return { variableCostId: value.id, fixedCostId: null, buyItemId: null };
  }
  if (value.kind === 'fixed') {
    return { variableCostId: null, fixedCostId: value.id, buyItemId: null };
  }
  if (value.kind === 'buy') {
    return { variableCostId: null, fixedCostId: null, buyItemId: value.id };
  }
  return { variableCostId: null, fixedCostId: null, buyItemId: null };
}

export function ExpenseCategoryField({
  variableCosts,
  fixedCosts,
  buyItems,
  value,
  onChange,
  disabled,
}: ExpenseCategoryFieldProps) {
  const { t } = useLocale();
  const ui = useUi();
  const [query, setQuery] = useState('');

  const selectableBuyItems = useMemo(() => {
    const parked = buyItems.filter((b) => b.status === 'parked');
    if (value.kind === 'buy' && value.id && !parked.some((b) => b.id === value.id)) {
      const current = buyItems.find((b) => b.id === value.id);
      if (current) return [current, ...parked];
    }
    return parked;
  }, [buyItems, value]);

  const selectedLabel = useMemo(() => {
    if (value.kind === 'variable' && value.id) {
      return variableCosts.find((c) => c.id === value.id)?.name ?? '';
    }
    if (value.kind === 'fixed' && value.id) {
      return fixedCosts.find((c) => c.id === value.id)?.name ?? '';
    }
    if (value.kind === 'buy' && value.id) {
      return buyItems.find((b) => b.id === value.id)?.name ?? '';
    }
    return '';
  }, [value, variableCosts, fixedCosts, buyItems]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const variable = variableCosts
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((c) => ({ kind: 'variable' as const, id: c.id, label: c.name, group: t('transactions.categoryVariable') }));
    const fixed = fixedCosts
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((c) => ({ kind: 'fixed' as const, id: c.id, label: c.name, group: t('transactions.categoryFixed') }));
    const buy = selectableBuyItems
      .filter((b) => !q || b.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((b) => ({ kind: 'buy' as const, id: b.id, label: b.name, group: t('transactions.categoryBuy') }));
    return [...variable, ...fixed, ...buy];
  }, [variableCosts, fixedCosts, selectableBuyItems, query, t]);

  function pick(kind: ExpenseCategoryKind, id: string, label: string) {
    if (kind === 'none') return;
    onChange({ kind, id });
    setQuery(label);
  }

  function clear() {
    onChange({ kind: 'none', id: null });
    setQuery('');
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={query || selectedLabel}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value.trim()) {
              onChange({ kind: 'none', id: null });
            }
          }}
          placeholder={t('transactions.categoryPlaceholder')}
          disabled={disabled}
          style={ui.input}
          autoComplete="off"
          className="fh-input"
        />
        {value.id ? (
          <button type="button" style={ui.btn} onClick={clear} disabled={disabled}>
            ×
          </button>
        ) : null}
      </div>
      {query.trim() && suggestions.length > 0 && !disabled ? (
        <div style={ui.suggestPopover}>
          {suggestions.map((item) => (
            <button
              key={`${item.kind}:${item.id}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(item.kind, item.id, item.label)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              <span style={{ color: ui.colors.textMuted, fontSize: 12, display: 'block' }}>{item.group}</span>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
