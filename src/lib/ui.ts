import { type CSSProperties } from 'react';
import { useTheme } from './theme';

export function useUi() {
  const { colors, mode, toggle } = useTheme();

  const shadowSm = mode === 'dark' ? '0 2px 8px rgba(0,0,0,0.25)' : '0 2px 10px rgba(30, 58, 138, 0.06)';
  const shadowMd = mode === 'dark' ? '0 8px 28px rgba(0,0,0,0.35)' : '0 10px 32px rgba(30, 58, 138, 0.1)';
  const shadowLg = mode === 'dark' ? '0 16px 48px rgba(0,0,0,0.45)' : '0 20px 50px rgba(30, 58, 138, 0.12)';

  const btn: CSSProperties = {
    padding: '9px 16px',
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: `linear-gradient(180deg, ${colors.bgCard} 0%, ${colors.bgMuted} 100%)`,
    color: colors.accentDark,
    cursor: 'pointer',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    boxShadow: shadowSm,
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  };

  const btnPrimary: CSSProperties = {
    padding: '10px 18px',
    borderRadius: 10,
    border: 'none',
    background: `linear-gradient(135deg, ${colors.accent} 0%, ${colors.accentDark} 100%)`,
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    boxShadow: `0 6px 20px ${colors.accent}44`,
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  };

  const btnGhost: CSSProperties = {
    ...btn,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    boxShadow: 'none',
  };

  const input: CSSProperties = {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: colors.bgCard,
    color: colors.text,
    boxShadow: 'inset 0 1px 2px rgba(15, 23, 42, 0.04)',
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
    border: `1px solid ${colors.border}`,
    borderRadius: 16,
    padding: 18,
    background: colors.bgCard,
    minWidth: 0,
    boxShadow: shadowSm,
  };

  const statCard: CSSProperties = {
    ...card,
    background: `linear-gradient(145deg, ${colors.bgCard} 0%, ${colors.amountColumnBg} 100%)`,
    border: `1px solid ${colors.accent}22`,
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
    border: `1px solid ${colors.border}`,
    borderRadius: 16,
    overflow: 'hidden',
    background: colors.bgCard,
    width: '100%',
    minWidth: 0,
    boxShadow: shadowSm,
  };

  const tableScroll: CSSProperties = {
    overflowX: 'auto',
    width: '100%',
    minWidth: 0,
  };

  const tableHead: CSSProperties = {
    display: 'grid',
    padding: '14px 18px',
    background: `linear-gradient(180deg, ${colors.bgMuted} 0%, ${colors.bgCard} 100%)`,
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: colors.textMuted,
    gap: 12,
    columnGap: 16,
    minWidth: 0,
    alignItems: 'center',
    textAlign: 'left',
  };

  const tableRow: CSSProperties = {
    display: 'grid',
    padding: '14px 18px',
    gap: 12,
    columnGap: 16,
    alignItems: 'center',
    minWidth: 0,
    borderTop: `1px solid ${colors.border}`,
    transition: 'background 0.12s ease',
  };

  const pageTitle: CSSProperties = {
    margin: '0 0 8px',
    fontSize: 'clamp(1.5rem, 2.5vw, 1.875rem)',
    fontWeight: 800,
    letterSpacing: '-0.03em',
    lineHeight: 1.15,
    background: `linear-gradient(135deg, ${colors.accentDark} 0%, ${colors.accent} 100%)`,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
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
    color: colors.textMuted,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
  };

  const thName: CSSProperties = { textAlign: 'left', textTransform: 'none', letterSpacing: 'normal', fontSize: 13 };
  const thCenter: CSSProperties = { ...thName, textAlign: 'center' };
  const thMono: CSSProperties = { ...thName, fontFamily: 'ui-monospace, monospace' };
  const tdName: CSSProperties = { textAlign: 'left', minWidth: 0 };

  const detailLink: CSSProperties = {
    color: colors.accentDark,
    fontWeight: 600,
    textDecoration: 'none',
    transition: 'color 0.15s ease',
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
    fontWeight: 700,
    color: colors.text,
    position: 'relative',
    paddingLeft: 14,
    paddingRight: 14,
  };

  function tdAmountText(amountCents?: number, neutral = false): CSSProperties {
    if (neutral) {
      return {
        textAlign: 'center',
        fontFamily: 'ui-monospace, monospace',
        fontWeight: 700,
        fontSize: 13,
        color: colors.text,
        position: 'relative',
        paddingLeft: 14,
        paddingRight: 14,
      };
    }
    const positive = amountCents == null ? true : amountCents > 0;
    const zero = amountCents === 0;
    return {
      textAlign: 'center',
      fontFamily: 'ui-monospace, monospace',
      fontWeight: 700,
      fontSize: 13,
      color: zero ? colors.textMuted : positive ? colors.amountPositive : colors.amountNegative,
      position: 'relative',
      paddingLeft: 14,
      paddingRight: 14,
    };
  }

  /** @deprecated use TdAmount component with AmountTable */
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
    borderRadius: 14,
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
    border: `1px solid ${colors.accent}18`,
    boxShadow: shadowMd,
  };

  const listPanel: CSSProperties = {
    ...card,
    marginBottom: 28,
    position: 'relative',
    border: `1px solid ${colors.accent}18`,
    boxShadow: shadowMd,
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
    background: colors.bgCard,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
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
