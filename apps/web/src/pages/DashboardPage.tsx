import { useState, type ReactNode } from 'react';
import {
  formatMoney,
  formatNumber,
  type DashRank,
  type KpiValue,
  type TranslationKey,
} from '@skb/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
  Spinner,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { TrendChart } from '../components/charts/TrendChart';
import { useNavigate } from 'react-router-dom';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useDashboard, useDashboardMore, useHiddenColumns } from '../lib/queries';
import { Sheet } from '../components/Sheet';
import { KPI_TONE_MAP, STATUS_TONE } from '../lib/status';

const KPI_ICON: Record<string, string> = {
  'kpi.revenue': 'sales',
  'kpi.purchases': 'purchases',
  'kpi.receivables': 'parties',
  'kpi.payables': 'receipts',
  'kpi.lowStock': 'inventory',
  'kpi.cashPosition': 'analytics',
};

/** Every widget the dashboard can show, in order; each person picks theirs (owner, 2026-10-01). */
const WIDGETS = [
  ['kpis', 'dash.w.kpis'],
  ['today', 'dash.w.today'],
  ['month', 'dash.w.month'],
  ['alerts', 'dash.w.alerts'],
  ['trend', 'dashboard.trend'],
  ['lowStock', 'dashboard.lowStock'],
  ['topCustomers', 'dash.w.topCustomers'],
  ['topItems', 'dash.w.topItems'],
  ['branches', 'dash.w.branches'],
  ['accounts', 'dash.w.accounts'],
  ['notesDue', 'dash.w.notesDue'],
  ['recent', 'dashboard.recent'],
] as const satisfies readonly (readonly [string, TranslationKey])[];
type Widget = (typeof WIDGETS)[number][0];

