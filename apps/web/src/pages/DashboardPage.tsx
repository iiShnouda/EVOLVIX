import { ProfitLossCard } from '../components/ProfitLossView';
import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  formatDate,
  formatMoney,
  formatNumber,
  type DashRank,
  type DashboardData,
  type KpiValue,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import { Icon } from '../components/Icon';
import { AreaTrend, Donut, Ring, SHARE_COLORS, Sparkline } from '../components/charts/DashCharts';
import { CardPeriod, NowTag, PeriodPicker } from '../components/PeriodPicker';
import { useNavigate } from 'react-router-dom';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { periodOf, type Period } from '../lib/period';
import { useDashboard, useDashboardMore, useHiddenColumns } from '../lib/queries';
import { Sheet } from '../components/Sheet';
import { KPI_TONE_MAP, STATUS_TONE } from '../lib/status';
import { CodeName } from '../components/CodeName';

const KPI_ICON: Record<string, string> = {
  'kpi.revenue': 'sales',
  'kpi.purchases': 'purchases',
  'kpi.receivables': 'parties',
  'kpi.payables': 'receipts',
  'kpi.lowStock': 'inventory',
  'kpi.cashPosition': 'analytics',
};

/** The stat cards that count a period; the others are balances as they are now. */
const PERIOD_KPIS = new Set(['kpi.revenue', 'kpi.purchases']);

/** Each tone's soft tile and its colour (the icon tiles and sparklines of the stat cards). */
const TONE_TILE: Record<Tone, { tile: string; text: string; color: string }> = {
  positive: { tile: 'bg-positive-soft', text: 'text-positive', color: 'var(--c-positive)' },
  warning: { tile: 'bg-warning-soft', text: 'text-warning', color: 'var(--c-warning)' },
  destructive: {
    tile: 'bg-destructive-soft',
    text: 'text-destructive',
    color: 'var(--c-destructive)',
  },
  info: { tile: 'bg-info-soft', text: 'text-info', color: 'var(--c-info)' },
  brand: { tile: 'bg-brand-soft', text: 'text-brand', color: 'var(--c-brand)' },
  neutral: { tile: 'bg-surface-2', text: 'text-fg', color: 'var(--c-muted)' },
};

/** Every widget the dashboard can show, in order; each person picks theirs (owner, 2026-10-01). */
const WIDGETS = [
  ['kpis', 'dash.w.kpis'],
  ['profit', 'pnl.title'],
  ['trend', 'dashboard.trend'],
  ['month', 'dash.w.month'],
  ['today', 'dash.w.today'],
  ['topItems', 'dash.w.topItems'],
  ['topCustomers', 'dash.w.topCustomers'],
  ['branches', 'dash.w.branches'],
  ['recent', 'dashboard.recent'],
  ['alerts', 'dash.w.alerts'],
  ['notesDue', 'dash.w.notesDue'],
  ['accounts', 'dash.w.accounts'],
  ['lowStock', 'dashboard.lowStock'],
] as const satisfies readonly (readonly [string, TranslationKey])[];
type Widget = (typeof WIDGETS)[number][0];

/** The main period and the company's currency, for every card. */
const Main = createContext<{ period?: Period; currency: string }>({ currency: 'EGP' });

/** A card's period, whether it is its own, and how to change it (null = back to the main one). */
interface PeriodProps {
  period: Period;
  own: boolean;
  onPeriod: (p: Period | null) => void;
}

/**
 * The dashboard, laid out like the owner's reference pictures (2026-10-02). One period at the top
 * (a day, week, month, year or any dates) drives every card, and each card that counts a period
 * can be given its own (owner, 2026-10-02: "every part, by day, week, month, year or the dates I
 * want"). Balances, cash, limits and low stock are as they are now and say so. Each part shows only
 * what the server sent for the person, and each person picks the parts they see.
 */
