import { useMemo } from 'react';
import { createTranslator, isRtl, type Translate } from '@skb/shared';
import { usePrefs } from '../stores/prefs';

/** Hook returning the translate function + locale metadata, reactive to the locale switch. */
export function useT(): { t: Translate; locale: 'en' | 'ar'; rtl: boolean } {
  const locale = usePrefs((s) => s.locale);
  const t = useMemo(() => createTranslator(locale), [locale]);
  return { t, locale, rtl: isRtl(locale) };
}

/** Several names in a row, with the screen language's comma («،» in Arabic, "," in English). */
export function joinList(items: readonly string[]): string {
  return items.join(usePrefs.getState().locale === 'ar' ? '، ' : ', ');
}
