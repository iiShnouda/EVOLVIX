import { useMemo } from 'react';
import { createTranslator, isRtl, type Translate } from '@skb/shared';
import { usePrefs } from '../stores/prefs';

/** Hook returning the translate function + locale metadata, reactive to the locale switch. */
export function useT(): { t: Translate; locale: 'en' | 'ar'; rtl: boolean } {
  const locale = usePrefs((s) => s.locale);
  const t = useMemo(() => createTranslator(locale), [locale]);
  return { t, locale, rtl: isRtl(locale) };
}
