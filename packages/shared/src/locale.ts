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
 * Every date is shown in numbers only, day/month/year, in both languages (owner, 2026-11-10:
 * "التوريخ في كل مكان ... ارقام فقط"): 24/10/2026, Latin digits like every other number. Times are
 * on the 24-hour clock, to the second at most (no milliseconds).
 */
function numericLocale(locale: Locale): string {
  return locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
}

function format(
  when: string,
  locale: Locale,
  parts: Intl.DateTimeFormatOptions,
  zone?: string,
): string {
  const plain = PLAIN_DAY.test(when);
  try {
    return new Intl.DateTimeFormat(numericLocale(locale), {
      ...parts,
      ...(parts.hour ? { hourCycle: 'h23' as const } : {}),
      timeZone: zone ?? (plain ? 'UTC' : companyZone),
    }).format(new Date(plain ? `${when}T00:00:00Z` : when));
  } catch {
    return when;
  }
}

/**
 * A date, day/month/year (24/10/2026). A plain yyyy-MM-dd is shown as that day; an instant is
 * shown on the company's day. The third argument is no longer used: every date is numeric.
 */
export function formatDate(iso: string, locale: Locale, _numeric?: boolean): string {
  return format(iso, locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** A month (yyyy-MM, or any day of it) as month/year: 10/2026. */
export function formatMonth(month: string, locale: Locale): string {
  const day = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month.slice(0, 10);
  return format(day, locale, { year: 'numeric', month: '2-digit' });
}

/** A day without its year, day/month (24/10): chart labels and short lists. */
export function formatDayMonth(iso: string, locale: Locale): string {
  return format(iso, locale, { month: '2-digit', day: '2-digit' });
}

/** The time of an instant on the company's clock, to the second (e.g. 14:05:09). */
export function formatTime(iso: string, locale: Locale): string {
  return format(iso, locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** The hour and minute of an instant (14:05), on the company's clock or the zone given. */
export function formatClock(iso: string, locale: Locale, zone?: string): string {
  return format(iso, locale, { hour: '2-digit', minute: '2-digit' }, zone);
}

/** An instant's day and time to the minute, on the company's clock (printed documents). */
export function formatDateHM(iso: string, locale: Locale): string {
  return format(iso, locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** An instant's day and time to the second, on the company's clock (24/10/2026, 14:05:09). */
export function formatDateTime(iso: string, locale: Locale): string {
  return format(iso, locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
