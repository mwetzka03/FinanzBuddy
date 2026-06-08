import { useMemo, useState } from 'react';
import type { FixedCost, VariableCost } from '../../lib/types';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';

export type ExpenseCategoryKind = 'none' | 'variable' | 'fixed';

export type ExpenseCategoryValue = {
  kind: ExpenseCategoryKind;
  id: string | null;
};

type ExpenseCategoryFieldProps = {
  variableCosts: VariableCost[];
  fixedCosts: FixedCost[];
  value: ExpenseCategoryValue;
  onChange: (value: ExpenseCategoryValue) => void;
  disabled?: boolean;
};

export function expenseCategoryFromLedger(
  variableCostId: string | null | undefined,
  fixedCostId: string | null | undefined,
): ExpenseCategoryValue {
  if (variableCostId) return { kind: 'variable', id: variableCostId };
  if (fixedCostId) return { kind: 'fixed', id: fixedCostId };
  return { kind: 'none', id: null };
}

export function ledgerCategoryIds(value: ExpenseCategoryValue): {
  variableCostId: string | null;
  fixedCostId: string | null;
} {
  if (value.kind === 'variable') {
    return { variableCostId: value.id, fixedCostId: null };
  }
  if (value.kind === 'fixed') {
    return { variableCostId: null, fixedCostId: value.id };
  }
  return { variableCostId: null, fixedCostId: null };
}

export function ExpenseCategoryField({
  variableCosts,
  fixedCosts,
  value,
  onChange,
  disabled,
}: ExpenseCategoryFieldProps) {
  const { t } = useLocale();
  const ui = useUi();
  const [query, setQuery] = useState('');

  const selectedLabel = useMemo(() => {
    if (value.kind === 'variable' && value.id) {
      return variableCosts.find((c) => c.id === value.id)?.name ?? '';
    }
    if (value.kind === 'fixed' && value.id) {
      return fixedCosts.find((c) => c.id === value.id)?.name ?? '';
    }
    return '';
  }, [value, variableCosts, fixedCosts]);

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
    return [...variable, ...fixed];
  }, [variableCosts, fixedCosts, query, t]);

  function pick(kind: 'variable' | 'fixed', id: string, label: string) {
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
