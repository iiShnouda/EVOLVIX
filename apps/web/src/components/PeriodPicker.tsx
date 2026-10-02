import { useEffect, useRef, useState } from 'react';
import { formatDate, type Locale, type TranslationKey } from '@skb/shared';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { periodOf, shiftPeriod, type Period, type PeriodMode } from '../lib/period';

const MODES: { mode: PeriodMode; label: TranslationKey }[] = [
  { mode: 'day', label: 'period.day' },
  { mode: 'week', label: 'period.week' },
  { mode: 'month', label: 'period.month' },
  { mode: 'year', label: 'period.year' },
  { mode: 'custom', label: 'period.custom' },
];

const dateInput =
  'h-8 rounded-lg border border-line bg-surface px-2 text-xs outline-none focus:border-brand tnum';

/** The period in words: a day, "Sep 2026", "2026", or "from – to". */
export function periodLabel(p: Period, locale: Locale): string {
  const intl = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
  const at = (d: string) => new Date(`${d}T12:00:00Z`);
  if (p.mode === 'day') return formatDate(p.from, locale);
  if (p.mode === 'month')
    return at(p.from).toLocaleDateString(intl, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (p.mode === 'year') return p.from.slice(0, 4);
  return `${formatDate(p.from, locale)} – ${formatDate(p.to, locale)}`;
}

/**
 * Pick a period (owner, 2026-10-02): a day, a week, a month, a year or any dates; the arrows go
 * to the one before or after. Days are the company's.
 */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  const { t, locale } = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="tablist"
        aria-label={t('period.title')}
        className="flex flex-wrap gap-0.5 rounded-[var(--radius-app)] border border-line bg-surface p-0.5"
      >
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="tab"
            aria-selected={value.mode === m.mode}
            onClick={() =>
              onChange(m.mode === 'custom' ? { ...value, mode: 'custom' } : periodOf(m.mode))
            }
            className={`h-7 rounded-md px-2.5 text-xs font-medium transition-colors ${
              value.mode === m.mode ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
            }`}
          >
            {t(m.label)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted hover:text-fg"
          aria-label={t('period.prev')}
          title={t('period.prev')}
          onClick={() => onChange(shiftPeriod(value, -1))}
        >
          <Icon name="chevronRight" size={16} className="rotate-180" />
        </button>
        {value.mode === 'custom' ? (
          <span className="flex items-center gap-1 text-xs">
            <input
              type="date"
              className={dateInput}
              aria-label={t('period.from')}
              value={value.from}
              max={value.to}
              onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
            />
            <span className="text-muted">–</span>
            <input
              type="date"
              className={dateInput}
              aria-label={t('period.to')}
              value={value.to}
              min={value.from}
              onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
            />
          </span>
        ) : value.mode === 'day' ? (
          <input
            type="date"
            className={dateInput}
            aria-label={t('period.day')}
            value={value.from}
            onChange={(e) => e.target.value && onChange(periodOf('day', e.target.value))}
          />
        ) : (
          <span className="min-w-[7rem] px-1 text-center text-sm font-medium tnum">
            {periodLabel(value, locale)}
          </span>
        )}
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted hover:text-fg"
          aria-label={t('period.next')}
          title={t('period.next')}
          onClick={() => onChange(shiftPeriod(value, 1))}
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </div>
    </div>
  );
}

/**
 * A card's own period: a small button with the period it shows; it opens the picker. Until the
 * person picks one, the card follows the main period (`own` is null).
 */
export function CardPeriod({
  value,
  own,
  onChange,
}: {
  value: Period;
  own: boolean;
  onChange: (p: Period | null) => void;
}) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t('period.change')}
        className={`flex h-7 max-w-[13rem] items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium ${
          own ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted hover:text-fg'
        }`}
      >
        <Icon name="calendar" size={13} />
        <span className="truncate tnum">{periodLabel(value, locale)}</span>
      </button>
      {open && (
        <div className="absolute end-0 top-9 z-30 w-max max-w-[calc(100vw-2rem)] space-y-2 rounded-[var(--radius-app)] border border-line bg-surface p-3 shadow-xl">
          <PeriodPicker value={value} onChange={(p) => onChange(p)} />
          {own && (
            <button
              type="button"
              className="text-xs text-brand hover:underline"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              {t('period.sameAsTop')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A small "now" tag for a card that shows how things are at this moment, not over a period. */
export function NowTag() {
  const { t } = useT();
  return (
    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
      {t('period.now')}
    </span>
  );
}
