import { useRef, useState } from 'react';
import {
  companyToday,
  formatMoney,
  formatNumber,
  type SeasonCompareCell,
  type SeasonCompareQuery,
  type SeasonCompareRow,
  type TranslationKey,
} from '@skb/shared';
import { Card, EmptyState, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { ReportActions } from '../components/ReportActions';
import { TableColumns } from '../components/TableColumns';
import { useT } from '../lib/i18n';
import { useReportTools } from '../lib/report';
import { useSeasonCompare } from '../lib/queries';

const small =
  'h-9 min-w-0 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';

type Figure = {
  key: string;
  label: TranslationKey;
  value: (c: SeasonCompareCell) => number;
  money?: boolean;
  hidden?: 'profit' | 'costs';
};
const FIGURES: Figure[] = [
  { key: 'sales', label: 'scompare.sales', value: (c) => c.sales, money: true },
  { key: 'sold', label: 'assort.sold', value: (c) => c.soldQty },
  { key: 'returns', label: 'assort.returns', value: (c) => c.returns, money: true },
  { key: 'returned', label: 'assort.returned', value: (c) => c.returnedQty },
  { key: 'net', label: 'assort.netSales', value: (c) => c.netSales, money: true },
  {
    key: 'profit',
    label: 'assort.profit',
    value: (c) => c.profit,
    money: true,
    hidden: 'profit',
  },
  { key: 'items', label: 'assort.items', value: (c) => c.items },
  { key: 'stock', label: 'scompare.stockEnd', value: (c) => c.stockQty },
  {
    key: 'stockValue',
    label: 'assort.stockValue',
    value: (c) => c.stockValue,
    money: true,
    hidden: 'costs',
  },
];

/**
 * The same season across years (owner, 2026-11-18): summer 2024, 2025, 2026 side by side — what the
 * season's goods sold and got back, net, profit, how many items and what was left at its end; in all,
 * then by department, supplier or item. An item counts in the season and year it was bought for.
 */
export function SeasonCompareTab() {
  const { t, locale } = useT();
  const month = Number(companyToday().slice(5, 7));
  const [q, setQ] = useState<SeasonCompareQuery>(() => ({
    season: month >= 4 && month <= 9 ? 'SUMMER' : 'WINTER',
    count: 3,
    by: 'department',
    supplierIds: [],
  }));
  const set = (patch: Partial<SeasonCompareQuery>) => setQ((x) => ({ ...x, ...patch }));
  const [figure, setFigure] = useState('net');
  // The supplier opened, by name, for the path and the print.
  const [supplierName, setSupplierName] = useState<string | null>(null);
  const { data, isLoading } = useSeasonCompare(q);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const hidden = new Set(data?.hidden ?? []);
  const figures = FIGURES.filter((f) => !f.hidden || !hidden.has(f.hidden));
  const shown = figures.find((f) => f.key === figure) ?? figures[0]!;
  const m = (v: number) => formatMoney(v, data?.currency ?? 'EGP', locale);
  const n = (v: number) => formatNumber(v, locale);
  const show = (f: Figure, c: SeasonCompareCell | undefined) =>
    c ? (f.money ? m(f.value(c)) : n(f.value(c))) : '–';
  const seasonName = t(q.season === 'SUMMER' ? 'dash.summer' : 'dash.winter');
  const yearLabel = (y: number) => `${seasonName} ${y}`;

  const nameOf = (r: SeasonCompareRow) =>
    r.kind === 'NO_SUPPLIER'
      ? t('assort.noSupplier')
      : r.kind === 'NO_DEPARTMENT'
        ? t('assort.noDepartment')
        : r.name;
  const open = (r: SeasonCompareRow) => {
    if (r.kind === 'DEPARTMENT') set({ by: 'item', departmentId: r.id });
    else if (r.kind === 'SUPPLIER' || r.kind === 'NO_SUPPLIER') {
      setSupplierName(nameOf(r));
      set({ by: 'item', supplierIds: [r.kind === 'SUPPLIER' ? r.id : 'none'] });
    }
  };
  const opens = (r: SeasonCompareRow) => r.opens && r.kind !== 'NO_DEPARTMENT';

  const views = [
    ['department', t('assort.byDepartment')],
    ['supplier', t('assort.bySupplier')],
    ['item', t('assort.byItem')],
  ] as const;
  const title = `${t('analytics.tabSeasonCompare')} — ${seasonName}`;
  const subtitle = [
    (data?.years ?? []).join('، '),
    ...(data?.path ?? []).map((p) => p.name),
    ...(supplierName ? [supplierName] : []),
    t(shown.label),
  ].join(' · ');
  const firstLabel =
    q.by === 'supplier'
      ? t('assort.supplier')
      : q.by === 'item'
        ? t('analytics.item')
        : t('invoice.department');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1">
            {(['SUMMER', 'WINTER'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={q.season === s}
                onClick={() => set({ season: s, years: undefined })}
                className={`h-7 rounded-lg px-3 text-sm font-medium ${
                  q.season === s ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
                }`}
              >
                {t(s === 'SUMMER' ? 'dash.summer' : 'dash.winter')}
              </button>
            ))}
          </div>
          <select
            aria-label={t('scompare.years')}
            className={`${small} max-w-[10rem]`}
            value={q.count}
            onChange={(e) => set({ count: Number(e.target.value), years: undefined })}
          >
            {[2, 3, 4, 5].map((c) => (
              <option key={c} value={c}>
                {t('scompare.lastYears').replace('{n}', n(c))}
              </option>
            ))}
          </select>
          <div className="flex gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1">
            {views.map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={q.by === v}
                onClick={() => set({ by: v })}
                className={`h-7 rounded-lg px-3 text-sm font-medium ${
                  q.by === v ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            aria-label={t('scompare.show')}
            className={`${small} max-w-[12rem]`}
            value={shown.key}
            onChange={(e) => setFigure(e.target.value)}
          >
            {figures.map((f) => (
              <option key={f.key} value={f.key}>
                {t(f.label)}
              </option>
            ))}
          </select>
        </div>
        <ReportActions
          scope="reports"
          disabled={!data}
          onPrint={() => report.print(paper.current, title, subtitle)}
          onExcel={() =>
            data &&
            report.excel(
              title,
              subtitle,
              [firstLabel, ...data.years.map(yearLabel)],
              data.rows.map((r) => [
                r.kind === 'ITEM' && r.code ? `${r.code} ${nameOf(r)}` : nameOf(r),
                ...r.years.map((c) => (shown.money ? { money: shown.value(c) } : shown.value(c))),
              ]),
              [
                t('ledger.total'),
                ...data.total.years.map((c) =>
                  shown.money ? { money: shown.value(c) } : shown.value(c),
                ),
              ],
            )
          }
        />
      </div>

      {(q.departmentId || q.supplierIds.length > 0) && (
        <nav className="flex flex-wrap items-center gap-1 text-sm" data-noprint>
          <button
            type="button"
            className="text-brand hover:underline"
            onClick={() => {
              setSupplierName(null);
              set({ by: 'department', departmentId: undefined, supplierIds: [] });
            }}
          >
            {t('assort.allDepartments')}
          </button>
          {[...(data?.path ?? []).map((p) => p.name), ...(supplierName ? [supplierName] : [])].map(
            (name) => (
              <span key={name} className="flex items-center gap-1">
                <Icon name="chevronRight" size={12} className="text-faint rtl:rotate-180" />
                <span className="font-medium">{name}</span>
              </span>
            ),
          )}
        </nav>
      )}

      {isLoading || !data ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : (
        <div ref={paper} className="space-y-3">
          <Card padded={false} className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-normal">{t('scompare.figure')}</th>
                  {data.years.map((y) => (
                    <th key={y} className="px-2 py-2 text-end font-semibold text-fg">
                      {yearLabel(y)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {figures.map((f) => (
                  <tr key={f.key} className={f.key === shown.key ? 'bg-brand-soft/40' : ''}>
                    <td className="px-3 py-1.5 text-muted">{t(f.label)}</td>
                    {data.total.years.map((c) => (
                      <td
                        key={c.year}
                        className={`px-2 py-1.5 text-end tnum ${f.key === 'net' ? 'font-semibold' : ''}`}
                      >
                        {show(f, c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {data.unplaced.netSales !== 0 && (
            <p className="text-xs text-muted">
              {t('scompare.unplaced').replace('{m}', m(data.unplaced.netSales))}
            </p>
          )}

          {data.rows.length === 0 ? (
            <Card>
              <EmptyState title={t('analytics.empty')} icon="inventory" />
            </Card>
          ) : (
            <Card padded={false} className="overflow-x-auto">
              <TableColumns id={`analytics.seasons.${q.by}`}>
                <table className="w-full min-w-[32rem] text-sm">
                  <thead className="bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 text-start font-normal">
                        {firstLabel} · {t(shown.label)}
                      </th>
                      {data.years.map((y) => (
                        <th key={y} className="px-2 py-2 text-end font-normal">
                          {yearLabel(y)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.rows.map((r) => (
                      <tr
                        key={`${r.kind}-${r.id}`}
                        className={opens(r) ? 'hover:bg-surface-2' : ''}
                      >
                        <td className="max-w-[18rem] px-3 py-1.5 font-medium">
                          {opens(r) ? (
                            <button
                              type="button"
                              className="flex max-w-full items-center gap-1 text-start hover:text-brand hover:underline"
                              onClick={() => open(r)}
                            >
                              <span className="truncate">
                                {r.code && r.kind === 'SUPPLIER' && (
                                  <span className="me-1 text-xs text-faint tnum">{r.code}</span>
                                )}
                                {nameOf(r)}
                              </span>
                              <Icon
                                name="chevronRight"
                                size={12}
                                className="shrink-0 text-faint rtl:rotate-180"
                              />
                            </button>
                          ) : (
                            <span className="block truncate">
                              {nameOf(r)}{' '}
                              {r.code && <span className="text-xs text-faint">{r.code}</span>}
                            </span>
                          )}
                          {r.kind === 'ITEM' && r.detail && (
                            <span className="block truncate text-xs font-normal text-muted">
                              {r.detail}
                            </span>
                          )}
                        </td>
                        {r.years.map((c) => (
                          <td
                            key={c.year}
                            className={`px-2 py-1.5 text-end tnum ${
                              c.items === 0 ? 'text-faint' : ''
                            } ${shown.key === 'profit' && c.profit < 0 ? 'text-destructive' : ''}`}
                          >
                            {c.items === 0 ? '–' : show(shown, c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-line bg-surface-2 font-semibold">
                    <tr>
                      <td className="px-3 py-2">{t('ledger.total')}</td>
                      {data.total.years.map((c) => (
                        <td key={c.year} className="px-2 py-2 text-end tnum">
                          {show(shown, c)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </TableColumns>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
