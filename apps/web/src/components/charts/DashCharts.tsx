import { useId, useState } from 'react';
import { formatDate, formatMoney, type Locale, type TrendPoint } from '@skb/shared';

/** A smooth path through points (Catmull-Rom as cubic Béziers). */
function smooth(points: [number, number][]): string {
  const at = (i: number): [number, number] =>
    points[Math.max(0, Math.min(points.length - 1, i))] ?? [0, 0];
  if (points.length === 0) return '';
  let d = `M${at(0)[0]},${at(0)[1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [x3, y3] = at(i + 2);
    const c1x = x1 + (x2 - x0) / 6;
    // Bends kept between the two points, so a curve never dips below zero or above a peak.
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    const c1y = Math.min(hi, Math.max(lo, y1 + (y2 - y0) / 6));
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = Math.min(hi, Math.max(lo, y2 - (y3 - y1) / 6));
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  return d;
}

/** A small filled line for a stat card. */
export function Sparkline({
  values,
  color = 'var(--c-brand)',
  height = 40,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  const id = useId();
  const w = 120;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const pts: [number, number][] = values.map((v, i) => [
    values.length === 1 ? w / 2 : (i * w) / (values.length - 1),
    height - 3 - ((v - min) / span) * (height - 6),
  ]);
  const line = smooth(pts);
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      className="h-10 w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {pts.length > 1 && (
        <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} stroke="none" />
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Sales and purchases over the days, as two smooth areas with a guide that follows the pointer
 * (the reference dashboards' main chart). Pure SVG, coloured from the theme.
 */
export function AreaTrend({
  data,
  locale,
  currency,
  labels,
  monthly = false,
}: {
  data: TrendPoint[];
  locale: Locale;
  currency: string;
  labels: { sales: string; purchases: string };
  /** One point a month (a long period): label by month. */
  monthly?: boolean;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { top: 12, bottom: 26, side: 8 };
  const inner = H - pad.top - pad.bottom;
  const max = Math.max(1, ...data.flatMap((d) => [d.sales, d.purchases]));
  const x = (i: number) =>
    data.length <= 1 ? W / 2 : pad.side + (i * (W - pad.side * 2)) / (data.length - 1);
  const y = (v: number) => pad.top + inner - (Math.max(0, v) / max) * inner;
  const series = (key: 'sales' | 'purchases') => smooth(data.map((d, i) => [x(i), y(d[key])]));
  const area = (path: string) =>
    data.length > 1
      ? `${path} L${x(data.length - 1)},${pad.top + inner} L${x(0)},${pad.top + inner} Z`
      : '';
  const step = Math.max(1, Math.ceil(data.length / 8));
  const shown = hover != null ? data[hover] : null;
  const money = (v: number) => formatMoney(v, currency, locale);
  const dayLabel = (date: string) =>
    new Date(date).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
      ...(monthly
        ? { month: 'short', ...(data.length > 12 ? { year: '2-digit' } : {}) }
        : data.length > 8
          ? { day: 'numeric', month: 'short' }
          : data.length > 1
            ? { weekday: 'short' }
            : { day: 'numeric', month: 'short' }),
      timeZone: 'UTC',
    });

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-56 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${labels.sales} · ${labels.purchases}`}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          let best = 0;
          data.forEach((_, i) => {
            if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
          });
          setHover(best);
        }}
      >
        <defs>
          <linearGradient id={`${id}s`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--c-brand)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--c-brand)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`${id}p`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--c-info)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--c-info)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={pad.top + inner * f}
            y2={pad.top + inner * f}
            stroke="var(--c-line)"
            strokeDasharray={f === 1 ? undefined : '3 5'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area(series('purchases'))} fill={`url(#${id}p)`} />
        <path
          d={series('purchases')}
          fill="none"
          stroke="var(--c-info)"
          strokeWidth={2}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
        <path d={area(series('sales'))} fill={`url(#${id}s)`} />
        <path
          d={series('sales')}
          fill="none"
          stroke="var(--c-brand)"
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
        {hover != null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.top}
            y2={pad.top + inner}
            stroke="var(--c-muted)"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* Day labels as text over the chart, so the stretched drawing never squeezes or cuts them. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5" dir="ltr">
        {data.map((d, i) =>
          (i % step === 0 && data.length - 1 - i >= step / 2) || i === data.length - 1 ? (
            <span
              key={d.date}
              className={`absolute bottom-0.5 whitespace-nowrap text-[11px] text-faint ${
                data.length > 1 && i === 0
                  ? ''
                  : i === data.length - 1 && data.length > 1
                    ? '-translate-x-full'
                    : '-translate-x-1/2'
              }`}
              style={{ left: `${(x(i) / W) * 100}%` }}
            >
              {dayLabel(d.date)}
            </span>
          ) : null,
        )}
      </div>
      {hover != null && (
        <>
          {(['sales', 'purchases'] as const).map((k) => (
            <span
              key={k}
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
              style={{
                left: `${(x(hover) / W) * 100}%`,
                top: `${(y(data[hover]?.[k] ?? 0) / H) * 100}%`,
                background: k === 'sales' ? 'var(--c-brand)' : 'var(--c-info)',
              }}
            />
          ))}
        </>
      )}
      {shown && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-[var(--radius-app)] border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: `${Math.min(85, Math.max(15, (x(hover!) / W) * 100))}%` }}
        >
          <p className="mb-1 font-semibold">
            {monthly
              ? new Date(`${shown.date}T12:00:00Z`).toLocaleDateString(
                  locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US',
                  { month: 'long', year: 'numeric', timeZone: 'UTC' },
                )
              : formatDate(shown.date, locale)}
          </p>
          <p className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-brand" /> {labels.sales}:{' '}
            <span className="font-medium tnum">{money(shown.sales)}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-info" /> {labels.purchases}:{' '}
            <span className="font-medium tnum">{money(shown.purchases)}</span>
          </p>
        </div>
      )}
    </div>
  );
}

/** A progress ring with its value in the middle. */
export function Ring({
  percent,
  size = 132,
  stroke = 12,
  color = 'var(--c-brand)',
  children,
}: {
  percent: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--c-surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * p) / 100} ${c}`}
          style={{ transition: 'stroke-dasharray .6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/** Theme colours for shares, in order. */
export const SHARE_COLORS = [
  'var(--c-brand)',
  'var(--c-info)',
  'var(--c-positive)',
  'var(--c-warning)',
  'var(--c-destructive)',
  'var(--c-muted)',
];

/** Shares of a whole as a ring of coloured arcs (e.g. sales by branch). */
export function Donut({
  values,
  size = 140,
  stroke = 18,
  children,
}: {
  values: number[];
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--c-surface-2)"
          strokeWidth={stroke}
        />
        {values.map((v, i) => {
          const len = (Math.max(0, v) / total) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={SHARE_COLORS[i % SHARE_COLORS.length]}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
