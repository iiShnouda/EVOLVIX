import { formatDate, toMajor, type Locale, type TrendPoint } from '@skb/shared';

/**
 * Lightweight, theme-aware grouped bar chart (sales vs purchases). Pure SVG so it stays
 * crisp at every viewport and preserves labels/values per the design brief.
 */
export function TrendChart({
  data,
  locale,
  currency,
}: {
  data: TrendPoint[];
  locale: Locale;
  currency: string;
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.sales, d.purchases]));
  const barsPerGroup = 2;
  const groupGap = 14;
  const barGap = 4;
  const barW = 14;
  const groupW = barsPerGroup * barW + barGap;
  const chartH = 160;
  const width = data.length * (groupW + groupGap) + groupGap;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${chartH + 28}`}
        role="img"
        className="min-w-[280px]"
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={chartH - chartH * f}
            y2={chartH - chartH * f}
            stroke="var(--c-line)"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        ))}
        {data.map((d, i) => {
          const x = groupGap + i * (groupW + groupGap);
          const salesH = (d.sales / max) * chartH;
          const purchH = (d.purchases / max) * chartH;
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={chartH - salesH}
                width={barW}
                height={salesH}
                rx={3}
                fill="var(--c-brand)"
              >
                <title>{`${formatDate(d.date, locale)} · ${toMajor(d.sales).toLocaleString()} ${currency}`}</title>
              </rect>
              <rect
                x={x + barW + barGap}
                y={chartH - purchH}
                width={barW}
                height={purchH}
                rx={3}
                fill="var(--c-info)"
                opacity={0.55}
              >
                <title>{`${formatDate(d.date, locale)} · ${toMajor(d.purchases).toLocaleString()} ${currency}`}</title>
              </rect>
              <text
                x={x + groupW / 2}
                y={chartH + 18}
                textAnchor="middle"
                fontSize={10}
                fill="var(--c-faint)"
              >
                {new Date(d.date).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', {
                  weekday: 'short',
                })}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