export function DashboardPage() {
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useDashboard();
  const more = useDashboardMore().data;
  // Kept on the server for the person, like hidden columns.
  const [hidden, setHidden] = useHiddenColumns('dashboard.widgets');
  const shows = (w: Widget) => !hidden.includes(w);
  const [choosing, setChoosing] = useState(false);

  if (isLoading) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner size={28} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Card>
        <EmptyState title={t('common.errorTitle')} hint={t('common.errorBody')} icon="close" />
        <div className="flex justify-center">
          <Button variant="secondary" icon="wifi" onClick={() => refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.dashboard')}
        action={
          <div className="flex gap-2">
            <Button icon="settings" size="sm" variant="ghost" onClick={() => setChoosing(true)}>
              {t('dash.customize')}
            </Button>
            {can('sales:create') && (
              <Button
                icon="plus"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => navigate('/sales/new')}
              >
                {t('dashboard.newInvoice')}
              </Button>
            )}
            {can('receipts:create') && (
              <Button
                icon="plus"
                size="sm"
                variant="secondary"
                className="hidden sm:inline-flex"
                onClick={() => navigate('/receipts?tab=vouchers&new=receipt')}
              >
                {t('dashboard.newReceipt')}
              </Button>
            )}
          </div>
        }
      />

      {/* KPI grid */}
      {shows('kpis') && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
          {data.kpis.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} locale={locale} label={t(kpi.key as never)} />
          ))}
        </div>
      )}

      {more && <MoreWidgets more={more} shows={shows} currency={data.currency} />}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Trend */}
        {shows('trend') && (
          <Card className="lg:col-span-2">
            <SectionTitle
              action={
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> {t('nav.sales')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-info opacity-60" />{' '}
                    {t('nav.purchases')}
                  </span>
                </div>
              }
            >
              {t('dashboard.trend')}
            </SectionTitle>
            <TrendChart data={data.trend} locale={locale} currency={data.currency} />
          </Card>
        )}

        {/* Low stock */}
        {shows('lowStock') && (
          <Card>
            <SectionTitle>{t('dashboard.lowStock')}</SectionTitle>
            {data.lowStock.length === 0 ? (
              <EmptyState title={t('common.empty')} icon="inventory" />
            ) : (
              <ul className="space-y-2">
                {data.lowStock.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="text-xs text-muted">{p.sku}</span>
                    </span>
                    <Badge tone="destructive">
                      <span className="tnum">
                        {formatNumber(p.stockOnHand, locale)} /{' '}
                        {formatNumber(p.reorderLevel, locale)}
                      </span>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {/* Recent documents */}
      {shows('recent') && (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <SectionTitle>{t('dashboard.recent')}</SectionTitle>
          </div>
          <ul className="divide-y divide-[var(--c-line)]">
            {data.recentDocuments.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                  <Icon name="receipts" size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{doc.partyName}</span>
                  <span className="text-xs text-muted tnum">{doc.number}</span>
                </span>
                <Badge tone={STATUS_TONE[doc.status]}>{t(`status.${doc.status}`)}</Badge>
                <span className="w-28 text-end text-sm font-semibold tnum">
                  {formatMoney(doc.grandTotal, doc.currency, locale)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {choosing && (
        <Sheet
          title={t('dash.shown')}
          onClose={() => setChoosing(false)}
          closeLabel={t('common.close')}
        >
          <ul className="space-y-1">
            {WIDGETS.map(([id, label]) => (
              <li key={id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-app)] px-2 py-2 text-sm hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={shows(id)}
                    onChange={() =>
                      setHidden(shows(id) ? [...hidden, id] : hidden.filter((x) => x !== id))
                    }
                  />
                  {t(label)}
                </label>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}

/** Today, this month, alerts, rankings, money and cheques: each only when the server sent it. */
function MoreWidgets({
  more,
  shows,
  currency,
}: {
  more: NonNullable<ReturnType<typeof useDashboardMore>['data']>;
  shows: (w: Widget) => boolean;
  currency: string;
}) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const money = (v: number) => formatMoney(v, currency, locale);
  const change =
    more.month && more.month.lastMonth > 0
      ? Math.round(((more.month.sales - more.month.lastMonth) * 100) / more.month.lastMonth)
      : null;
  const alerts = [
    more.awaitingApproval
      ? { label: t('dash.awaiting'), value: more.awaitingApproval, to: '/sales?state=AWAITING' }
      : null,
    more.overLimitCount
      ? { label: t('dash.overLimit'), value: more.overLimitCount, to: '/parties' }
      : null,
  ].filter((x) => !!x);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shows('today') && more.today && (
          <Card>
            <SectionTitle>{t('dash.w.today')}</SectionTitle>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat
                className="col-span-2"
                label={t('dash.todaySales')}
                value={money(more.today.sales)}
                strong
              />
              <Stat label={t('dash.invoices')} value={formatNumber(more.today.invoices, locale)} />
              <Stat label={t('dash.returns')} value={money(more.today.returns)} />
            </dl>
          </Card>
        )}
        {shows('month') && more.month && (
          <Card>
            <SectionTitle
              action={
                change != null ? (
                  <Badge tone={change >= 0 ? 'positive' : 'destructive'}>
                    <span className="tnum" dir="ltr">
                      {change >= 0 ? '+' : ''}
                      {change}%
                    </span>
                  </Badge>
                ) : undefined
              }
            >
              {t('dash.w.month')}
            </SectionTitle>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat label={t('dash.todaySales')} value={money(more.month.sales)} strong />
              <Stat label={t('dash.lastMonth')} value={money(more.month.lastMonth)} />
              {more.month.profit != null && (
                <Stat label={t('dash.profit')} value={money(more.month.profit)} />
              )}
              {more.month.expenses != null && (
                <Stat label={t('dash.expenses')} value={money(more.month.expenses)} />
              )}
              {more.stockValue != null && (
                <Stat label={t('dash.stockValue')} value={money(more.stockValue)} />
              )}
            </dl>
          </Card>
        )}
        {shows('alerts') && (alerts.length > 0 || (more.overLimit?.length ?? 0) > 0) && (
          <Card>
            <SectionTitle>{t('dash.w.alerts')}</SectionTitle>
            <ul className="space-y-2 text-sm">
              {alerts.map((a) => (
                <li key={a.label}>
                  <button
                    className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-app)] bg-warning-soft px-3 py-2 text-start text-warning"
                    onClick={() => navigate(a.to)}
                  >
                    <span>{a.label}</span>
                    <span className="font-semibold tnum">{formatNumber(a.value, locale)}</span>
                  </button>
                </li>
              ))}
              {(more.overLimit ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-1">
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="text-xs text-destructive tnum">
                    {money(p.value)} / {money(p.extra ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {shows('notesDue') && more.notesDue && (
          <Card>
            <SectionTitle>{t('dash.w.notesDue')}</SectionTitle>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat
                label={`${t('dash.toCollect')} (${formatNumber(more.notesDue.receivable, locale)})`}
                value={money(more.notesDue.receivableAmount)}
              />
              <Stat
                label={`${t('dash.toPay')} (${formatNumber(more.notesDue.payable, locale)})`}
                value={money(more.notesDue.payableAmount)}
              />
            </dl>
          </Card>
        )}
        {shows('accounts') && more.accounts && (
          <Card>
            <SectionTitle>{t('dash.w.accounts')}</SectionTitle>
            <Ranking
              rows={more.accounts.map((a) => ({ id: a.id, name: a.name, value: a.balance }))}
              money={money}
            />
          </Card>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {shows('topCustomers') && more.topCustomers && (
          <Card>
            <SectionTitle>{t('dash.w.topCustomers')}</SectionTitle>
            <Ranking rows={more.topCustomers} money={money} />
          </Card>
        )}
        {shows('topItems') && more.topItems && (
          <Card>
            <SectionTitle>{t('dash.w.topItems')}</SectionTitle>
            <Ranking
              rows={more.topItems}
              money={money}
              note={(r) =>
                r.quantity != null
                  ? `${formatNumber(r.quantity, locale)} ${t('dash.pieces')}`
                  : null
              }
            />
          </Card>
        )}
        {shows('branches') && more.branches && (
          <Card>
            <SectionTitle>{t('dash.w.branches')}</SectionTitle>
            <Ranking rows={more.branches} money={money} bars />
          </Card>
        )}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  strong,
  className = '',
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-[var(--radius-app)] bg-surface-2 px-2.5 py-2 ${className}`}>
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 truncate tnum ${strong ? 'text-base font-semibold' : 'font-medium'}`}>
        {value}
      </dd>
    </div>
  );
}

/** A short ranked list; `bars` draws each value against the biggest. */
function Ranking({
  rows,
  money,
  note,
  bars,
}: {
  rows: DashRank[];
  money: (v: number) => string;
  note?: (r: DashRank) => string | null;
  bars?: boolean;
}) {
  const { t } = useT();
  if (rows.length === 0) return <p className="text-sm text-muted">{t('dash.none')}</p>;
  const top = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ol className="space-y-2 text-sm">
      {rows.map((r, i) => (
        <li key={r.id} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-4 shrink-0 text-xs text-faint tnum">{i + 1}</span>
              <span className="truncate">{r.name}</span>
              {note?.(r) && <span className="shrink-0 text-xs text-muted">{note(r)}</span>}
            </span>
            <span className="shrink-0 font-medium tnum">{money(r.value)}</span>
          </div>
          {bars && (
            <div className="ms-6 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.round((Math.abs(r.value) * 100) / top)}%` }}
              />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function KpiCard({ kpi, locale, label }: { kpi: KpiValue; locale: 'en' | 'ar'; label: string }) {
  const tone = KPI_TONE_MAP[kpi.tone] ?? 'neutral';
  const value = kpi.isMoney
    ? formatMoney(kpi.value, kpi.currency ?? 'EGP', locale)
    : formatNumber(kpi.value, locale);
  const toneText: Record<string, string> = {
    positive: 'text-positive',
    warning: 'text-warning',
    destructive: 'text-destructive',
    info: 'text-info',
    neutral: 'text-fg',
    brand: 'text-brand',
  };
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        <Icon name={KPI_ICON[kpi.key] ?? 'analytics'} size={16} className="text-faint" />
      </div>
      <p className={`mt-2 text-lg font-semibold tnum sm:text-xl ${toneText[tone]}`}>{value}</p>
    </Card>
  );
}
