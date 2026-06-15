import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleProvider';

export const TABLE_PAGE_SIZE = 15;

export function useTablePagination<T>(items: T[], pageSize = TABLE_PAGE_SIZE) {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [items.length, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  return {
    page: safePage,
    setPage,
    totalPages,
    pageItems,
    totalItems: items.length,
    pageSize,
    showPagination: items.length > pageSize,
  };
}

export function useTableSearch<T>(
  items: T[],
  query: string,
  matcher: (item: T, normalizedQuery: string) => boolean,
) {
  const normalized = query.trim().toLowerCase();
  return useMemo(() => {
    if (!normalized) return items;
    return items.filter((item) => matcher(item, normalized));
  }, [items, normalized, matcher]);
}

export function TableToolbar(props: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  searchPlaceholder?: string;
}) {
  const { t } = useLocale();
  const showPagination = props.totalItems > props.pageSize;
  const hasSearch = props.onSearchQueryChange != null;
  if (!showPagination && !hasSearch) return null;

  const from = (props.page - 1) * props.pageSize + 1;
  const to = Math.min(props.page * props.pageSize, props.totalItems);
  const rangeText = showPagination
    ? t('table.paginationRange', { from, to, total: props.totalItems })
    : `${t('common.entries')}: ${props.totalItems}`;

  return (
    <>
      <div className={`fh-table-pagination${hasSearch ? ' fh-table-pagination--with-search' : ''}`}>
        {hasSearch ? (
          <label className="fh-table-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              value={props.searchQuery ?? ''}
              onChange={(e) => props.onSearchQueryChange?.(e.target.value)}
              placeholder={props.searchPlaceholder ?? t('common.search')}
              aria-label={props.searchPlaceholder ?? t('common.search')}
            />
          </label>
        ) : (
          showPagination ? <span className="fh-table-pagination__range">{rangeText}</span> : null
        )}
        <div className="fh-table-pagination__trailing">
          {hasSearch ? <span className="fh-table-pagination__range">{rangeText}</span> : null}
          {showPagination ? (
            <div className="fh-table-pagination__controls">
              <button
                type="button"
                className="fh-table-pagination__btn"
                disabled={props.page <= 1}
                onClick={() => props.onPageChange(props.page - 1)}
                aria-label={t('table.prevPage')}
              >
                <ChevronLeft size={16} strokeWidth={2.25} aria-hidden />
              </button>
              <span className="fh-table-pagination__page">
                {props.page} / {props.totalPages}
              </span>
              <button
                type="button"
                className="fh-table-pagination__btn"
                disabled={props.page >= props.totalPages}
                onClick={() => props.onPageChange(props.page + 1)}
                aria-label={t('table.nextPage')}
              >
                <ChevronRight size={16} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="fh-table-separator" aria-hidden="true" />
    </>
  );
}

export function TablePaginationBar(props: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  searchPlaceholder?: string;
}) {
  return <TableToolbar {...props} />;
}
