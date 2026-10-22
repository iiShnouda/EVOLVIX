import { useRef, useState } from 'react';
import {
  formatDate,
  formatMoney,
  formatNumber,
  type ProfitGroupBy,
  companyToday,
} from '@skb/shared';
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { useT } from '../lib/i18n';
import { useProfitReport } from '../lib/queries';
import { TableColumns } from '../components/TableColumns';
import { ReportActions } from '../components/ReportActions';
import { useReportTools } from '../lib/report';

const field =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** The profitability report; `embedded` drops its own page title (it sits in a tab of Analytics). */
export function ProfitabilityPage({ embedded = false }: { embedded?: boolean }) {
  const { t, locale } = useT();
  const [from, setFrom] = useState(companyToday);
  const [to, setTo] = useState(companyToday);
  const [by, setBy] = useState<ProfitGroupBy>('customer');
  const tools = useReportTools();
  const paper = useRef<HTMLDivElement>(null);

  const report = useProfitReport({ from, to, by });
  const data = report.data;
  const currency = data?.currency ?? 'EGP';
  const margin = data && data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0;

  const groups: { key: ProfitGroupBy; label: string }[] = [
    { key: 'customer', label: t('report.byCustomer') },
    { key: 'product', label: t('report.byProduct') },
    { key: 'model', label: t('report.byModel') },
    { key: 'rep', label: t('report.byRep') },
    { key: 'day', label: t('report.byDay') },
  ];

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader title={t('report.profitability')} subtitle={t('report.subtitle')} />
      )}

      {/* Controls */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('report.from')}</span>
            <input
              type="date"
              className={field}
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('report.to')}</span>
            <input
              type="date"
              className={field}
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <div className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('report.by')}</span>
            <div className="inline-flex overflow-hidden rounded-[var(--radius-app)] border border-line">
              {groups.map((g) => (
                <button
                  key={g.key}
                  onClick={() => setBy(g.key)}
                  className={`h-9 px-3 text-sm transition-colors ${
                    by === g.key
                      ? 'bg-brand text-brand-fg'
                      : 'bg-surface text-muted hover:bg-surface-2'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ms-auto">
            <ReportActions
              disabled={!data}
              onPrint={() =>
                tools.print(
                  paper.current,
                  t('report.profitability'),
                  `${formatDate(from, locale)} – ${formatDate(to, locale)}`,
                )
              }
            />
          </div>
        </div>
      </Card>

      <div ref={paper} className="space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label={t('report.revenue')}
            value={formatMoney(data?.revenue ?? 0, currency, locale)}
            hint={
              data && data.returns > 0
                ? `${t('report.returns')} ${formatMoney(data.returns, currency, locale)} · ${t('report.netOfReturns')}`
                : undefined
            }
          />
          <Kpi label={t('report.cost')} value={formatMoney(data?.cost ?? 0, currency, locale)} />
          <Kpi
            label={t('report.profit')}
            value={formatMoney(data?.profit ?? 0, currency, locale)}
            tone={(data?.profit ?? 0) >= 0 ? 'positive' : 'negative'}
          />
          <Kpi label={t('report.margin')} value={`${margin.toFixed(1)}%`} tone="brand" />
        </div>

        {/* Breakdown table */}
        <Card padded={false} className="overflow-hidden">
          {report.isLoading ? (
            <div className="grid place-items-center py-16 text-muted">
              <Spinner size={26} />
            </div>
          ) : !data || data.rows.length === 0 ? (
            <EmptyState title={t('report.noData')} icon="analytics" />
          ) : (
            <TableColumns id="profitability">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="p-3 text-start font-medium">
                      {by === 'customer'
                        ? t('report.byCustomer')
                        : by === 'product'
                          ? t('report.byProduct')
                          : by === 'model'
                            ? t('report.byModel')
                            : by === 'rep'
                              ? t('report.byRep')
                              : t('report.byDay')}
                    </th>
                    <th className="p-3 text-end font-medium">{t('report.revenue')}</th>
                    <th className="hidden p-3 text-end font-medium sm:table-cell">
                      {t('report.cost')}
                    </th>
                    <th className="p-3 text-end font-medium">{t('report.profit')}</th>
                    <th className="p-3 text-end font-medium">{t('report.margin')}</th>
                    <th className="hidden p-3 text-end font-medium md:table-cell">
                      {by === 'product' || by === 'model' ? t('report.qty') : t('report.invoices')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--c-line)]">
                  {data.rows.map((r) => {
                    const m = r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0;
                    return (
                      <tr key={r.key} className="hover:bg-surface-2">
                        <td className="p-3 font-medium">{r.label}</td>
                        <td className="p-3 text-end tnum">
                          {formatMoney(r.revenue, currency, locale)}
                        </td>
                        <td className="hidden p-3 text-end tnum text-muted sm:table-cell">
                          {formatMoney(r.cost, currency, locale)}
                        </td>
                        <td
                          className={`p-3 text-end font-semibold tnum ${r.profit >= 0 ? 'text-positive' : 'text-destructive'}`}
                        >
                          {formatMoney(r.profit, currency, locale)}
                        </td>
                        <td className="p-3 text-end tnum">{m.toFixed(1)}%</td>
                        <td className="hidden p-3 text-end tnum text-muted md:table-cell">
                          {formatNumber(
                            by === 'product' || by === 'model' ? r.quantity : r.invoices,
                            locale,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableColumns>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'brand';
  hint?: string;
}) {
  const color =
    tone === 'positive'
      ? 'text-positive'
      : tone === 'negative'
        ? 'text-destructive'
        : tone === 'brand'
          ? 'text-brand'
          : '';
  return (
    <Card>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold tnum ${color}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-warning tnum">{hint}</p> : null}
    </Card>
  );
}
