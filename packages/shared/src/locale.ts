import type { Direction, Locale } from './types';

export function directionForLocale(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function isRtl(locale: Locale): boolean {
  return locale === 'ar';
}

/** Format an ISO date string per locale (date only). */
export function formatDate(iso: string, locale: Locale): string {
  const intlLocale = locale === 'ar' ? 'ar-EG' : 'en-US';
  try {
    return new Intl.DateTimeFormat(intlLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Format an ISO datetime string per locale (date + time). */
export function formatDateTime(iso: string, locale: Locale): string {
  const intlLocale = locale === 'ar' ? 'ar-EG' : 'en-US';
  try {
    return new Intl.DateTimeFormat(intlLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
