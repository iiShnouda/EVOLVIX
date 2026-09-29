import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDate, formatMoney, formatNumber, type TranslationKey } from '@skb/shared';
import { Card, EmptyState, PageHeader, SectionTitle, Spinner } from '../components/ui';
import { TrendChart } from '../components/charts/TrendChart';
import { ProfitabilityPage } from './ProfitabilityPage';
import { ReportActions } from '../components/ReportActions';
import { LedgerStatementSheet } from '../components/LedgerStatementSheet';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useReportTools } from '../lib/report';
import {
  useAging,
  useItemMovement,
  useMonthlySales,
  usePerformance,
  useTopParties,
} from '../lib/queries';

type Tab = 'profit' | 'monthly' | 'performance' | 'parties' | 'aging' | 'items';
const TABS: { key: Tab; label: TranslationKey }[] = [
  { key: 'profit', label: 'analytics.tabProfit' },
  { key: 'monthly', label: 'analytics.tabMonthly' },
  { key: 'performance', label: 'analytics.tabPerformance' },
  { key: 'parties', label: 'analytics.tabParties' },
  { key: 'aging', label: 'analytics.tabAging' },
  { key: 'items', label: 'analytics.tabItems' },
];
const small =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

/**
 * Analytics & reports (التحليلات والتقارير): profitability, monthly sales, top parties, aging of
 * debts, item movement.
 */
