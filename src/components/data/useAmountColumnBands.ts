import { useLayoutEffect, useState, type RefObject } from 'react';

export type AmountBandRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Extra space around measured amount cells so the band does not hug the text. */
const BAND_PAD_X = 10;
const BAND_PAD_Y = 12;

export function useAmountColumnBands(tableRef: RefObject<HTMLElement | null>) {
  const [bands, setBands] = useState<AmountBandRect[]>([]);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    function measure() {
      const tableEl = tableRef.current;
      if (!tableEl) return;

      const tableRect = tableEl.getBoundingClientRect();
      const seenCols = new Set<string>();
      const next: AmountBandRect[] = [];

      tableEl.querySelectorAll<HTMLElement>('[data-amount-col]:not([data-amount-header])').forEach((marker) => {
        const colIndex = marker.dataset.amountCol;
        if (!colIndex || seenCols.has(colIndex)) return;
        seenCols.add(colIndex);

        const cells = tableEl.querySelectorAll<HTMLElement>(
          `[data-amount-col="${colIndex}"]:not([data-amount-header])`,
        );
        if (cells.length === 0) return;

        let minLeft = Infinity;
        let maxRight = -Infinity;
        let minTop = Infinity;
        let maxBottom = -Infinity;

        cells.forEach((cell) => {
          const rect = cell.getBoundingClientRect();
          minLeft = Math.min(minLeft, rect.left);
          maxRight = Math.max(maxRight, rect.right);
          minTop = Math.min(minTop, rect.top);
          maxBottom = Math.max(maxBottom, rect.bottom);
        });

        if (minLeft === Infinity) return;

        const left = Math.max(0, minLeft - tableRect.left - BAND_PAD_X);
        const top = Math.max(0, minTop - tableRect.top - BAND_PAD_Y);
        const right = Math.min(tableRect.width, maxRight - tableRect.left + BAND_PAD_X);
        const bottom = Math.min(tableRect.height, maxBottom - tableRect.top + BAND_PAD_Y);

        next.push({
          left,
          top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        });
      });

      setBands(next);
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
