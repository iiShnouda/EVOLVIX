import { formatMoney, formatNumber, type KpiValue } from '@skb/shared';
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
import { useDashboard } from '../lib/queries';
import { KPI_TONE_MAP, STATUS_TONE } from '../lib/status';

const KPI_ICON: Record<string, string> = {
  'kpi.revenue': 'sales',
  'kpi.purchases': 'purchases',
  'kpi.receivables': 'parties',
  'kpi.payables': 'receipts',
  'kpi.lowStock': 'inventory',
  'kpi.cashPosition': 'analytics',
};

export function DashboardPage() {
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useDashboard();

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
        subtitle={t('app.tagline')}
        action={
          <div className="hidden gap-2 sm:flex">
            {can('sales:create') && (
              <Button icon="plus" size="sm" onClick={() => navigate('/sales/new')}>
                {t('dashboard.newInvoice')}
              </Button>
            )}
            {can('receipts:create') && (
              <Button
                icon="plus"
                size="sm"
                variant="secondary"
                onClick={() => navigate('/receipts?tab=vouchers&new=receipt')}
              >
                {t('dashboard.newReceipt')}
              </Button>
            )}
          </div>
        }
      />

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {data.kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} locale={locale} label={t(kpi.key as never)} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Trend */}
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

        {/* Low stock */}
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
                      {formatNumber(p.stockOnHand, locale)} / {formatNumber(p.reorderLevel, locale)}
                    </span>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Recent documents */}
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
    </div>
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
