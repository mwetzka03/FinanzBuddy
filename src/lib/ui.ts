import { type CSSProperties } from 'react';
import { useTheme } from './theme';

export function useUi() {
  const { colors, mode, toggle } = useTheme();

  const shadowSm =
    mode === 'dark'
      ? '0 2px 12px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.06)'
      : '0 2px 12px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255,255,255,0.75)';
  const shadowMd =
    mode === 'dark'
      ? '0 12px 40px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255,255,255,0.06)'
      : '0 12px 36px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255,255,255,0.8)';
  const shadowLg =
    mode === 'dark'
      ? '0 24px 64px rgba(0, 0, 0, 0.55)'
      : '0 24px 64px rgba(0, 0, 0, 0.14)';

  const glassSurface: CSSProperties = {
    background: colors.glassElevated,
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: `1px solid ${colors.glassBorder}`,
    boxShadow: colors.shadowGlass,
  };

  const btn: CSSProperties = {
    padding: '9px 16px',
    borderRadius: 999,
    border: `1px solid ${colors.glassBorder}`,
    background: colors.glass,
    backdropFilter: 'blur(20px) saturate(160%)',
    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
    color: colors.text,
    cursor: 'pointer',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    boxShadow: shadowSm,
    transition: 'transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
  };

  const btnPrimary: CSSProperties = {
    padding: '10px 18px',
    borderRadius: 999,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    boxShadow: `0 4px 16px color-mix(in srgb, ${colors.accent} 35%, transparent)`,
    transition: 'transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease',
  };

  const btnGhost: CSSProperties = {
    ...btn,
    background: 'transparent',
    boxShadow: 'none',
  };

  const input: CSSProperties = {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 12,
    border: `1px solid ${colors.glassBorder}`,
    background: colors.bgMuted,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    color: colors.text,
    boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.04)',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  };

  const field: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 0,
  };

  const formGrid: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 16,
    alignItems: 'end',
  };

  const card: CSSProperties = {
    ...glassSurface,
    borderRadius: 20,
    padding: 18,
    minWidth: 0,
  };

  const statCard: CSSProperties = {
    ...card,
    background: colors.glassElevated,
    border: `1px solid ${colors.glassBorder}`,
  };

  const page: CSSProperties = {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
  };

  const pageNarrow: CSSProperties = {
    width: '100%',
    maxWidth: 'min(100%, 960px)',
    minWidth: 0,
  };

  const table: CSSProperties = {
    ...glassSurface,
    borderRadius: 20,
    overflow: 'hidden',
    width: '100%',
    minWidth: 0,
  };

  const tableScroll: CSSProperties = {
    overflowX: 'auto',
    width: '100%',
    minWidth: 0,
  };

  const tableHead: CSSProperties = {
    display: 'grid',
    padding: '12px 20px',
    background: `color-mix(in srgb, ${colors.bgMuted} 88%, transparent)`,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    fontWeight: 600,
    fontSize: 13,
    letterSpacing: '-0.01em',
    textTransform: 'none',
    color: colors.textMuted,
    gap: 12,
    columnGap: 20,
    minWidth: 0,
    alignItems: 'center',
    textAlign: 'left',
    borderBottom: `1px solid ${colors.glassBorder}`,
  };

  const tableRow: CSSProperties = {
    display: 'grid',
    padding: '14px 20px',
    gap: 12,
    columnGap: 20,
    alignItems: 'center',
    minWidth: 0,
    borderTop: `1px solid color-mix(in srgb, ${colors.glassBorder} 65%, transparent)`,
    transition: 'background 0.12s ease',
  };

  function tableRowAccent(accentColor: string): CSSProperties {
    return {
      borderLeft: `4px solid ${accentColor}`,
      background: `color-mix(in srgb, ${accentColor} 12%, ${colors.bgCard})`,
    };
  }

  const pageTitle: CSSProperties = {
    margin: '0 0 8px',
    fontSize: 'clamp(1.5rem, 2.5vw, 1.875rem)',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.15,
    color: colors.text,
  };

  const sectionTitle: CSSProperties = {
    margin: '0 0 14px',
    fontSize: 15,
    fontWeight: 700,
    color: colors.text,
    letterSpacing: '-0.01em',
  };

  const backLink: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    color: colors.accent,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
  };

  const thName: CSSProperties = { textAlign: 'left', textTransform: 'none', letterSpacing: 'normal', fontSize: 13 };
  const thCenter: CSSProperties = { ...thName, textAlign: 'center' };
  const thMono: CSSProperties = { ...thName, fontFamily: 'ui-monospace, monospace' };
  const tdName: CSSProperties = { textAlign: 'left', minWidth: 0 };

  const detailLink: CSSProperties = {
    color: colors.accent,
    fontWeight: 600,
    textDecoration: 'none',
    transition: 'opacity 0.15s ease',
  };

  const nameLink: CSSProperties = detailLink;

  const sectionHint: CSSProperties = {
    margin: '0 0 14px',
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 1.5,
  };

  const rowPreview: CSSProperties = {
    padding: '0 18px 14px',
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'left',
    lineHeight: 1.5,
  };

  const thAmount: CSSProperties = {
    textAlign: 'center',
    fontFamily: 'ui-monospace, monospace',
    textTransform: 'none',
    letterSpacing: 'normal',
    fontSize: 13,
    fontWeight: 600,
    color: colors.textMuted,
    position: 'relative',
    paddingLeft: 4,
    paddingRight: 4,
    justifySelf: 'stretch',
  };

  function tdAmountText(amountCents?: number, neutral = false): CSSProperties {
    if (neutral) {
      return {
        textAlign: 'center',
        fontFamily: 'ui-monospace, monospace',
        fontWeight: 600,
        fontSize: 13,
        color: colors.text,
        position: 'relative',
        paddingLeft: 4,
        paddingRight: 4,
        justifySelf: 'stretch',
      };
    }
    const positive = amountCents == null ? true : amountCents > 0;
    const zero = amountCents === 0;
    return {
      textAlign: 'center',
      fontFamily: 'ui-monospace, monospace',
      fontWeight: 600,
      fontSize: 13,
      color: zero ? colors.textMuted : positive ? colors.amountPositive : colors.amountNegative,
      position: 'relative',
      paddingLeft: 4,
      paddingRight: 4,
      justifySelf: 'stretch',
    };
  }

  function tdAmount(_isLast = false, amountCents?: number): CSSProperties {
    return tdAmountText(amountCents);
  }

  const tdCenter: CSSProperties = { textAlign: 'center' };
  const tdMono: CSSProperties = { textAlign: 'left', fontFamily: 'ui-monospace, monospace', fontSize: 13 };
  const tdActions: CSSProperties = {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  };
  const tdReal: CSSProperties = { textAlign: 'left' };
  const emptyRow: CSSProperties = { padding: 24, color: colors.textMuted, textAlign: 'center', fontSize: 14 };

  const cellStack: CSSProperties = {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  };

  const cellSub: CSSProperties = {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const label: CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: colors.textMuted,
    letterSpacing: '0.02em',
  };

  const errorBox: CSSProperties = {
    padding: '14px 16px',
    border: `1px solid ${colors.dangerBorder}`,
    background: colors.dangerBg,
    backdropFilter: 'blur(12px)',
    borderRadius: 16,
    marginBottom: 16,
    color: colors.text,
    boxShadow: shadowSm,
  };

  const toolbar: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 12,
  };

  const formPanel: CSSProperties = {
    ...card,
    marginBottom: 28,
    position: 'relative',
    zIndex: 2,
    overflow: 'visible',
  };

  const listPanel: CSSProperties = {
    ...card,
    marginBottom: 28,
    position: 'relative',
  };

  const pageIntro: CSSProperties = {
    color: colors.textMuted,
    fontSize: 14,
    margin: '0 0 20px',
    lineHeight: 1.55,
    maxWidth: '72ch',
  };

  const suggestPopover: CSSProperties = {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 6,
    zIndex: 30,
    background: colors.glassElevated,
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: `1px solid ${colors.glassBorder}`,
    borderRadius: 14,
    boxShadow: shadowLg,
    maxHeight: 260,
    overflowY: 'auto',
  };

  return {
    colors,
    mode,
    toggle,
    btn,
    btnPrimary,
    btnGhost,
    input,
    field,
    formGrid,
    card,
    statCard,
    page,
    pageNarrow,
    formPanel,
    listPanel,
    pageIntro,
    table,
    tableScroll,
    tableHead,
    tableRow,
    tableRowAccent,
    pageTitle,
    sectionTitle,
    backLink,
    thName,
    thCenter,
    thMono,
    tdName,
    nameLink,
    detailLink,
    sectionHint,
    rowPreview,
    thAmount,
    tdAmountText,
    tdAmount,
    tdCenter,
    tdMono,
    tdActions,
    tdReal,
    emptyRow,
    cellStack,
    cellSub,
    label,
    errorBox,
    toolbar,
    suggestPopover,
  };
}
