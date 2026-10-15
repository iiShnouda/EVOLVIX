import { addDays, addMonths, companyToday } from '@skb/shared';

/** How a period is picked (owner, 2026-10-02: "by day, week, month or year, or the dates I want"). */
export type PeriodMode = 'day' | 'week' | 'month' | 'year' | 'custom';

/** A period of company days, both ends included (yyyy-MM-dd). */
export interface Period {
  mode: PeriodMode;
  from: string;
  to: string;
}

/** Day of the week of a yyyy-MM-dd day (0 = Sunday … 6 = Saturday). */
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/**
 * The period of `mode` that holds `day`: that day, its week (Saturday to Friday, as Egyptian
 * businesses count it), its month or its year.
 */
export function periodOf(mode: Exclude<PeriodMode, 'custom'>, day = companyToday()): Period {
  switch (mode) {
    case 'day':
      return { mode, from: day, to: day };
    case 'week': {
      const from = addDays(day, -((weekday(day) + 1) % 7));
      return { mode, from, to: addDays(from, 6) };
    }
    case 'month': {
      const from = `${day.slice(0, 7)}-01`;
      return { mode, from, to: addDays(addMonths(from, 1), -1) };
    }
    case 'year':
      return { mode, from: `${day.slice(0, 4)}-01-01`, to: `${day.slice(0, 4)}-12-31` };
  }
}

/** The period before (-1) or after (+1) this one, of the same kind and length. */
export function shiftPeriod(p: Period, step: -1 | 1): Period {
  switch (p.mode) {
    case 'day':
      return periodOf('day', addDays(p.from, step));
    case 'week':
      return periodOf('week', addDays(p.from, 7 * step));
    case 'month':
      return periodOf('month', addMonths(p.from, step));
    case 'year':
      return periodOf('year', addMonths(p.from, 12 * step));
    case 'custom': {
      const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
      return { mode: 'custom', from: addDays(p.from, step * days), to: addDays(p.to, step * days) };
    }
  }
}

/** The query string for a period. */
export const periodQuery = (p: Period) => `from=${p.from}&to=${p.to}`;
