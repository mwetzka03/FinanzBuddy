import { useLayoutEffect, useState, type RefObject } from 'react';

export type AmountBandRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function useAmountColumnBands(tableRef: RefObject<HTMLElement | null>) {
  const [bands, setBands] = useState<AmountBandRect[]>([]);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    function measure() {
      const tableEl = tableRef.current;
      if (!tableEl) return;

      const rows = tableEl.querySelectorAll<HTMLElement>('.fh-table-row');
      if (rows.length === 0) {
        setBands([]);
        return;
      }

      const tableRect = tableEl.getBoundingClientRect();
      const firstRow = rows[0];
      const lastRow = rows[rows.length - 1];
      const firstRowRect = firstRow.getBoundingClientRect();
      const lastRowRect = lastRow.getBoundingClientRect();

      let minLeft = Infinity;
      let maxRight = -Infinity;

      rows.forEach((row) => {
        row.querySelectorAll<HTMLElement>('[data-amount-col]').forEach((cell) => {
          const rect = cell.getBoundingClientRect();
          minLeft = Math.min(minLeft, rect.left);
          maxRight = Math.max(maxRight, rect.right);
        });
      });

      if (minLeft === Infinity) {
        setBands([]);
        return;
      }

      const left = Math.max(0, minLeft - tableRect.left);
      const right = Math.min(tableRect.width, maxRight - tableRect.left);
      const top = Math.max(0, firstRowRect.top - tableRect.top);

      setBands([
        {
          left,
          top,
          width: Math.max(0, right - left),
          height: Math.max(0, lastRowRect.bottom - tableRect.top - top),
        },
      ]);
    }

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(table);

    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(table, { childList: true, subtree: true, attributes: true });

    const scrollParent = table.closest('.fh-table-scroll');
    scrollParent?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      scrollParent?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [tableRef]);

  return bands;
}
