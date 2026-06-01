import type { RefObject } from 'react';
import { useAmountColumnBands } from './useAmountColumnBands';

export function AmountBandLayer({ tableRef }: { tableRef: RefObject<HTMLElement | null> }) {
  const bands = useAmountColumnBands(tableRef);

  if (bands.length === 0) return null;

  return (
    <div className="fh-amount-band-layer" aria-hidden="true">
      {bands.map((band, index) => (
        <div
          key={index}
          className="fh-amount-band"
          style={{
            left: band.left,
            top: band.top,
            width: band.width,
            height: band.height,
          }}
        />
      ))}
    </div>
  );
}
