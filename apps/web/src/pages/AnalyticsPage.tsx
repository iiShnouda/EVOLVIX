import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDate, formatMoney, formatNumber, type TranslationKey } from '@skb/shared';
import { Card, EmptyState, PageHeader, SectionTitle, Spinner } from '../components/ui';
import { TrendChart } from '../components/charts/TrendChart';
import { ProfitabilityPage } from './ProfitabilityPage';
import { useT } from '../lib/i18n';
import { useItemMovement, useMonthlySales, useTopParties } from '../lib/queries';

type Tab = 'profit' | 'monthly' | 'parties' | 'items';
const TABS: { key: Tab; label: TranslationKey }[] = [
  { key: 'profit', label: 'analytics.tabProfit' },
  { key: 'monthly', label: 'analytics.tabMonthly' },
  { key: 'parties', label: 'analytics.tabParties' },
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

/** Analytics & reports (التحليلات والتقارير): profitability, monthly sales, top parties, item movement. */
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
      {tab === 'parties' && <PartiesTab />}
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
  return (
    <div className="space-y-3">
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
      {isLoading || !data ? (
        <Loading />
      ) : (
        <>
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
                    <td className="px-3 py-1.5">
                      {new Date(`${x.month}-15`).toLocaleDateString(
                        locale === 'ar' ? 'ar-EG' : 'en-US',
                        {
                          month: 'long',
                          year: 'numeric',
                        },
                      )}
                    </td>
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
        </>
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
