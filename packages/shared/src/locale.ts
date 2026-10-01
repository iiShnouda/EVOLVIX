import type { Direction, Locale } from './types';

export function directionForLocale(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function isRtl(locale: Locale): boolean {
  return locale === 'ar';
}

// ---------------------------------------------------------------------------
// The company's calendar. Business days follow the company's time zone (Settings; Africa/Cairo
// by default), not the device's: "today" in date pickers, and every date and time shown.
// ---------------------------------------------------------------------------

let companyZone = 'Africa/Cairo';

/** Use the company's time zone (the app calls this once Settings load). Unknown zones are ignored. */
export function setCompanyTimeZone(zone: string | null | undefined): void {
  if (!zone) return;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    companyZone = zone;
  } catch {
    // keep the current zone
  }
}

export function companyTimeZone(): string {
  return companyZone;
}

/** The company's yyyy-MM-dd day of an instant (now by default). */
export function companyDay(when: Date | string = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: companyZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(when));
  } catch {
    return new Date(when).toISOString().slice(0, 10);
  }
}

/** Today at the company, yyyy-MM-dd. */
export function companyToday(): string {
  return companyDay();
}

/** A yyyy-MM-dd day plus (or minus) some days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A yyyy-MM-dd day plus (or minus) some months, on the same day of the month where it exists. */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last)));
  return t.toISOString().slice(0, 10);
}

/** A plain day ("2026-09-30") is a calendar day; anything else is an instant. */
const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Format a date per locale (date only). A plain yyyy-MM-dd is shown as that day; an instant is
 * shown on the company's day.
 */
export function formatDate(iso: string, locale: Locale, numeric = false): string {
  const intlLocale = locale === 'ar' ? 'ar-EG' : 'en-US';
  const plain = PLAIN_DAY.test(iso);
  try {
    return new Intl.DateTimeFormat(intlLocale, {
      year: 'numeric',
      // `numeric`: 30/09/2026, for dense tables.
      month: numeric ? '2-digit' : 'short',
      day: numeric ? '2-digit' : 'numeric',
      timeZone: plain ? 'UTC' : companyZone,
    }).format(new Date(plain ? `${iso}T00:00:00Z` : iso));
  } catch {
    return iso;
  }
}

/** The time of an instant on the company's clock, to the millisecond (e.g. 14:05:09.123). */
export function formatTime(iso: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false,
      timeZone: companyZone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Format an instant per locale (date + time), on the company's clock: to the second and the
 * millisecond (owner, 2026-10-01: everything done is recorded that exactly).
 */
export function formatDateTime(iso: string, locale: Locale): string {
  const intlLocale = locale === 'ar' ? 'ar-EG' : 'en-US';
  try {
    return new Intl.DateTimeFormat(intlLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      timeZone: companyZone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