export function DashboardPage() {
  const { t } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>(() => periodOf('month'));
  const [own, setOwn] = useState<Partial<Record<Widget, Period>>>({});
  const cardPeriod = (w: Widget): PeriodProps => ({
    period: own[w] ?? period,
    own: !!own[w],
    onPeriod: (p) =>
      setOwn((o) => {
        const next = { ...o };
        if (p) next[w] = p;
        else delete next[w];
        return next;
      }),
  });
  const { data, isLoading, isError, refetch } = useDashboard(period);
  const more = useDashboardMore(period).data;
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
    <Main.Provider value={{ period, currency: data.currency }}>
      <div className="min-w-0 space-y-5">
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

        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-app)] border border-line bg-surface px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="calendar" size={16} className="text-brand" />
            {t('period.title')}
          </span>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>

        {shows('kpis') && <KpiRow {...cardPeriod('kpis')} />}
        {/* Gains, losses and net profit by branch (owner, 2026-10-06), for people who may see costs. */}
        {shows('profit') && can('costs:view') && can('profit:view') && (
          <ProfitLossCard
            from={cardPeriod('profit').period.from}
            to={cardPeriod('profit').period.to}
            head={<CardHead title={t('pnl.title')} p={cardPeriod('profit')} />}
          />
        )}

        <div className="grid gap-4 [&>*]:min-w-0 xl:grid-cols-3">
          {shows('trend') && (
            <TrendCard
              {...cardPeriod('trend')}
              className={more?.month && shows('month') ? 'xl:col-span-2' : 'xl:col-span-3'}
            />
          )}
          {more?.month && shows('month') && (
            <MonthCard {...cardPeriod('month')} withCounts={shows('today')} />
          )}
        </div>

        {more && (
          <RankCards
            items={shows('topItems') && !!more.topItems ? cardPeriod('topItems') : null}
            customers={
              shows('topCustomers') && !!more.topCustomers ? cardPeriod('topCustomers') : null
            }
            branches={shows('branches') && !!more.branches ? cardPeriod('branches') : null}
          />
        )}

        <div className="grid gap-4 [&>*]:min-w-0 xl:grid-cols-3">
          {shows('recent') && (
            <HistoryCard
              {...cardPeriod('recent')}
              className="xl:col-span-2"
              onOpen={(doc) =>
                navigate(
                  `/${doc.type.startsWith('PURCHASE') ? 'purchases' : 'sales'}?${
                    doc.type.endsWith('RETURN') ? 'tab=returns&' : ''
                  }doc=${doc.id}`,
                )
              }
            />
          )}
          <div className="space-y-4">
            {more && shows('alerts') && <AlertsCard />}
            {more?.notesDue && shows('notesDue') && <NotesDueCard {...cardPeriod('notesDue')} />}
            {more?.accounts && shows('accounts') && <AccountsCard />}
            {shows('lowStock') && <LowStockCard data={data} />}
          </div>
        </div>

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
    </Main.Provider>
  );
}

/** A card's title with its period button (or a "now" tag) beside it. */
function CardHead({ title, p, extra }: { title: ReactNode; p?: PeriodProps; extra?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="flex items-center gap-2">
        {extra}
        {p ? <CardPeriod value={p.period} own={p.own} onChange={p.onPeriod} /> : <NowTag />}
      </div>
    </div>
  );
}

/** The stat cards: revenue and purchases for the period, the rest as they are now. */
function KpiRow(p: PeriodProps) {
  const { t } = useT();
  const { data } = useDashboard(p.period);
  if (!data) return null;
  return (
    <section>
      <CardHead title={t('dash.w.kpis')} p={p} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6 [&>*]:min-w-0">
        {data.kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} data={data} />
        ))}
      </div>
    </section>
  );
}

