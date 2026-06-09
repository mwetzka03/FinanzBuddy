import type { CSSProperties } from 'react';
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
};

export function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  style,
  align = 'left',
}: SortableThProps<K>) {
  const ui = useUi();
  const active = sort?.key === sortKey;
  const indicator = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕';

  return (
    <button
      type="button"
      onClick={() => onSort(toggleSort(sort, sortKey))}
      style={{
        ...style,
        background: 'none',
        border: 'none',
        padding: 0,
        margin: 0,
        cursor: 'pointer',
        font: 'inherit',
        fontWeight: 'inherit',
        letterSpacing: 'inherit',
        textTransform: 'inherit',
        color: 'inherit',
        textAlign: align,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        width: align === 'right' ? '100%' : undefined,
        justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
      }}
      title={active ? (sort.dir === 'asc' ? 'Aufsteigend' : 'Absteigend') : 'Sortieren'}
    >
      <span>{label}</span>
      <span style={{ opacity: active ? 1 : 0.35, fontSize: 10, color: active ? ui.colors.accentDark : undefined }}>
        {indicator}
      </span>
    </button>
  );
}
