import { useRef, useState } from 'react';
import { formatMoney, formatNumber, type Locale } from '@skb/shared';

export interface PeriodRow {
  key: string;
  /** Under the bars (short: "Oct 26", "2026"). */
  label: string;
  /** In the details (long: "October 2026"). */
  title: string;
  sales: number;
  returns: number;
  netSales: number;
  netPurchases: number;
  invoices: number;
}

/**
 * Net sales against net purchases, a pair of bars a month or a year (owner, 2026-10-10: "stand on
 * any point and see every detail"). Hovering anywhere over a period (or tapping it on a phone, or
 * moving with the arrow keys) shows its sales, returns, net sales, net purchases, invoices and the
 * change on the period before. Plain HTML, so labels stay crisp at any width and in both directions.
 */
export function PeriodBars({
  rows,
  locale,
  currency,
  labels,
}: {
  rows: PeriodRow[];
  locale: Locale;
  currency: string;
  labels: {
    sales: string;
    returns: string;
    netSales: string;
    netPurchases: string;
    invoices: string;
    change: string;
  };
}) {
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...rows.flatMap((r) => [r.netSales, r.netPurchases]));
  const money = (v: number) => formatMoney(v, currency, locale);
  const compact = (v: number) =>
    new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(v / 100);
  // Every label when they fit, else every second or third so they never run into each other.
  const every = rows.length > 24 ? 3 : rows.length > 12 ? 2 : 1;
  const shown = active != null ? rows[active] : null;
  const before = active != null && active > 0 ? rows[active - 1] : null;
  const change =
    shown && before && before.netSales > 0
      ? Math.round(((shown.netSales - before.netSales) * 1000) / before.netSales) / 10
      : null;

  return (
    <div className="flex gap-2" dir="ltr">
      {/* The scale: a figure on each guide line. */}
      <div className="relative h-56 w-12 shrink-0 text-[10px] text-faint tnum">
        {[1, 0.75, 0.5, 0.25, 0].map((f) => (
          <span key={f} className="absolute end-1 -translate-y-1/2" style={{ top: `${(1 - f) * 100}%` }}>
            {compact(max * f)}
          </span>
        ))}
      </div>
      <div ref={box} className="relative min-w-0 flex-1" onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}>
        <div className="relative h-56">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <div
              key={f}
              className={`absolute inset-x-0 border-t ${f === 0 ? 'border-line' : 'border-dashed border-line/70'}`}
              style={{ bottom: `${f * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-stretch">
            {rows.map((r, i) => {
              const on = active === i;
              return (
                <button
                  key={r.key}
                  type="button"
                  aria-label={`${r.title}: ${labels.netSales} ${money(r.netSales)}, ${labels.netPurchases} ${money(r.netPurchases)}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                      e.preventDefault();
                      const next = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
                      (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
                    }
                  }}
                  className={`group relative flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-md px-[3px] outline-none sm:px-1.5 transition-colors ${
                    on ? 'bg-brand-soft/60' : 'hover:bg-surface-2/70'
                  } focus-visible:ring-2 focus-visible:ring-brand`}
                >
                  <span
                    className="w-1/2 max-w-6 rounded-t-[3px] bg-brand transition-[height]"
                    style={{ height: `${(Math.max(0, r.netSales) / max) * 100}%` }}
                  />
                  <span
                    className="w-1/2 max-w-6 rounded-t-[3px] bg-info/60 transition-[height]"
                    style={{ height: `${(Math.max(0, r.netPurchases) / max) * 100}%` }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex h-6 items-start">
          {rows.map((r, i) => (
            <span
              key={r.key}
              className={`min-w-0 flex-1 truncate pt-1 text-center text-[11px] ${active === i ? 'font-semibold text-fg' : 'text-faint'}`}
            >
              {i % every === 0 || i === rows.length - 1 ? r.label : ''}
            </span>
          ))}
        </div>

        {shown && active != null && (
          <div
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            className="pointer-events-none absolute top-2 z-10 w-56 rounded-[var(--radius-app)] border border-line bg-surface p-3 text-xs shadow-lg"
            style={tooltipPlace(active, rows.length)}
          >
            <p className="mb-1.5 text-sm font-semibold">{shown.title}</p>
            <Line color="bg-brand" label={labels.netSales} value={money(shown.netSales)} strong />
            <Line label={labels.sales} value={money(shown.sales)} />
            <Line label={labels.returns} value={money(shown.returns)} />
            <Line color="bg-info/60" label={labels.netPurchases} value={money(shown.netPurchases)} />
            <Line label={labels.invoices} value={formatNumber(shown.invoices, locale)} />
            {change != null && (
              <p className="mt-1.5 flex items-center justify-between gap-2 border-t border-line pt-1.5">
                <span className="text-muted">{labels.change}</span>
                <span
                  dir="ltr"
                  className={`font-semibold tnum ${change >= 0 ? 'text-positive' : 'text-destructive'}`}
                >
                  {change >= 0 ? '+' : ''}
                  {formatNumber(change, locale)}%
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <p className="flex items-center justify-between gap-2 py-0.5">
      <span className="flex items-center gap-1.5 text-muted">
        {color && <span className={`h-2 w-2 rounded-sm ${color}`} />}
        {label}
      </span>
      <span className={`tnum ${strong ? 'font-semibold' : 'font-medium'}`}>{value}</span>
    </p>
  );
}

/** Beside the period, kept inside the chart: right of it in the first half, left of it after. */
function tooltipPlace(i: number, count: number): React.CSSProperties {
  const centre = ((i + 0.5) / count) * 100;
  return centre < 50
    ? { left: `min(calc(${centre}% + 12px), calc(100% - 14rem))` }
    : { right: `min(calc(${100 - centre}% + 12px), calc(100% - 14rem))` };
}
