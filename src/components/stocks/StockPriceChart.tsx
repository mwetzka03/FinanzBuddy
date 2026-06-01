import { useMemo, useRef, useState } from 'react';
import type { StockChartPoint } from '../../lib/types';
import { formatSignedEurAmount, formatSignedPct } from '../../lib/money';
import { useUi } from '../../lib/ui';

type StockPriceChartProps = {
  points: StockChartPoint[];
  referencePrice: number;
  referenceLabel: string;
  height?: number;
};

type PlotCoord = StockChartPoint & { x: number; y: number };

const WIDTH = 800;

function formatAxisDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function formatAxisTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function formatTooltipDate(ts: number, intraday: boolean): string {
  const d = new Date(ts * 1000);
  if (intraday) {
    return d.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function ChartTooltip(props: {
  clientX: number;
  clientY: number;
  dateLabel: string;
  price: number;
  deltaEur: number;
  deltaPct: number;
  deltaPositive: boolean;
  referenceLabel: string;
}) {
  const { colors } = useUi();
  const width = 168;
  const offset = 14;
  const left =
    props.clientX + offset + width > window.innerWidth - 8
      ? props.clientX - width - offset
      : props.clientX + offset;

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top: props.clientY - 12,
        zIndex: 50,
        pointerEvents: 'none',
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        background: colors.bgCard,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        fontSize: 12,
        lineHeight: 1.45,
        color: colors.text,
        width,
      }}
    >
      <div style={{ color: colors.textMuted, marginBottom: 4 }}>{props.dateLabel}</div>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{props.price.toFixed(2).replace('.', ',')} €</div>
      <div style={{ color: props.deltaPositive ? colors.amountPositive : colors.amountNegative, marginTop: 4 }}>
        {formatSignedEurAmount(props.deltaEur)} ({formatSignedPct(props.deltaPct)})
      </div>
      <div style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>vs. {props.referenceLabel}</div>
    </div>
  );
}

function splitSegmentsAtReference(
  coords: PlotCoord[],
  referencePrice: number,
  priceToY: (price: number) => number,
  positiveColor: string,
  negativeColor: string,
): { color: string; points: string }[] {
  if (coords.length === 0) return [];

  const segments: { color: string; points: PlotCoord[] }[] = [];
  let current: PlotCoord[] = [coords[0]];
  let currentPositive = coords[0].close >= referencePrice;

  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1];
    const cur = coords[i];
    const curPositive = cur.close >= referencePrice;

    if (curPositive !== currentPositive && prev.close !== cur.close) {
      const t = (referencePrice - prev.close) / (cur.close - prev.close);
      const cross: PlotCoord = {
        timestamp: prev.timestamp,
        close: referencePrice,
        x: prev.x + t * (cur.x - prev.x),
        y: priceToY(referencePrice),
      };
      current.push(cross);
      segments.push({
        color: currentPositive ? positiveColor : negativeColor,
        points: current,
      });
      current = [cross, cur];
      currentPositive = curPositive;
    } else {
      current.push(cur);
    }
  }

  segments.push({
    color: currentPositive ? positiveColor : negativeColor,
    points: current,
  });

  return segments.map((seg) => ({
    color: seg.color,
    points: seg.points.map((p) => `${p.x},${p.y}`).join(' '),
  }));
}

