import type { Locale } from '../types';
import { en } from './en';
import { ar } from './ar';

/** Every translation key, derived from the canonical English dictionary. */
export type TranslationKey = keyof typeof en;

/** A dictionary must define every key. `ar.ts` is typed against this. */
export type TranslationDictionary = Record<TranslationKey, string>;

export const dictionaries: Record<Locale, TranslationDictionary> = {
  en,
  ar,
};

/** A translate function bound to a locale. */
export type Translate = (key: TranslationKey) => string;

export function createTranslator(locale: Locale): Translate {
  const dict = dictionaries[locale];
  return (key: TranslationKey) => dict[key] ?? key;
}

export { en, ar };
