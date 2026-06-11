import { ChevronLeft, ChevronRight } from 'lucide-react';
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

export function TablePaginationBar(props: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useLocale();

  if (props.totalItems <= props.pageSize) return null;

  const from = (props.page - 1) * props.pageSize + 1;
  const to = Math.min(props.page * props.pageSize, props.totalItems);

  return (
    <>
      <div className="fh-table-pagination">
        <span className="fh-table-pagination__range">
          {t('table.paginationRange', { from, to, total: props.totalItems })}
        </span>
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
      </div>
      <div className="fh-table-separator" aria-hidden="true" />
    </>
  );
}
