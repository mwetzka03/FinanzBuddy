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
}

const light: ThemeColors = {
  bg: '#f8fafc',
  bgCard: '#ffffff',
  bgMuted: '#f1f5f9',
  text: '#0f172a',
  textMuted: '#64748b',
  border: '#e2e8f0',
  accent: '#7c3aed',
  accentDark: '#1e3a8a',
  accentSoft: '#ede9fe',
  shop: '#ec4899',
  coin: '#f59e0b',
  coinSoft: '#fef3c7',
  amountPositive: '#15803d',
  amountNegative: '#dc2626',
  amountColumnBg: 'rgba(124, 58, 237, 0.06)',
  dangerBg: '#fef2f2',
  dangerBorder: '#fecaca',
  navActive: '#ede9fe',
  navBubbleText: '#4338ca',
};

const dark: ThemeColors = {
  bg: '#0b1220',
  bgCard: '#1e293b',
  bgMuted: '#334155',
  text: '#f1f5f9',
  textMuted: '#94a3b8',
  border: '#334155',
  accent: '#a78bfa',
  accentDark: '#3b82f6',
  accentSoft: '#312e81',
  shop: '#f472b6',
  coin: '#fbbf24',
  coinSoft: '#422006',
  amountPositive: '#22c55e',
  amountNegative: '#ef4444',
  amountColumnBg: 'rgba(167, 139, 250, 0.12)',
  dangerBg: '#450a0a',
  dangerBorder: '#7f1d1d',
  navActive: '#312e81',
  navBubbleText: '#c4b5fd',
};

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
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.background = colors.bg;
    document.documentElement.style.color = colors.text;
    document.documentElement.style.setProperty('--fh-bg', colors.bg);
    document.documentElement.style.setProperty('--fh-text', colors.text);
    document.documentElement.style.setProperty('--fh-border', colors.border);
    document.documentElement.style.setProperty('--fh-bg-card', colors.bgCard);
    document.documentElement.style.setProperty('--fh-bg-muted', colors.bgMuted);
    document.documentElement.style.setProperty('--fh-text-muted', colors.textMuted);
    document.documentElement.style.setProperty('--fh-accent', colors.accent);
    document.documentElement.style.setProperty('--fh-accent-dark', colors.accentDark);
    document.documentElement.style.setProperty('--fh-accent-soft', colors.accentSoft);
    document.documentElement.style.setProperty('--fh-shop', colors.shop);
    document.documentElement.style.setProperty('--fh-coin', colors.coin);
    document.documentElement.style.setProperty('--fh-coin-soft', colors.coinSoft);
    document.documentElement.style.setProperty(
      '--fh-amount-bg',
      mode === 'dark' ? 'rgba(167, 139, 250, 0.2)' : 'rgba(124, 58, 237, 0.12)',
    );
    document.documentElement.style.setProperty('--fh-amount-border',
      mode === 'dark' ? 'rgba(167, 139, 250, 0.55)' : 'rgba(124, 58, 237, 0.4)',
    );
    document.documentElement.style.setProperty('--fh-amount-positive', colors.amountPositive);
    document.documentElement.style.setProperty('--fh-amount-negative', colors.amountNegative);
  }, [mode, colors.bg, colors.text, colors.border, colors.bgCard, colors.bgMuted, colors.textMuted, colors.accent, colors.accentDark, colors.accentSoft, colors.shop, colors.coin, colors.coinSoft, colors.amountPositive, colors.amountNegative]);

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
