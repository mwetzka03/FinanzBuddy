import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  bg: string;
  bgCard: string;
  bgMuted: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  accentDark: string;
  accentSoft: string;
  shop: string;
  coin: string;
  coinSoft: string;
  amountPositive: string;
  amountNegative: string;
  amountColumnBg: string;
  dangerBg: string;
  dangerBorder: string;
  navActive: string;
  navBubbleText: string;
  glass: string;
  glassElevated: string;
  glassBorder: string;
  glassHighlight: string;
  shadowGlass: string;
}

/** Apple-inspired Liquid Glass palettes (macOS vibrancy). */
const light: ThemeColors = {
  bg: '#e8ecf4',
  bgCard: 'rgba(255, 255, 255, 0.62)',
  bgMuted: 'rgba(255, 255, 255, 0.42)',
  text: '#1d1d1f',
  textMuted: '#6e6e73',
  border: 'rgba(255, 255, 255, 0.55)',
  accent: '#007aff',
  accentDark: '#0051d5',
  accentSoft: 'rgba(0, 122, 255, 0.14)',
  shop: '#ff2d55',
  coin: '#ff9500',
  coinSoft: 'rgba(255, 149, 0, 0.16)',
  amountPositive: '#248a3d',
  amountNegative: '#d70015',
  amountColumnBg: 'rgba(0, 122, 255, 0.08)',
  dangerBg: 'rgba(255, 59, 48, 0.12)',
  dangerBorder: 'rgba(255, 59, 48, 0.35)',
  navActive: 'rgba(0, 122, 255, 0.16)',
  navBubbleText: '#007aff',
  glass: 'rgba(255, 255, 255, 0.58)',
  glassElevated: 'rgba(255, 255, 255, 0.78)',
  glassBorder: 'rgba(255, 255, 255, 0.72)',
  glassHighlight: 'rgba(255, 255, 255, 0.92)',
  shadowGlass: '0 8px 32px rgba(0, 0, 0, 0.08), 0 1px 0 rgba(255, 255, 255, 0.65) inset',
};

const dark: ThemeColors = {
  bg: '#0a0a0c',
  bgCard: 'rgba(44, 44, 46, 0.62)',
  bgMuted: 'rgba(58, 58, 60, 0.52)',
  text: '#f5f5f7',
  textMuted: '#98989d',
  border: 'rgba(255, 255, 255, 0.12)',
  accent: '#0a84ff',
  accentDark: '#409cff',
  accentSoft: 'rgba(10, 132, 255, 0.22)',
  shop: '#ff375f',
  coin: '#ff9f0a',
  coinSoft: 'rgba(255, 159, 10, 0.18)',
  amountPositive: '#30d158',
  amountNegative: '#ff453a',
  amountColumnBg: 'rgba(10, 132, 255, 0.14)',
  dangerBg: 'rgba(255, 69, 58, 0.16)',
  dangerBorder: 'rgba(255, 69, 58, 0.4)',
  navActive: 'rgba(10, 132, 255, 0.24)',
  navBubbleText: '#64d2ff',
  glass: 'rgba(44, 44, 46, 0.58)',
  glassElevated: 'rgba(58, 58, 60, 0.78)',
  glassBorder: 'rgba(255, 255, 255, 0.14)',
  glassHighlight: 'rgba(255, 255, 255, 0.08)',
  shadowGlass: '0 12px 40px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.06) inset',
};

function applyThemeVars(mode: ThemeMode, colors: ThemeColors) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.background = colors.bg;
  root.style.color = colors.text;

  const vars: Record<string, string> = {
    '--fh-bg': colors.bg,
    '--fh-text': colors.text,
    '--fh-border': colors.border,
    '--fh-bg-card': colors.bgCard,
    '--fh-bg-muted': colors.bgMuted,
    '--fh-text-muted': colors.textMuted,
    '--fh-accent': colors.accent,
    '--fh-accent-dark': colors.accentDark,
    '--fh-accent-soft': colors.accentSoft,
    '--fh-shop': colors.shop,
    '--fh-coin': colors.coin,
    '--fh-coin-soft': colors.coinSoft,
    '--fh-amount-positive': colors.amountPositive,
    '--fh-amount-negative': colors.amountNegative,
    '--fh-danger': colors.amountNegative,
    '--fh-danger-bg': colors.dangerBg,
    '--fh-danger-border': colors.dangerBorder,
    '--fh-nav-active': colors.navActive,
    '--fh-nav-bubble-text': colors.navBubbleText,
    '--fh-glass': colors.glass,
    '--fh-glass-elevated': colors.glassElevated,
    '--fh-glass-border': colors.glassBorder,
    '--fh-glass-highlight': colors.glassHighlight,
    '--fh-shadow-glass': colors.shadowGlass,
    '--fh-glass-blur': '40px',
    '--fh-glass-saturate': '180%',
    '--fh-amount-bg':
      mode === 'dark' ? 'rgba(10, 132, 255, 0.18)' : 'rgba(0, 122, 255, 0.1)',
    '--fh-amount-border':
      mode === 'dark' ? 'rgba(10, 132, 255, 0.45)' : 'rgba(0, 122, 255, 0.28)',
    '--fh-scrollbar-size': '10px',
    '--fh-scrollbar-track':
      mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
    '--fh-scrollbar-thumb':
      mode === 'dark' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.18)',
    '--fh-scrollbar-thumb-hover':
      mode === 'dark' ? 'rgba(255, 255, 255, 0.34)' : 'rgba(0, 0, 0, 0.28)',
  };

  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('finanzbuddy-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  const colors = mode === 'dark' ? dark : light;

  useEffect(() => {
    localStorage.setItem('finanzbuddy-theme', mode);
    applyThemeVars(mode, colors);
  }, [mode, colors]);

  const value = useMemo(
    () => ({
      mode,
      colors,
      setMode: (next: ThemeMode) => setMode(next),
      toggle: () => setMode((m) => (m === 'light' ? 'dark' : 'light')),
    }),
    [mode, colors],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