/** A stat card: coloured icon tile, the value, and the period's trend where there is one. */
function KpiCard({ kpi, data }: { kpi: KpiValue; data: DashboardData }) {
  const { t, locale } = useT();
  const tone = (KPI_TONE_MAP[kpi.tone] ?? 'neutral') as Tone;
  const style = TONE_TILE[kpi.key === 'kpi.cashPosition' ? 'brand' : tone];
  const value = kpi.isMoney
    ? formatMoney(kpi.value, kpi.currency ?? 'EGP', locale)
    : formatNumber(kpi.value, locale);
  const series =
    kpi.key === 'kpi.revenue'
      ? data.trend.map((d) => d.sales)
      : kpi.key === 'kpi.purchases'
        ? data.trend.map((d) => d.purchases)
        : null;
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${style.tile} ${style.text}`}
        >
          <Icon name={KPI_ICON[kpi.key] ?? 'analytics'} size={20} />
        </span>
        <span className="flex flex-col items-end gap-1 text-end text-xs font-medium text-muted">
          {t(kpi.key as TranslationKey)}
          {!PERIOD_KPIS.has(kpi.key) && <NowTag />}
        </span>
      </div>
      <p className="mt-3 text-[15px] font-bold whitespace-nowrap tnum sm:text-xl">{value}</p>
      {series && series.some((v) => v !== 0) ? (
        <div className="mt-auto pt-2">
          <Sparkline values={series} color={style.color} />
        </div>
      ) : (
        <div className={`mt-auto h-1 rounded-full pt-0 ${style.tile}`} />
      )}
    </Card>
  );
}

/** Sales against purchases over the period (a point a day, or a month for long periods). */
function TrendCard({ className, ...p }: PeriodProps & { className?: string }) {
  const { t, locale } = useT();
  const { data } = useDashboard(p.period);
  if (!data) return null;
  const money = (v: number) => formatMoney(v, data.currency, locale);
  const sales = data.trend.reduce((a, d) => a + d.sales, 0);
  const purchases = data.trend.reduce((a, d) => a + d.purchases, 0);
  const days = (Date.parse(p.period.to) - Date.parse(p.period.from)) / 86_400_000 + 1;
  return (
    <Card className={className}>
      <CardHead title={t('dashboard.trend')} p={p} />
      <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-brand" />
          <span className="text-muted">{t('nav.sales')}</span>
          <span className="font-semibold tnum">{money(sales)}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-info" />
          <span className="text-muted">{t('nav.purchases')}</span>
          <span className="font-semibold tnum">{money(purchases)}</span>
        </span>
      </div>
      <AreaTrend
        data={data.trend}
        locale={locale}
        currency={data.currency}
        monthly={days > 62}
        labels={{ sales: t('nav.sales'), purchases: t('nav.purchases') }}
      />
    </Card>
  );
}

/** The period's sales against the same number of days before it, as a ring. */
function MonthCard({ withCounts, ...p }: PeriodProps & { withCounts: boolean }) {
  const { t, locale } = useT();
  const can = useCan();
  const seeCosts = can('costs:view');
  const seeProfit = can('profit:view');
  const { data: more } = useDashboardMore(p.period);
  const currency = useContext(Main).currency;
  if (!more?.month) return null;
  const money = (v: number) => formatMoney(v, currency, locale);
  const month = more.month;
  const percent = month.lastMonth > 0 ? Math.round((month.sales * 100) / month.lastMonth) : null;
  const change = percent != null ? percent - 100 : null;
  return (
    <Card className="flex flex-col">
      <CardHead
        title={t('dash.w.month')}
        p={p}
        extra={
          change != null ? (
            <Badge tone={change >= 0 ? 'positive' : 'destructive'}>
              <span className="tnum" dir="ltr">
                {change >= 0 ? '+' : ''}
                {change}%
              </span>
            </Badge>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Ring percent={percent ?? (month.sales > 0 ? 100 : 0)} color="var(--c-brand)">
          <span>
            <span className="block text-xl font-bold tnum" dir="ltr">
              {percent != null ? `${percent}%` : '—'}
            </span>
            <span className="block text-[11px] text-muted">{t('dash.ofLastMonth')}</span>
          </span>
        </Ring>
        <dl className="min-w-[13rem] flex-1 space-y-2 text-sm">
          <Line label={t('dash.todaySales')} value={money(month.sales)} strong />
          <Line label={t('dash.lastMonth')} value={money(month.lastMonth)} />
          {seeProfit && month.profit != null && (
            <Line label={t('dash.profit')} value={money(month.profit)} tone="text-positive" />
          )}
          {month.expenses != null && (
            <Line
              label={t('dash.expenses')}
              value={money(month.expenses)}
              tone="text-destructive"
            />
          )}
          {seeCosts && more.stockValue != null && (
            <Line label={t('dash.stockValue')} value={money(more.stockValue)} />
          )}
        </dl>
      </div>
      {withCounts && more.today && (
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
          <Mini label={t('dash.invoices')} value={formatNumber(more.today.invoices, locale)} />
          <Mini
            label={t('dash.avgInvoice')}
            value={
              more.today.invoices > 0
                ? money(Math.round((more.today.sales + more.today.returns) / more.today.invoices))
                : '—'
            }
          />
          <Mini label={t('dash.returns')} value={money(more.today.returns)} />
        </div>
      )}
    </Card>
  );
}

function Line({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="truncate text-muted">{label}</dt>
      <dd className={`shrink-0 tnum ${strong ? 'font-bold' : 'font-medium'} ${tone ?? ''}`}>
        {value}
      </dd>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted">{label}</p>
      <p className="text-xs font-semibold whitespace-nowrap tnum">{value}</p>
    </div>
  );
}

/** Best-selling items, top customers and sales by branch, each over its period. */
function RankCards({
  items,
  customers,
  branches,
}: {
  items: PeriodProps | null;
  customers: PeriodProps | null;
  branches: PeriodProps | null;
}) {
  const parts = [items, customers, branches].filter(Boolean).length;
  if (parts === 0) return null;
  return (
    <div
      className={`grid gap-4 [&>*]:min-w-0 ${parts >= 3 ? 'lg:grid-cols-3' : parts === 2 ? 'lg:grid-cols-2' : ''}`}
    >
      {items && <RankCard kind="items" {...items} />}
      {customers && <RankCard kind="customers" {...customers} />}
      {branches && <RankCard kind="branches" {...branches} />}
    </div>
  );
}

function RankCard({ kind, ...p }: PeriodProps & { kind: 'items' | 'customers' | 'branches' }) {
  const { t, locale } = useT();
  const { data: more } = useDashboardMore(p.period);
  const currency = useContext(Main).currency;
  const money = (v: number) => formatMoney(v, currency, locale);
  const rows =
    (kind === 'items'
      ? more?.topItems
      : kind === 'customers'
        ? more?.topCustomers
        : more?.branches) ?? [];
  const title =
    kind === 'items'
      ? t('dash.w.topItems')
      : kind === 'customers'
        ? t('dash.w.topCustomers')
        : t('dash.w.branches');
  return (
    <Card>
      <CardHead title={title} p={p} />
      {kind === 'items' ? (
        <BarList
          rows={rows}
          money={money}
          note={(r) =>
            r.quantity != null ? `${formatNumber(r.quantity, locale)} ${t('dash.pieces')}` : null
          }
        />
      ) : kind === 'customers' ? (
        <PeopleList rows={rows} money={money} />
      ) : (
        <Shares rows={rows} money={money} />
      )}
    </Card>
  );
}

function BarList({
  rows,
  money,
  note,
}: {
  rows: DashRank[];
  money: (v: number) => string;
  note?: (r: DashRank) => string | null;
}) {
  const { t } = useT();
  if (rows.length === 0) return <p className="text-sm text-muted">{t('dash.none')}</p>;
  const top = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ol className="space-y-3 text-sm">
      {rows.map((r, i) => (
        <li key={r.id}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-bold tnum ${
                  i < 3 ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-muted'
                }`}
              >
                {i + 1}
              </span>
              <span className="truncate font-medium">{r.name}</span>
            </span>
            <span className="shrink-0 font-semibold tnum">{money(r.value)}</span>
          </div>
          <div className="ms-8 mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.round((Math.abs(r.value) * 100) / top)}%` }}
              />
            </div>
            {note?.(r) && <span className="shrink-0 text-[11px] text-muted">{note(r)}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Customers with their initials, like the reference's people list. */
function PeopleList({ rows, money }: { rows: DashRank[]; money: (v: number) => string }) {
  const { t } = useT();
  if (rows.length === 0) return <p className="text-sm text-muted">{t('dash.none')}</p>;
  return (
    <ul className="space-y-2.5 text-sm">
      {rows.map((r, i) => (
        <li key={r.id} className="flex items-center gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
            style={{ background: SHARE_COLORS[i % SHARE_COLORS.length] }}
          >
            {initials(r.name)}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
          <span className="shrink-0 font-semibold tnum">{money(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Shares of the whole as a donut with a legend (sales by branch). */
function Shares({ rows, money }: { rows: DashRank[]; money: (v: number) => string }) {
  const { t, locale } = useT();
  if (rows.length === 0) return <p className="text-sm text-muted">{t('dash.none')}</p>;
  const total = rows.reduce((a, r) => a + Math.max(0, r.value), 0);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Donut values={rows.map((r) => r.value)}>
        <span>
          <span className="block text-[11px] text-muted">{t('common.total')}</span>
          <span className="block text-sm font-bold tnum">{formatNumber(rows.length, locale)}</span>
        </span>
      </Donut>
      <ul className="min-w-[140px] flex-1 space-y-2 text-sm">
        {rows.map((r, i) => (
          <li key={r.id} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: SHARE_COLORS[i % SHARE_COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="shrink-0 text-xs text-muted tnum" dir="ltr">
              {total > 0 ? Math.round((Math.max(0, r.value) * 100) / total) : 0}%
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between border-t border-line pt-2 font-semibold">
          <span>{t('common.total')}</span>
          <span className="tnum">{money(total)}</span>
        </li>
      </ul>
    </div>
  );
}

/** The latest documents of the period as a history table. */
function HistoryCard({
  className,
  onOpen,
  ...p
}: PeriodProps & { className?: string; onOpen: (doc: { id: string; type: string }) => void }) {
  const { t, locale } = useT();
  const { data } = useDashboard(p.period);
  const docs = data?.recentDocuments ?? [];
  return (
    <Card padded={false} className={className}>
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <CardHead title={t('dashboard.recent')} p={p} />
      </div>
      {docs.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">{t('dash.none')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2 text-xs text-muted">
                <th className="px-4 py-2 text-start font-medium sm:px-5">{t('dash.doc')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('dash.party')}</th>
                <th className="hidden px-3 py-2 text-start font-medium md:table-cell">
                  {t('dash.date')}
                </th>
                <th className="px-3 py-2 text-start font-medium">{t('common.status')}</th>
                <th className="px-4 py-2 text-end font-medium sm:px-5">{t('common.amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {docs.map((doc) => (
                <tr
                  key={doc.id}
                  className="cursor-pointer hover:bg-surface-2"
                  onClick={() => onOpen(doc)}
                >
                  <td className="px-4 py-2.5 sm:px-5">
                    <span className="flex items-center gap-2">
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                          doc.type.endsWith('RETURN')
                            ? 'bg-warning-soft text-warning'
                            : doc.type.startsWith('PURCHASE')
                              ? 'bg-info-soft text-info'
                              : 'bg-brand-soft text-brand'
                        }`}
                      >
                        <Icon
                          name={doc.type.startsWith('PURCHASE') ? 'purchases' : 'sales'}
                          size={16}
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-muted">
                          {t(`statement.kind.${doc.type}` as TranslationKey)}
                        </span>
                        <span className="block tnum">
                          <bdi>{doc.number}</bdi>
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="max-w-[12rem] px-3 py-2.5 font-medium">
                    <CodeName code={doc.partyCode} name={doc.partyName} truncate />
                  </td>
                  <td className="hidden px-3 py-2.5 text-muted tnum md:table-cell">
                    {formatDate(doc.issueDate, locale)}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={STATUS_TONE[doc.status]}>{t(`status.${doc.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-end font-semibold tnum sm:px-5">
                    {formatMoney(doc.grandTotal, doc.currency, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** What needs attention now: invoices waiting for approval, customers over their limit. */
function AlertsCard() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const more = useDashboardMore(useContext(Main).period).data;
  const currency = useContext(Main).currency;
  if (!more) return null;
  const money = (v: number) => formatMoney(v, currency, locale);
  const alerts = [
    more.awaitingApproval
      ? { label: t('dash.awaiting'), value: more.awaitingApproval, to: '/sales?state=AWAITING' }
      : null,
    more.overLimitCount
      ? { label: t('dash.overLimit'), value: more.overLimitCount, to: '/parties?status=OVER_LIMIT' }
      : null,
  ].filter((x) => !!x);
  if (alerts.length === 0 && (more.overLimit?.length ?? 0) === 0) return null;
  return (
    <Card>
      <CardHead title={t('dash.w.alerts')} />
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
        {(more.overLimit ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 px-1">
            <span className="min-w-0 truncate">{r.name}</span>
            <span className="text-xs text-destructive tnum">
              {money(r.value)} / {money(r.extra ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Cheques still open and due by the end of the period (overdue ones included). */
function NotesDueCard(p: PeriodProps) {
  const { t, locale } = useT();
  const due = useDashboardMore(p.period).data?.notesDue;
  const currency = useContext(Main).currency;
  const money = (v: number) => formatMoney(v, currency, locale);
  return (
    <Card>
      <CardHead title={t('dash.w.notesDue')} p={p} />
      {due && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Tile
            tone="positive"
            label={`${t('dash.toCollect')} (${formatNumber(due.receivable, locale)})`}
            value={money(due.receivableAmount)}
          />
          <Tile
            tone="warning"
            label={`${t('dash.toPay')} (${formatNumber(due.payable, locale)})`}
            value={money(due.payableAmount)}
          />
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">{t('dash.dueBy')}</p>
    </Card>
  );
}

/** What the money accounts hold now. */
function AccountsCard() {
  const { t, locale } = useT();
  const accounts = useDashboardMore(useContext(Main).period).data?.accounts;
  const currency = useContext(Main).currency;
  if (!accounts) return null;
  const money = (v: number) => formatMoney(v, currency, locale);
  return (
    <Card>
      <CardHead title={t('dash.w.accounts')} />
      {accounts.length === 0 ? (
        <p className="text-sm text-muted">{t('dash.none')}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                <Icon name="receipts" size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="shrink-0 font-medium tnum">{money(a.balance)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Tile({ tone, label, value }: { tone: Tone; label: string; value: ReactNode }) {
  const style = TONE_TILE[tone];
  return (
    <div className={`min-w-0 rounded-[var(--radius-app)] px-3 py-2 ${style.tile}`}>
      <p className="truncate text-xs text-muted">{label}</p>
      <p className={`mt-0.5 truncate font-semibold tnum ${style.text}`}>{value}</p>
    </div>
  );
}

function LowStockCard({ data }: { data: DashboardData }) {
  const { t, locale } = useT();
  return (
    <Card>
      <CardHead title={t('dashboard.lowStock')} />
      {data.lowStock.length === 0 ? (
        <p className="text-sm text-muted">{t('common.empty')}</p>
      ) : (
        <ul className="space-y-2.5">
          {data.lowStock.slice(0, 6).map((p) => {
            const ratio = p.reorderLevel > 0 ? Math.max(0, p.stockOnHand) / p.reorderLevel : 0;
            return (
              <li key={p.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="text-xs text-muted">{p.sku}</span>
                  </span>
                  <span className="shrink-0 text-xs text-destructive tnum">
                    {formatNumber(p.stockOnHand, locale)} / {formatNumber(p.reorderLevel, locale)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-destructive-soft">
                  <div
                    className="h-full rounded-full bg-destructive"
                    style={{ width: `${Math.round(Math.min(1, ratio) * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
