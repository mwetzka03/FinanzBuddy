import { useRef, type CSSProperties } from 'react';
import type { IsoDate, IsoMonth } from '../lib/types';
import { isoToday } from '../lib/date';
import { useTheme } from '../lib/theme';

function openNativePicker(el: HTMLInputElement | null) {
  if (!el) return;
  if (typeof el.showPicker === 'function') {
    try {
      el.showPicker();
      return;
    } catch {
      // showPicker can throw if not triggered by user gesture in some engines
    }
  }
  el.focus();
}

function pickerStyle(mode: 'light' | 'dark', colors: ReturnType<typeof useTheme>['colors'], extra?: CSSProperties): CSSProperties {
  return {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.bgCard,
    color: colors.text,
    colorScheme: mode,
    cursor: 'pointer',
    ...extra,
  };
}

interface DateInputProps {
  value: IsoDate;
  onChange: (value: IsoDate) => void;
  style?: CSSProperties;
}

/** Native Kalender-Auswahl (type=date) */
export function DateInput({ value, onChange, style }: DateInputProps) {
  const { colors, mode } = useTheme();
  const ref = useRef<HTMLInputElement>(null);

  return (
    <input
      ref={ref}
      type="date"
      lang="de-DE"
      value={value}
      onChange={(e) => onChange(e.target.value as IsoDate)}
      onClick={() => openNativePicker(ref.current)}
      style={pickerStyle(mode, colors, style)}
    />
  );
}

interface MonthInputProps {
  value: IsoMonth;
  onChange: (value: IsoMonth) => void;
  style?: CSSProperties;
}

/** Native Monats-Auswahl (type=month) */
export function MonthInput({ value, onChange, style }: MonthInputProps) {
  const { colors, mode } = useTheme();
  const ref = useRef<HTMLInputElement>(null);

  return (
    <input
      ref={ref}
      type="month"
      lang="de-DE"
      value={value}
      onChange={(e) => onChange(e.target.value as IsoMonth)}
      onClick={() => openNativePicker(ref.current)}
      style={pickerStyle(mode, colors, style)}
    />
  );
}
