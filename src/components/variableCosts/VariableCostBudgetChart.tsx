import { useUi } from '../../lib/ui';

import { formatExpenseEurFromCents } from '../../lib/money';



type VariableCostBudgetChartProps = {

  forecastCents: number;

  actualCents: number;

  size?: number;

};



function polar(cx: number, cy: number, r: number, angleDeg: number) {

  const rad = ((angleDeg - 90) * Math.PI) / 180;

  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };

}



function arcPath(cx: number, cy: number, r: number, start: number, end: number) {

  const s = polar(cx, cy, r, end);

  const e = polar(cx, cy, r, start);

  const large = end - start <= 180 ? 0 : 1;

  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y} Z`;

}



/** Kuchendiagramm: Verhältnis Prognose vs. tatsächlich gebucht. */

export function VariableCostBudgetChart({ forecastCents, actualCents, size = 168 }: VariableCostBudgetChartProps) {

  const ui = useUi();

  const cx = size / 2;

  const cy = size / 2;

  const r = size * 0.38;

  const inner = size * 0.22;



  const forecast = Math.max(0, forecastCents);

  const actual = Math.max(0, actualCents);

  const within = forecast > 0 ? Math.min(actual, forecast) : actual;

  const open = forecast > 0 ? Math.max(0, forecast - actual) : 0;

  const over = forecast > 0 ? Math.max(0, actual - forecast) : 0;



  const total = Math.max(forecast, actual, 1);

  const actualAngle = (within / total) * 360;

  const openAngle = (open / total) * 360;

  const overAngle = (over / total) * 360;



  let cursor = 0;

  const segments: { path: string; color: string; label: string }[] = [];



  if (within > 0) {

    segments.push({

      path: arcPath(cx, cy, r, cursor, cursor + actualAngle),

      color: ui.colors.accent,

      label: `Tatsächlich ${formatExpenseEurFromCents(within)}`,

    });

    cursor += actualAngle;

  }

  if (open > 0) {

    segments.push({

      path: arcPath(cx, cy, r, cursor, cursor + openAngle),

      color: ui.colors.border,

      label: `Prognose offen ${formatExpenseEurFromCents(open)}`,

    });

    cursor += openAngle;

  }

  if (over > 0) {

    segments.push({

      path: arcPath(cx, cy, r, cursor, cursor + overAngle),

      color: ui.colors.amountNegative,

      label: `Über Prognose ${formatExpenseEurFromCents(over)}`,

    });

  }

  if (segments.length === 0) {

    segments.push({

      path: arcPath(cx, cy, r, 0, 359.9),

      color: ui.colors.border,

      label: 'Keine Werte',

    });

  }



  return (

    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>

      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Prognose und tatsächliche Kosten">

        {segments.map((seg, i) => (

          <path key={i} d={seg.path} fill={seg.color} opacity={0.92} />

        ))}

        <circle cx={cx} cy={cy} r={inner} fill={ui.colors.bgCard} />

        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="10" fill={ui.colors.textMuted}>

          Ist / Plan

        </text>

        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="12" fontWeight="700" fill={ui.colors.text}>

          {formatExpenseEurFromCents(actual)}

        </text>

      </svg>

      <div style={{ display: 'grid', gap: 8, minWidth: 180 }}>

        <div style={{ fontSize: 13 }}>

          <strong>Prognose:</strong> {formatExpenseEurFromCents(forecast)}

        </div>

        <div style={{ fontSize: 13 }}>

          <strong>Tatsächlich:</strong> {formatExpenseEurFromCents(actual)}

        </div>

        {segments.map((seg) => (

          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>

            <span style={{ width: 10, height: 10, borderRadius: 999, background: seg.color, flexShrink: 0 }} />

            <span>{seg.label}</span>

          </div>

        ))}

      </div>

    </div>

  );

}

