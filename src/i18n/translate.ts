import type { Locale, TranslationDict } from './types';
import { de } from './locales/de';
import { en } from './locales/en';

const dictionaries: Record<Locale, TranslationDict> = { de, en };

export function getDictionary(locale: Locale): TranslationDict {
  return dictionaries[locale];
}

export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = dictionaries[locale];
  const keys = key.split('.');
  let value: unknown = dict;
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }
  if (typeof value !== 'string') return key;
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, paramKey: string) => String(params[paramKey] ?? ''));
}
