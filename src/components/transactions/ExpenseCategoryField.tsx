import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BuyItem, BuyItemGroup, FixedCost, VariableCost } from '../../lib/types';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';

export type ExpenseCategoryKind = 'none' | 'variable' | 'fixed' | 'buy' | 'buyGroup';

export type ExpenseCategoryValue = {
  kind: ExpenseCategoryKind;
  id: string | null;
};

export type ExpenseCategoryType = 'none' | 'variable' | 'fixed' | 'buy';

export function expenseCategoryTypeFromValue(value: ExpenseCategoryValue): ExpenseCategoryType {
  if (value.kind === 'variable') return 'variable';
  if (value.kind === 'fixed') return 'fixed';
  if (value.kind === 'buy' || value.kind === 'buyGroup') return 'buy';
  return 'none';
}

type ExpenseCategoryFieldProps = {
  variableCosts: VariableCost[];
  fixedCosts: FixedCost[];
  buyItems: BuyItem[];
  buyItemGroups?: BuyItemGroup[];
  value: ExpenseCategoryValue;
  onChange: (value: ExpenseCategoryValue) => void;
  disabled?: boolean;
  inputActions?: ReactNode;
  /** Bei variable: kein Suchfeld — nur Aufteilung über inputActions. */
  variableSplitOnly?: boolean;
  /** Typ vorgegeben — kein Typ-Dropdown (nur Suche). */
  lockedCategoryType?: ExpenseCategoryType;
};

export function expenseCategoryFromLedger(
  variableCostId: string | null | undefined,
  fixedCostId: string | null | undefined,
  buyItemId?: string | null | undefined,
  buyItemGroupId?: string | null | undefined,
): ExpenseCategoryValue {
  if (variableCostId) return { kind: 'variable', id: variableCostId };
  if (fixedCostId) return { kind: 'fixed', id: fixedCostId };
  if (buyItemGroupId) return { kind: 'buyGroup', id: buyItemGroupId };
  if (buyItemId) return { kind: 'buy', id: buyItemId };
  return { kind: 'none', id: null };
}

export function ledgerCategoryIds(value: ExpenseCategoryValue): {
  variableCostId: string | null;
  fixedCostId: string | null;
  buyItemId: string | null;
  buyItemGroupId: string | null;
} {
  if (value.kind === 'variable') {
    return { variableCostId: value.id, fixedCostId: null, buyItemId: null, buyItemGroupId: null };
  }
  if (value.kind === 'fixed') {
    return { variableCostId: null, fixedCostId: value.id, buyItemId: null, buyItemGroupId: null };
  }
  if (value.kind === 'buy') {
    return { variableCostId: null, fixedCostId: null, buyItemId: value.id, buyItemGroupId: null };
  }
  if (value.kind === 'buyGroup') {
    return { variableCostId: null, fixedCostId: null, buyItemId: null, buyItemGroupId: value.id };
  }
  return { variableCostId: null, fixedCostId: null, buyItemId: null, buyItemGroupId: null };
}

