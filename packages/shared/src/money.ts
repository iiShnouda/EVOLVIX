import type { BalanceDirection, Locale, Money, PartyBalanceView } from './types';

/**
 * Money is stored as integer minor units everywhere. These helpers convert to/from
 * display and format per locale. Never do arithmetic on formatted strings.
 */

/** Minor units per major unit (2 = cents/piastres). Kept simple; configurable later. */
export const MINOR_UNITS = 100;

export function toMinor(major: number): number {
  return Math.round(major * MINOR_UNITS);
}

export function toMajor(minor: number): number {
  return minor / MINOR_UNITS;
}

/**
 * Format a minor-unit amount for a currency and locale.
 * Uses the platform Intl; falls back gracefully if the runtime lacks a currency.
 */
export function formatMoney(minor: number, currency: string, locale: Locale): string {
  const value = toMajor(minor);
  const intlLocale = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
  try {
    return new Intl.NumberFormat(intlLocale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Format a plain number (counts, quantities) per locale, with tabular grouping. */
export function formatNumber(value: number, locale: Locale): string {
  const intlLocale = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
  try {
    return new Intl.NumberFormat(intlLocale).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Turn a signed party balance (minor units) into an unambiguous view:
 *  > 0 → they owe us (receivable), < 0 → we owe them (payable), 0 → settled.
 */
export function balanceView(balanceMinor: number, currency: string): PartyBalanceView {
  let direction: BalanceDirection = 'settled';
  if (balanceMinor > 0) direction = 'receivable';
  else if (balanceMinor < 0) direction = 'payable';
  return { direction, amount: Math.abs(balanceMinor), currency };
}

export function makeMoney(minor: number, currency: string): Money {
  return { amount: minor, currency };
}
