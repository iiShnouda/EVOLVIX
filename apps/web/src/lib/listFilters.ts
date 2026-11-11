import { companyToday } from '@skb/shared';

/**
 * What a person typed or chose above a list (owner, 2026-11-10: "coming back to the sales page, the
 * date and everything I typed or selected is gone"): kept while the app stays open, per person and
 * per open tab, so the list is as it was left. Only the filters themselves, never any data, and
 * only in this browser tab's session.
 */
export type ListFilters = Record<string, string>;

/** The filters kept under `key` ({} when none, or when they can't be read). */
export function readListFilters(key: string): ListFilters {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: ListFilters = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>))
      if (typeof v === 'string') out[k] = v;
    // A list left on "today" opens on today the next day too.
    const today = companyToday();
    if (out.day && out.day !== today && out.from === out.day && out.to === out.day) {
      out.from = today;
      out.to = today;
    }
    return out;
  } catch {
    return {};
  }
}

export function keepListFilters(key: string, filters: ListFilters) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...filters, day: companyToday() }));
  } catch {
    /* without session storage the list simply starts fresh */
  }
}