export function ExpenseCategoryField({
  variableCosts,
  fixedCosts,
  buyItems,
  buyItemGroups = [],
  value,
  onChange,
  disabled,
  inputActions,
  variableSplitOnly = false,
  lockedCategoryType,
}: ExpenseCategoryFieldProps) {
  const { t } = useLocale();
  const ui = useUi();
  const [categoryType, setCategoryType] = useState<ExpenseCategoryType>(
    () => lockedCategoryType ?? expenseCategoryTypeFromValue(value),
  );
  const [query, setQuery] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  useEffect(() => {
    if (lockedCategoryType) {
      setCategoryType(lockedCategoryType);
      return;
    }
    setCategoryType(expenseCategoryTypeFromValue(value));
  }, [value.kind, value.id, lockedCategoryType]);

  const selectableBuyItems = useMemo(() => {
    const parked = buyItems.filter((b) => b.status === 'parked' && !b.groupId);
    if (value.kind === 'buy' && value.id && !parked.some((b) => b.id === value.id)) {
      const current = buyItems.find((b) => b.id === value.id);
      if (current) return [current, ...parked];
    }
    return parked;
  }, [buyItems, value]);

  const selectableBuyGroups = useMemo(() => {
    const withMembers = buyItemGroups.filter((g) => buyItems.some((b) => b.groupId === g.id && b.status === 'parked'));
    if (value.kind === 'buyGroup' && value.id && !withMembers.some((g) => g.id === value.id)) {
      const current = buyItemGroups.find((g) => g.id === value.id);
      if (current) return [current, ...withMembers];
    }
    return withMembers;
  }, [buyItemGroups, buyItems, value]);

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
    if (value.kind === 'buyGroup' && value.id) {
      return buyItemGroups.find((g) => g.id === value.id)?.name ?? '';
    }
    return '';
  }, [value, variableCosts, fixedCosts, buyItems, buyItemGroups]);

  useEffect(() => {
    if (value.id) setQuery(selectedLabel);
    else if (categoryType === 'none') setQuery('');
  }, [value.id, selectedLabel, categoryType]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (categoryType === 'variable') {
      return variableCosts
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .slice(0, 10)
        .map((c) => ({ kind: 'variable' as const, id: c.id, label: c.name }));
    }
    if (categoryType === 'fixed') {
      return fixedCosts
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .slice(0, 10)
        .map((c) => ({ kind: 'fixed' as const, id: c.id, label: c.name }));
    }
    if (categoryType === 'buy') {
      const items = selectableBuyItems
        .filter((b) => !q || b.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((b) => ({
          kind: 'buy' as const,
          id: b.id,
          label: b.name,
          group: t('transactions.categoryBuy'),
        }));
      const groups = selectableBuyGroups
        .filter((g) => !q || g.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((g) => ({
          kind: 'buyGroup' as const,
          id: g.id,
          label: g.name,
          group: t('transactions.categoryBuyGroup'),
        }));
      return [...items, ...groups];
    }
    return [];
  }, [categoryType, variableCosts, fixedCosts, selectableBuyItems, selectableBuyGroups, query, t]);

  function onCategoryTypeChange(next: ExpenseCategoryType) {
    setCategoryType(next);
    setQuery('');
    onChange({ kind: 'none', id: null });
  }

  function pick(kind: ExpenseCategoryKind, id: string, label: string) {
    if (kind === 'none') return;
    onChange({ kind, id });
    setQuery(label);
    setSuggestionsOpen(false);
  }

  function clearSelection() {
    onChange({ kind: 'none', id: null });
    setQuery('');
  }

  const showSuggestions =
    suggestionsOpen &&
    query.trim().length > 0 &&
    suggestions.length > 0 &&
    !disabled &&
    !(value.id && query.trim().toLowerCase() === selectedLabel.trim().toLowerCase());

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {!lockedCategoryType ? (
      <select
        value={categoryType}
        onChange={(e) => onCategoryTypeChange(e.target.value as ExpenseCategoryType)}
        disabled={disabled}
      >
        <option value="none">{t('transactions.categoryType.none')}</option>
        <option value="variable">{t('transactions.categoryType.variable')}</option>
        <option value="fixed">{t('transactions.categoryType.fixed')}</option>
        <option value="buy">{t('transactions.categoryType.buy')}</option>
      </select>
      ) : null}
      {categoryType !== 'none' ? (
        categoryType === 'variable' && variableSplitOnly ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: ui.colors.textMuted }}>{t('transactions.variableCostSplitOnlyHint')}</span>
            {inputActions}
          </div>
        ) : (
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSuggestionsOpen(true);
                if (!e.target.value.trim()) {
                  onChange({ kind: 'none', id: null });
                }
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
              placeholder={t(`transactions.categorySearch.${categoryType}`)}
              disabled={disabled}
              style={ui.input}
              autoComplete="off"
              className="fh-input"
            />
            {value.id ? (
              <button type="button" style={ui.btn} onClick={clearSelection} disabled={disabled}>
                ×
              </button>
            ) : null}
            {inputActions}
          </div>
          {showSuggestions ? (
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
                  {'group' in item && item.group ? (
                    <span style={{ color: ui.colors.textMuted, fontSize: 12, display: 'block' }}>{item.group}</span>
                  ) : null}
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        )
      ) : null}
    </div>
  );
}
