import type { CSSProperties } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { useUi } from '../../lib/ui';

export type SortDir = 'asc' | 'desc';
export type SortState<K extends string = string> = { key: K; dir: SortDir } | null;

export function toggleSort<K extends string>(cur: SortState<K>, key: K): SortState<K> {
  if (cur?.key !== key) return { key, dir: 'asc' };
  if (cur.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

export function compareSortValues(a: string | number, b: string | number, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * mul;
  return String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' }) * mul;
}

export function sortByState<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  getters: Record<K, (row: T) => string | number>,
): T[] {
  if (!sort) return rows;
  const getter = getters[sort.key];
  if (!getter) return rows;
  return [...rows].sort((a, b) => compareSortValues(getter(a), getter(b), sort.dir));
}

type SortableThProps<K extends string> = {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (next: SortState<K>) => void;
  style?: CSSProperties;
  align?: 'left' | 'center' | 'right';
  amountCol?: string | number;
};

export function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  style,
  align = 'left',
  amountCol,
}: SortableThProps<K>) {
  const ui = useUi();
  const active = sort?.key === sortKey;
  const SortIcon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;

  return (
    <button
      type="button"
      className={['fh-sort-th', active ? 'fh-sort-th--active' : ''].filter(Boolean).join(' ')}
      onClick={() => onSort(toggleSort(sort, sortKey))}
      data-amount-col={amountCol != null ? String(amountCol) : undefined}
      data-amount-header={amountCol != null ? '' : undefined}
      style={{
        ...style,
        background: 'none',
        border: 'none',
        padding: 0,
        margin: 0,
        cursor: 'pointer',
        font: 'inherit',
        fontWeight: active ? 700 : style?.fontWeight ?? 'inherit',
        letterSpacing: 'inherit',
        textTransform: 'inherit',
        color: active ? ui.colors.accent : style?.color ?? 'inherit',
        textAlign: align,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        width: align === 'right' || align === 'center' ? '100%' : undefined,
        justifyContent:
          align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
      }}
      title={active ? (sort.dir === 'asc' ? 'Aufsteigend' : 'Absteigend') : 'Sortieren'}
      aria-pressed={active}
    >
      <span>{label}</span>
      <span className="fh-sort-indicator" aria-hidden>
        <SortIcon size={14} strokeWidth={active ? 2.5 : 2} />
      </span>
    </button>
  );
}
