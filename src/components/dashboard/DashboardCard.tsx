import { useState } from 'react';
import { useUi } from '../../lib/ui';

export function DashboardCard(props: {
  title: string;
  value: string;
  valueColor?: string;
  subtitle?: string;
  subtitleColor?: string;
  info?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const { statCard, colors } = useUi();
  const [hintOpen, setHintOpen] = useState(false);
  const clickable = Boolean(props.onClick);

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={props.onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                props.onClick?.();
              }
            }
          : undefined
      }
      style={{
        ...statCard,
        position: 'relative',
        overflow: 'visible',
        zIndex: hintOpen || props.active ? 40 : 1,
        cursor: clickable ? 'pointer' : undefined,
        border: props.active ? `2px solid ${colors.accent}` : statCard.border,
        boxShadow: props.active ? `0 0 0 3px ${colors.accentSoft}` : statCard.boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
      className={`fh-stat-card${hintOpen ? ' fh-stat-card--hint-open' : ''}`}
    >
      {props.info && (
        <span
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 3 }}
          onMouseEnter={() => setHintOpen(true)}
          onMouseLeave={() => setHintOpen(false)}
        >
          <span
            aria-label="Information"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: '50%',
              border: `1px solid ${colors.border}`,
              fontSize: 11,
              fontWeight: 700,
              fontStyle: 'italic',
              fontFamily: 'Georgia, serif',
              color: colors.textMuted,
              background: colors.bgCard,
              cursor: 'help',
              userSelect: 'none',
            }}
          >
            i
          </span>
          {hintOpen && (
            <span
              role="tooltip"
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 6,
                width: 'min(260px, 70vw)',
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: colors.bgCard,
                boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
                fontSize: 12,
                fontWeight: 400,
                lineHeight: 1.45,
                color: colors.text,
                zIndex: 9999,
              }}
            >
              {props.info}
            </span>
          )}
        </span>
      )}
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: colors.textMuted,
          paddingRight: props.info ? 22 : 0,
        }}
      >
        {props.title}
      </div>
      <div
        style={{
          fontSize: 'clamp(1.1rem, 2vw, 1.35rem)',
          fontWeight: 800,
          marginTop: 8,
          letterSpacing: '-0.02em',
          color: props.valueColor ?? colors.accentDark,
        }}
      >
        {props.value}
      </div>
      {props.subtitle && (
        <div style={{ fontSize: 12, marginTop: 6, color: props.subtitleColor ?? colors.textMuted }}>{props.subtitle}</div>
      )}
    </div>
  );
}

export function formatDelta(cents: number): string {
  const prefix = cents >= 0 ? '+' : '−';
  const abs = Math.abs(cents);
  const eur = (abs / 100).toFixed(2).replace('.', ',');
  return `${prefix}${eur} €`;
}
