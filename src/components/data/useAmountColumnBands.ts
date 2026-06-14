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

    let raf = 0;

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

      tableEl.querySelectorAll<HTMLElement>('[data-amount-col]').forEach((cell) => {
        const rect = cell.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        minLeft = Math.min(minLeft, rect.left);
        maxRight = Math.max(maxRight, rect.right);
      });

      if (minLeft === Infinity) {
        setBands([]);
        return;
      }

      const headCells = tableEl.querySelectorAll<HTMLElement>('.fh-table-head [data-amount-col]');
      const topFromHead =
        headCells.length > 0
          ? Math.min(...Array.from(headCells).map((cell) => cell.getBoundingClientRect().top))
          : firstRowRect.top;

      const left = Math.max(0, minLeft - tableRect.left);
      const right = Math.min(tableRect.width, maxRight - tableRect.left);
      const top = Math.max(0, topFromHead - tableRect.top);

      setBands([
        {
          left,
          top,
          width: Math.max(0, right - left),
          height: Math.max(0, lastRowRect.bottom - tableRect.top - top),
        },
      ]);
    }

    function scheduleMeasure() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        measure();
        requestAnimationFrame(measure);
      });
    }

    scheduleMeasure();
    document.fonts?.ready.then(scheduleMeasure).catch(() => undefined);

    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(table);

    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(table, { childList: true, subtree: true, attributes: true });

    const scrollParent = table.closest('.fh-table-scroll');
    scrollParent?.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      mutationObserver.disconnect();
      scrollParent?.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [tableRef]);

  return bands;
}