export function AnalyticsPage() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((x) => x.key === params.get('tab'))?.key ?? 'profit') as Tab;
  return (
    <div className="space-y-5">
      <PageHeader title={t('analytics.title')} subtitle={t('analytics.subtitle')} />
      <div
        role="tablist"
        className="flex max-w-full flex-wrap gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1"
      >
        {TABS.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => setParams({ tab: x.key }, { replace: true })}
            className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
              tab === x.key ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
            }`}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      {tab === 'profit' && <ProfitabilityPage embedded />}
      {tab === 'monthly' && <MonthlyTab />}
      {tab === 'performance' && <PerformanceTab />}
      {tab === 'parties' && <PartiesTab />}
      {tab === 'aging' && <AgingTab />}
      {tab === 'items' && <ItemsTab />}
    </div>
  );
}

function Loading() {
  return (
    <div className="grid place-items-center py-16 text-muted">
      <Spinner size={26} />
    </div>
  );
}

function Period({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="mb-1 block text-xs text-muted">{t('report.from')}</span>
        <input
          className={small}
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted">{t('report.to')}</span>
        <input
          className={small}
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
    </div>
  );
}

function MonthlyTab() {
  const { t, locale } = useT();
  const [months, setMonths] = useState(12);
  const { data, isLoading } = useMonthlySales(months);
  const currency = 'EGP';
  const m = (v: number) => formatMoney(v, currency, locale);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const monthName = (month: string) =>
    new Date(`${month}-15`).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', {
      month: 'long',
      year: 'numeric',
    });
  const subtitle = `${t('analytics.months')}: ${formatNumber(months, locale)}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">{t('analytics.months')}</span>
          <select
            className={small}
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {[3, 6, 12, 24].map((n) => (
              <option key={n} value={n}>
                {formatNumber(n, locale)}
              </option>
            ))}
          </select>
        </label>
        <ReportActions
          disabled={!data}
          onPrint={() => report.print(paper.current, t('analytics.tabMonthly'), subtitle)}
          onExcel={() =>
            data &&
            report.excel(
              t('analytics.tabMonthly'),
              subtitle,
              [
                t('analytics.month'),
                t('analytics.sales'),
                t('analytics.returns'),
                t('analytics.netSales'),
                t('analytics.netPurchases'),
                t('analytics.invoices'),
              ],
              [...data]
                .reverse()
                .map((x) => [
                  monthName(x.month),
                  { money: x.sales },
                  { money: x.returns },
                  { money: x.netSales },
                  { money: x.netPurchases },
                  x.invoices,
                ]),
              [
                t('ledger.total'),
                { money: data.reduce((s, x) => s + x.sales, 0) },
                { money: data.reduce((s, x) => s + x.returns, 0) },
                { money: data.reduce((s, x) => s + x.netSales, 0) },
                { money: data.reduce((s, x) => s + x.netPurchases, 0) },
                data.reduce((s, x) => s + x.invoices, 0),
              ],
            )
          }
        />
      </div>
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div ref={paper} className="space-y-3">
          <Card>
            <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> {t('analytics.netSales')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-info opacity-60" />{' '}
                {t('analytics.netPurchases')}
              </span>
            </div>
            <TrendChart
              data={data.map((x) => ({
                date: `${x.month}-15`,
                sales: x.netSales,
                purchases: x.netPurchases,
              }))}
              locale={locale}
              currency={currency}
              labels="month"
            />
          </Card>
          <Card padded={false} className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-normal">{t('analytics.month')}</th>
                  <th className="px-3 py-2 text-end font-normal">{t('analytics.sales')}</th>
                  <th className="px-3 py-2 text-end font-normal">{t('analytics.returns')}</th>
                  <th className="px-3 py-2 text-end font-normal">{t('analytics.netSales')}</th>
                  <th className="px-3 py-2 text-end font-normal">{t('analytics.netPurchases')}</th>
                  <th className="px-3 py-2 text-end font-normal">{t('analytics.invoices')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...data].reverse().map((x) => (
                  <tr key={x.month}>
                    <td className="px-3 py-1.5">{monthName(x.month)}</td>
                    <td className="px-3 py-1.5 text-end tnum">{m(x.sales)}</td>
                    <td className="px-3 py-1.5 text-end tnum">{m(x.returns)}</td>
                    <td className="px-3 py-1.5 text-end font-medium tnum">{m(x.netSales)}</td>
                    <td className="px-3 py-1.5 text-end tnum">{m(x.netPurchases)}</td>
                    <td className="px-3 py-1.5 text-end tnum">
                      {formatNumber(x.invoices, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * Sales performance (أداء المبيعات) by person (the sale's rep, else who made it) or by branch:
 * net sales after returns, profit, invoices, customers, average invoice, and quotations won.
 */
function PerformanceTab() {
  const { t, locale } = useT();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(iso(new Date()));
  const [by, setBy] = useState<'rep' | 'branch'>('rep');
  const { data, isLoading } = usePerformance(from, to, by);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const m = (v: number) => formatMoney(v, data?.currency ?? 'EGP', locale);
  const n = (v: number) => formatNumber(v, locale);
  const byLabel = by === 'rep' ? t('perf.byPerson') : t('perf.byBranch');
  const period = `${formatDate(from, locale)} – ${formatDate(to, locale)}`;
  const header = [
    by === 'rep' ? t('perf.person') : t('perf.branch'),
    t('analytics.netSales'),
    t('perf.share'),
    t('perf.profit'),
    t('analytics.invoices'),
    t('perf.customers'),
    t('perf.average'),
    t('analytics.returns'),
    t('perf.collected'),
    t('perf.quotes'),
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <div className="flex gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1">
            {(['rep', 'branch'] as const).map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={by === b}
                onClick={() => setBy(b)}
                className={`h-7 rounded-lg px-3 text-sm font-medium ${
                  by === b ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
                }`}
              >
                {b === 'rep' ? t('perf.byPerson') : t('perf.byBranch')}
              </button>
            ))}
          </div>
        </div>
        <ReportActions
          disabled={!data}
          onPrint={() =>
            report.print(paper.current, `${t('analytics.tabPerformance')} — ${byLabel}`, period)
          }
          onExcel={() =>
            data &&
            report.excel(
              `${t('analytics.tabPerformance')} — ${byLabel}`,
              period,
              header,
              data.rows.map((r) => [
                r.name,
                { money: r.netSales },
                r.share,
                { money: r.profit },
                r.invoices,
                r.customers,
                { money: r.averageInvoice },
                { money: r.returns },
                { money: r.collected },
                `${r.quotesWon} / ${r.quotes}`,
              ]),
              [
                t('ledger.total'),
                { money: data.netSales },
                100,
                { money: data.profit },
                data.invoices,
              ],
            )
          }
        />
      </div>
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div ref={paper} className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              [t('analytics.netSales'), m(data.netSales)],
              [t('perf.profit'), m(data.profit)],
              [t('analytics.invoices'), n(data.invoices)],
            ].map(([label, value]) => (
              <Card key={label} className="!p-3">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-0.5 font-semibold tnum">{value}</p>
              </Card>
            ))}
          </div>
          {data.rows.length === 0 ? (
            <Card>
              <EmptyState title={t('analytics.empty')} icon="analytics" />
            </Card>
          ) : (
            <Card padded={false} className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-sm">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    {header.map((h, i) => (
                      <th
                        key={h}
                        className={`px-2 py-2 font-normal ${i === 0 ? 'px-3 text-start' : 'text-end'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-1.5 font-medium">{r.name}</td>
                      <td className="px-2 py-1.5 text-end font-medium tnum">{m(r.netSales)}</td>
                      <td className="px-2 py-1.5 text-end tnum">
                        {formatNumber(r.share, locale)}%
                        <div className="mt-0.5 h-1 rounded-full bg-surface-2">
                          <div
                            className="h-1 rounded-full bg-brand"
                            style={{ width: `${Math.max(0, Math.min(100, r.share))}%` }}
                          />
                        </div>
                      </td>
                      <td
                        className={`px-2 py-1.5 text-end tnum ${r.profit < 0 ? 'text-destructive' : ''}`}
                      >
                        {m(r.profit)}
                      </td>
                      <td className="px-2 py-1.5 text-end tnum">{n(r.invoices)}</td>
                      <td className="px-2 py-1.5 text-end tnum">{n(r.customers)}</td>
                      <td className="px-2 py-1.5 text-end tnum">{m(r.averageInvoice)}</td>
                      <td className="px-2 py-1.5 text-end tnum">
                        {r.returns ? m(r.returns) : '–'}
                      </td>
                      <td className="px-2 py-1.5 text-end tnum">{m(r.collected)}</td>
                      <td className="px-2 py-1.5 text-end tnum">
                        {r.quotes ? `${n(r.quotesWon)} / ${n(r.quotes)}` : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <p className="text-xs text-faint">{t('perf.hint')}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Aging of debts (أعمار الديون): what each customer owes — or what we owe each supplier — on open
 * invoices, by how old the invoice is.
 */
function AgingTab() {
  const { t, locale } = useT();
  const can = useCan();
  const [side, setSide] = useState<'customers' | 'suppliers'>('customers');
  const { data, isLoading } = useAging(side);
  const [statement, setStatement] = useState<{ id: string; name: string } | null>(null);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const m = (v: number) => (v ? formatMoney(v, data?.currency ?? 'EGP', locale) : '–');
  const sideLabel = side === 'customers' ? t('analytics.customers') : t('analytics.suppliers');
  const cols = [
    t('aging.current'),
    t('aging.d31_60'),
    t('aging.d61_90'),
    t('aging.over90'),
  ] as const;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1">
          {(['customers', 'suppliers'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              onClick={() => setSide(s)}
              className={`h-8 rounded-lg px-3 text-sm font-medium ${
                side === s ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
              }`}
            >
              {s === 'customers' ? t('aging.customers') : t('aging.suppliers')}
            </button>
          ))}
        </div>
        <ReportActions
          disabled={!data}
          onPrint={() => report.print(paper.current, t('analytics.tabAging'), sideLabel)}
          onExcel={() =>
            data &&
            report.excel(
              t('analytics.tabAging'),
              sideLabel,
              [
                t('common.name'),
                ...cols,
                t('aging.total'),
                t('aging.balance'),
                t('aging.onAccount'),
              ],
              data.rows.map((r) => [
                r.name,
                { money: r.current },
                { money: r.days31To60 },
                { money: r.days61To90 },
                { money: r.over90 },
                { money: r.total },
                { money: r.balance },
                { money: r.onAccount },
              ]),
              [
                t('ledger.total'),
                { money: data.current },
                { money: data.days31To60 },
                { money: data.days61To90 },
                { money: data.over90 },
                { money: data.total },
              ],
            )
          }
        />
      </div>
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div ref={paper} className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              [cols[0], data.current, ''],
              [cols[1], data.days31To60, ''],
              [cols[2], data.days61To90, 'text-warning'],
              [cols[3], data.over90, 'text-destructive'],
              [t('aging.total'), data.total, 'font-semibold'],
            ].map(([label, value, tone]) => (
              <Card key={label as string} className="!p-3">
                <p className="text-xs text-muted">{label as string}</p>
                <p className={`mt-0.5 tnum ${tone as string}`}>
                  {formatMoney(value as number, data.currency, locale)}
                </p>
              </Card>
            ))}
          </div>
          {data.rows.length === 0 ? (
            <Card>
              <EmptyState title={t('aging.empty')} icon="parties" />
            </Card>
          ) : (
            <Card padded={false} className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 text-start font-normal">{t('common.name')}</th>
                    {cols.map((c) => (
                      <th key={c} className="px-2 py-2 text-end font-normal">
                        {c}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-end font-normal">{t('aging.total')}</th>
                    <th className="px-3 py-2 text-end font-normal">{t('aging.balance')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.rows.map((r) => (
                    <tr key={r.partyId}>
                      <td className="px-3 py-1.5">
                        {can('ledger:view') ? (
                          <button
                            type="button"
                            className="text-start hover:text-brand hover:underline"
                            onClick={() => setStatement({ id: r.partyId, name: r.name })}
                          >
                            {r.name}
                          </button>
                        ) : (
                          r.name
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-end tnum">{m(r.current)}</td>
                      <td className="px-2 py-1.5 text-end tnum">{m(r.days31To60)}</td>
                      <td className="px-2 py-1.5 text-end tnum text-warning">{m(r.days61To90)}</td>
                      <td className="px-2 py-1.5 text-end tnum text-destructive">{m(r.over90)}</td>
                      <td className="px-2 py-1.5 text-end font-medium tnum">{m(r.total)}</td>
                      <td className="px-3 py-1.5 text-end tnum">
                        {formatMoney(r.balance, data.currency, locale)}
                        {r.onAccount !== 0 && (
                          <span className="block text-xs text-muted">
                            {t('aging.onAccount')}:{' '}
                            {formatMoney(r.onAccount, data.currency, locale)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <p className="text-xs text-faint">{t('aging.hint')}</p>
        </div>
      )}
      {statement && (
        <LedgerStatementSheet
          kind="parties"
          id={statement.id}
          title={statement.name}
          onClose={() => setStatement(null)}
        />
      )}
    </div>
  );
}

function PartiesTab() {
  const { t } = useT();
  const [from, setFrom] = useState(daysAgo(89));
  const [to, setTo] = useState(iso(new Date()));
  return (
    <div className="space-y-3">
      <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div className="grid gap-3 lg:grid-cols-2">
        <TopList title={t('analytics.customers')} from={from} to={to} side="customers" />
        <TopList title={t('analytics.suppliers')} from={from} to={to} side="suppliers" />
      </div>
    </div>
  );
}

function TopList({
  title,
  from,
  to,
  side,
}: {
  title: string;
  from: string;
  to: string;
  side: 'customers' | 'suppliers';
}) {
  const { t, locale } = useT();
  const { data, isLoading } = useTopParties(from, to, side);
  const max = Math.max(1, ...(data ?? []).map((p) => p.net));
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      {isLoading || !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted">{t('analytics.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {data.map((p) => (
            <li key={p.partyId} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="shrink-0 tnum">
                  {formatMoney(p.net, 'EGP', locale)}{' '}
                  <span className="text-xs text-muted">({formatNumber(p.share, locale)}%)</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                <div
                  className="h-1.5 rounded-full bg-brand"
                  style={{ width: `${Math.max(2, (Math.max(0, p.net) / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ItemsTab() {
  const { t, locale } = useT();
  const [from, setFrom] = useState(daysAgo(89));
  const [to, setTo] = useState(iso(new Date()));
  const { data, isLoading } = useItemMovement(from, to);
  const m = (v: number) => formatMoney(v, data?.currency ?? 'EGP', locale);
  return (
    <div className="space-y-3">
      <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card padded={false} className="overflow-x-auto">
            <div className="px-4 pt-4">
              <SectionTitle>{t('analytics.topMovers')}</SectionTitle>
            </div>
            {data.topMovers.length === 0 ? (
              <EmptyState title={t('analytics.empty')} icon="inventory" />
            ) : (
              <table className="w-full min-w-[26rem] text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="px-4 py-1 text-start font-normal">{t('analytics.item')}</th>
                    <th className="px-2 py-1 text-end font-normal">{t('analytics.qtyOut')}</th>
                    <th className="px-2 py-1 text-end font-normal">{t('analytics.qtyIn')}</th>
                    <th className="px-4 py-1 text-end font-normal">{t('analytics.netSales')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.topMovers.map((x) => (
                    <tr key={x.productId}>
                      <td className="max-w-[12rem] truncate px-4 py-1.5">
                        {x.name} <span className="text-xs text-faint">{x.sku}</span>
                      </td>
                      <td className="px-2 py-1.5 text-end tnum">
                        {formatNumber(x.quantityOut, locale)}
                      </td>
                      <td className="px-2 py-1.5 text-end tnum">
                        {formatNumber(x.quantityIn, locale)}
                      </td>
                      <td className="px-4 py-1.5 text-end tnum">{m(x.salesValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card padded={false} className="overflow-x-auto">
            <div className="px-4 pt-4">
              <SectionTitle>{t('analytics.deadStock')}</SectionTitle>
            </div>
            {data.deadStock.length === 0 ? (
              <EmptyState title={t('analytics.empty')} icon="inventory" />
            ) : (
              <table className="w-full min-w-[26rem] text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="px-4 py-1 text-start font-normal">{t('analytics.item')}</th>
                    <th className="px-2 py-1 text-end font-normal">{t('analytics.stock')}</th>
                    <th className="px-2 py-1 text-end font-normal">{t('analytics.valueAtCost')}</th>
                    <th className="px-4 py-1 text-end font-normal">{t('analytics.lastSale')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.deadStock.map((x) => (
                    <tr key={x.productId}>
                      <td className="max-w-[12rem] truncate px-4 py-1.5">
                        {x.name} <span className="text-xs text-faint">{x.sku}</span>
                      </td>
                      <td className="px-2 py-1.5 text-end tnum">{formatNumber(x.stock, locale)}</td>
                      <td className="px-2 py-1.5 text-end tnum">{m(x.stockValue)}</td>
                      <td className="px-4 py-1.5 text-end text-xs">
                        {x.lastSale ? formatDate(x.lastSale, locale) : t('analytics.never')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