export function StockPriceChart(props: StockPriceChartProps) {
  const { colors } = useUi();
  const height = props.height ?? 220;
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ index: number; clientX: number; clientY: number } | null>(null);

  const layout = useMemo(() => {
    const padL = 56;
    const padR = 16;
    const padT = 16;
    const padB = 32;
    const innerW = WIDTH - padL - padR;
    const innerH = height - padT - padB;
    return { padL, padR, padT, padB, innerW, innerH };
  }, [height]);

  if (props.points.length < 2) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
        Keine Chart-Daten verfügbar.
      </div>
    );
  }

  const { padL, padT, padB, innerW, innerH } = layout;
  const referencePrice = props.referencePrice;
  const closes = props.points.map((p) => p.close);
  const min = Math.min(...closes, referencePrice);
  const max = Math.max(...closes, referencePrice);
  const span = max - min || 1;

  const priceToY = (price: number) => padT + innerH - ((price - min) / span) * innerH;

  const coords: PlotCoord[] = props.points.map((p, i) => {
    const x = padL + (i / (props.points.length - 1)) * innerW;
    const y = priceToY(p.close);
    return { x, y, ...p };
  });

  const lineSegments = splitSegmentsAtReference(
    coords,
    referencePrice,
    priceToY,
    colors.amountPositive,
    colors.amountNegative,
  );

  const refY = priceToY(referencePrice);
  const first = props.points[0].timestamp;
  const last = props.points[props.points.length - 1].timestamp;
  const intraday = last - first < 3 * 24 * 3600;
  const startLabel = intraday ? formatAxisTime(first) : formatAxisDate(first);
  const endLabel = intraday ? formatAxisTime(last) : formatAxisDate(last);
  const lastClose = closes[closes.length - 1];
  const endPositive = lastClose >= referencePrice;
  const activeStroke = endPositive ? colors.amountPositive : colors.amountNegative;

  function pickIndex(clientX: number): number | null {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const relX = clientX - rect.left;
    const plotLeft = (padL / WIDTH) * rect.width;
    const plotWidth = (innerW / WIDTH) * rect.width;
    const xInPlot = relX - plotLeft;
    if (xInPlot < 0 || xInPlot > plotWidth) return null;
    const ratio = xInPlot / plotWidth;
    return Math.min(props.points.length - 1, Math.max(0, Math.round(ratio * (props.points.length - 1))));
  }

  function onMouseMove(e: React.MouseEvent) {
    const index = pickIndex(e.clientX);
    if (index == null) {
      setHover(null);
      return;
    }
    setHover({ index, clientX: e.clientX, clientY: e.clientY });
  }

  const active = hover != null ? coords[hover.index] : null;
  const activeDelta = active ? active.close - referencePrice : 0;
  const activeDeltaPct = referencePrice !== 0 ? (activeDelta / referencePrice) * 100 : 0;
  const deltaPositive = activeDelta >= 0;
  const activeStrokeHover = active ? (active.close >= referencePrice ? colors.amountPositive : colors.amountNegative) : activeStroke;

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%' }}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" height={height} style={{ display: 'block' }}>
        <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke={colors.border} />
        <line x1={padL} y1={padT + innerH} x2={padL + innerW} y2={padT + innerH} stroke={colors.border} />
        <text x={padL - 6} y={padT + 4} textAnchor="end" fontSize="11" fill={colors.textMuted}>
          {max.toFixed(2)} €
        </text>
        <text x={padL - 6} y={padT + innerH} textAnchor="end" fontSize="11" fill={colors.textMuted}>
          {min.toFixed(2)} €
        </text>

        <line
          x1={padL}
          y1={refY}
          x2={padL + innerW}
          y2={refY}
          stroke={colors.textMuted}
          strokeWidth="1.25"
          strokeDasharray="6 4"
          opacity={0.85}
        />
        <text x={padL + innerW - 4} y={refY - 6} textAnchor="end" fontSize="10" fill={colors.textMuted}>
          {props.referenceLabel} · {referencePrice.toFixed(2).replace('.', ',')} €
        </text>

        {lineSegments.map((seg, idx) => (
          <polyline key={idx} fill="none" stroke={seg.color} strokeWidth="2" points={seg.points} />
        ))}

        {active && (
          <>
            <line
              x1={active.x}
              y1={padT}
              x2={active.x}
              y2={padT + innerH}
              stroke={colors.textMuted}
              strokeWidth="1"
              strokeDasharray="4 3"
              opacity={0.7}
            />
            <circle cx={active.x} cy={active.y} r="4.5" fill={activeStrokeHover} stroke={colors.bgCard} strokeWidth="2" />
          </>
        )}
        {!active && coords.length > 0 && (
          <circle
            cx={coords[coords.length - 1].x}
            cy={coords[coords.length - 1].y}
            r="3.5"
            fill={activeStroke}
          />
        )}
        <text x={padL} y={height - 8} fontSize="11" fill={colors.textMuted}>
          {startLabel}
        </text>
        <text x={padL + innerW} y={height - 8} textAnchor="end" fontSize="11" fill={colors.textMuted}>
          {endLabel}
        </text>
        <rect x={padL} y={padT} width={innerW} height={innerH} fill="transparent" style={{ cursor: 'crosshair' }} />
      </svg>

      {hover && active && (
        <ChartTooltip
          clientX={hover.clientX}
          clientY={hover.clientY}
          dateLabel={formatTooltipDate(active.timestamp, intraday)}
          price={active.close}
          deltaEur={activeDelta}
          deltaPct={activeDeltaPct}
          deltaPositive={deltaPositive}
          referenceLabel={props.referenceLabel}
        />
      )}
    </div>
  );
}
