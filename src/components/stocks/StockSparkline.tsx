import { useMemo } from 'react';
import type { StockChartPoint } from '../../lib/types';
import { useUi } from '../../lib/ui';

type StockSparklineProps = {
  points: StockChartPoint[];
  referencePrice: number;
  width?: number;
  height?: number;
};

export function StockSparkline({ points, referencePrice, width = 72, height = 28 }: StockSparklineProps) {
  const { colors } = useUi();

  const path = useMemo(() => {
    if (points.length < 2) return null;
    const closes = points.map((p) => p.close);
    const min = Math.min(...closes, referencePrice);
    const max = Math.max(...closes, referencePrice);
    const span = max - min || 1;
    const pad = 2;
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;

    const coords = points.map((p, i) => {
      const x = pad + (i / (points.length - 1)) * innerW;
      const y = pad + innerH - ((p.close - min) / span) * innerH;
      return `${x},${y}`;
    });

    const lastClose = closes[closes.length - 1];
    const stroke = lastClose >= referencePrice ? colors.amountPositive : colors.amountNegative;

    return { points: coords.join(' '), stroke };
  }, [points, referencePrice, width, height, colors.amountPositive, colors.amountNegative]);

  if (!path) {
    return (
      <div
        style={{
          width,
          height,
          borderRadius: 6,
          background: colors.bgMuted,
          flexShrink: 0,
        }}
        aria-hidden
      />
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', flexShrink: 0 }}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={path.stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={path.points}
      />
    </svg>
  );
}
