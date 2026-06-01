import type { de } from './locales/de';

export type Locale = 'de' | 'en';

type Stringify<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Stringify<U>[]
    : T extends object
      ? { [K in keyof T]: Stringify<T[K]> }
      : T;

export type TranslationDict = Stringify<typeof de>;

export const LOCALE_STORAGE_KEY = 'finanzbuddy-locale';

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
];
