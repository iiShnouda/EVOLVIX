import { useEffect, useState, type ReactNode } from 'react';
import { toMinor } from '@skb/shared';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { keepListFilters, readListFilters } from '../lib/listFilters';

/** A filter's box: the same height and look on every list. */
export const filterField =
  'h-9 w-full min-w-0 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** One filter: its name above its box. */
export function Filter({
  label,
  children,
  wide,
  dim,
}: {
  label: string;
  children: ReactNode;
  /** Takes two places in the panel (a party picker, a long name). */
  wide?: boolean;
  /** Shown but not used just now (e.g. the period while searching by number). */
  dim?: boolean;
}) {
  return (
    <label className={`block min-w-0 ${wide ? 'sm:col-span-2' : ''} ${dim ? 'opacity-50' : ''}`}>
      <span className="mb-0.5 block truncate text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Two boxes side by side under one name: from … to (amounts, numbers). */
export function RangeFilter({
  label,
  from,
  to,
  onFrom,
  onTo,
  type = 'number',
}: {
  label: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  type?: 'number' | 'date';
}) {
  const { t } = useT();
  const box = (value: string, set: (v: string) => void, name: string) => (
    <input
      type={type}
      inputMode={type === 'number' ? 'decimal' : undefined}
      min={type === 'number' ? 0 : undefined}
      aria-label={`${label} ${name}`}
      placeholder={type === 'number' ? name : undefined}
      className={`${filterField} tnum`}
      value={value}
      onChange={(e) => set(e.target.value)}
    />
  );
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block truncate text-xs text-muted">{label}</span>
      <div className="grid grid-cols-2 gap-1.5">
        {box(from, onFrom, t('filters.from'))}
        {box(to, onTo, t('filters.to'))}
      </div>
    </div>
  );
}

/**
 * The detailed search above a list (owner, 2026-11-16: one look on every page, each with the
 * filters that page needs). The main search stays in sight; the rest open under the "Detailed
 * search" button, which counts the filters in use, side by side (stacked on a phone), with one
 * button to clear them. Filters apply as they are typed or chosen.
 */
export function FilterPanel({
  id,
  quick,
  active,
  onClear,
  children,
  actions,
}: {
  /** Which list this is: whether the panel is open is remembered for it in this tab. */
  id: string;
  /** Always shown before the button (the search most people use). */
  quick?: ReactNode;
  /** How many detailed filters are in use. */
  active: number;
  onClear: () => void;
  /** The detailed filters (each a <Filter>, <RangeFilter> or any box). */
  children?: ReactNode;
  /** Shown at the end of the first line (e.g. a print button). */
  actions?: ReactNode;
}) {
  const { t } = useT();
  const key = `skb.filters.open.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const kept = sessionStorage.getItem(key);
      return kept == null ? active > 0 : kept === '1';
    } catch {
      return active > 0;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, open ? '1' : '0');
    } catch {
      /* remembered only while possible */
    }
  }, [key, open]);
  const hasPanel = !!children;

  return (
    <div data-noprint className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {quick && <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">{quick}</div>}
        {hasPanel && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-app)] border px-3 text-sm font-medium transition-colors ${
              open || active > 0
                ? 'border-brand bg-brand-soft text-brand'
                : 'border-line bg-surface text-fg hover:border-brand hover:text-brand'
            }`}
          >
            <Icon name="search" size={16} />
            {t('finder.button')}
            {active > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[0.6875rem] font-semibold text-brand-fg tnum">
                {active}
              </span>
            )}
            <Icon name="chevronDown" size={14} className={open ? 'rotate-180' : undefined} />
          </button>
        )}
        {!open && active > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="h-9 shrink-0 px-1 text-xs font-medium text-brand hover:underline"
          >
            {t('finder.reset')}
          </button>
        )}
        {actions && <div className="flex shrink-0 items-end gap-2 ms-auto">{actions}</div>}
      </div>
      {hasPanel && open && (
        <div className="rounded-[var(--radius-app)] border border-line bg-surface p-3 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {children}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-line pt-2">
            <button
              type="button"
              disabled={active === 0}
              onClick={onClear}
              className="flex h-8 items-center gap-1 rounded-[var(--radius-app)] px-2.5 text-sm font-medium text-brand hover:bg-brand-soft disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon name="close" size={14} />
              {t('finder.reset')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A list's filters, kept for this person and tab while the app is open (as the sales list does):
 * coming back to the page finds them as they were left. Only the filters, never any data.
 */
export function useKeptFilters<T extends Record<string, string>>(
  key: string,
  defaults: T,
): [T, (patch: Partial<T>) => void, () => void] {
  const [values, setValues] = useState<T>(() => {
    const kept = readListFilters(key);
    const out = { ...defaults };
    for (const k of Object.keys(defaults) as (keyof T)[])
      if (typeof kept[k as string] === 'string') out[k] = kept[k as string] as T[keyof T];
    return out;
  });
  useEffect(() => keepListFilters(key, values), [key, values]);
  return [
    values,
    (patch) => setValues((v) => ({ ...v, ...patch })),
    () => setValues((v) => ({ ...v, ...defaults })),
  ];
}

/** How many of `names` differ from their starting value. */
export function countActive<T extends Record<string, string>>(
  values: T,
  defaults: T,
  names: (keyof T)[],
): number {
  return names.filter((n) => (values[n] ?? '') !== (defaults[n] ?? '')).length;
}

/** A typed value once the person pauses typing (filters typed in apply without a request per key). */
export function useSettled<V>(value: V, ms = 300): V {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** An amount typed in pounds as minor units for the server ('' when none). */
export function minorOf(v: string): string {
  const n = Number(v.replace(/,/g, ''));
  return v.trim() && Number.isFinite(n) && n >= 0 ? String(toMinor(n)) : '';
}
