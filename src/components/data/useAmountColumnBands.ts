import { useLayoutEffect, useState, type RefObject } from 'react';

export type AmountBandRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Minimal horizontal padding around the widest amount text in the band. */
const BAND_PAD_X = 3;

export function useAmountColumnBands(tableRef: RefObject<HTMLElement | null>) {
  const [bands, setBands] = useState<AmountBandRect[]>([]);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    function measure() {
      const tableEl = tableRef.current;
      if (!tableEl) return;

      const cells = tableEl.querySelectorAll<HTMLElement>('.fh-table-row [data-amount-col]');
      if (cells.length === 0) {
        setBands([]);
        return;
      }

      const tableRect = tableEl.getBoundingClientRect();

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

      if (minLeft === Infinity || minTop === Infinity) {
        setBands([]);
        return;
      }

      const left = Math.max(0, minLeft - tableRect.left - BAND_PAD_X);
      const right = Math.min(tableRect.width, maxRight - tableRect.left + BAND_PAD_X);
      const top = Math.max(0, minTop - tableRect.top);

      setBands([
        {
          left,
          top,
          width: Math.max(0, right - left),
          height: Math.max(0, maxBottom - minTop),
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
