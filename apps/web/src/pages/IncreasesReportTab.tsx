import { useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  companyToday,
  formatDate,
  formatMoney,
  formatNumber,
  type IncreasesReport,
} from '@skb/shared';
import { Card, EmptyState, Spinner } from '../components/ui';
import { ReportActions } from '../components/ReportActions';
import { TableColumns } from '../components/TableColumns';
import { useT } from '../lib/i18n';
import { useReportTools } from '../lib/report';
import { api } from '../lib/api';

const small =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';

/**
 * The increases report (owner, 2026-11-20): who added to the sales invoices of a period — on an item or
 * on the whole invoice — with how many invoices and how much each added; choosing one shows their
 * invoices. For whoever may see increases; the server keeps to their branches and departments.
 */
export function IncreasesReportTab() {
  const { t, locale } = useT();
  const today = companyToday();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [by, setBy] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'increases', from, to, by],
    queryFn: () =>
      api.get<IncreasesReport>(
        `/reports/increases?${new URLSearchParams({ from, to, ...(by != null ? { by } : {}) })}`,
      ),
    placeholderData: keepPreviousData,
  });
  // The givers stay listed when one is chosen.
  const { data: everyone } = useQuery({
    queryKey: ['reports', 'increases', from, to, null],
    queryFn: () =>
      api.get<IncreasesReport>(`/reports/increases?${new URLSearchParams({ from, to })}`),
    placeholderData: keepPreviousData,
  });
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const m = (v: number) => formatMoney(v, data?.currency ?? 'EGP', locale);
  const nameOf = (r: { key: string; name: string; code?: number | null }) =>
    r.key ? (r.code ? `${r.code} · ${r.name}` : r.name) : t('increasesReport.unknown');
  const givers = everyone?.rows ?? [];
  const chosen = givers.find((r) => r.key === by);
  const period = `${formatDate(from, locale)} – ${formatDate(to, locale)}`;
  const title = `${t('analytics.tabIncreases')}${chosen ? ` · ${nameOf(chosen)}` : ''}`;
  const head = [
    t('increasesReport.giver'),
    t('increasesReport.invoices'),
    t('increasesReport.amount'),
  ];
  const invHead = [
    t('increasesReport.invoice'),
    t('report.from'),
    t('increasesReport.customer'),
    t('increasesReport.rep'),
    t('increasesReport.giver'),
    t('increasesReport.total'),
    t('increasesReport.amount'),
  ];
  const cell = 'px-3 py-1.5';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
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
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('increasesReport.giver')}</span>
            <select
              className={small}
              value={by ?? '*'}
              onChange={(e) => setBy(e.target.value === '*' ? null : e.target.value)}
            >
              <option value="*">{t('increasesReport.everyone')}</option>
              {givers.map((r) => (
                <option key={r.key || 'none'} value={r.key}>
                  {nameOf(r)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ReportActions
          scope="reports"
          disabled={!data}
          onPrint={() => report.print(paper.current, title, period)}
          onExcel={() =>
            data &&
            report.excel(title, period, invHead, [
              ...data.invoices.map((i) => [
                i.number,
                formatDate(i.issueDate, locale),
                i.partyName,
                i.repName ?? '',
                i.by.join('، '),
                { money: i.grandTotal },
                { money: i.amount },
              ]),
            ])
          }
        />
      </div>
      {isLoading || !data ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : data.invoices.length === 0 ? (
        <EmptyState title={t('analytics.empty')} icon="analytics" />
      ) : (
        <div ref={paper} className="space-y-3">
          <Card padded={false} className="overflow-x-auto">
            <TableColumns id="analytics.increases">
              <table className="w-full min-w-[22rem] text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    {head.map((h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-2 font-normal ${i === 0 ? 'text-start' : 'text-end'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.rows.map((r) => (
                    <tr
                      key={r.key || 'none'}
                      className="cursor-pointer hover:bg-surface-2"
                      onClick={() => setBy(by === r.key ? null : r.key)}
                    >
                      <td className={`${cell} max-w-[16rem] truncate`}>{nameOf(r)}</td>
                      <td className={`${cell} text-end tnum`}>
                        {formatNumber(r.invoices, locale)}
                      </td>
                      <td className={`${cell} text-end tnum text-positive`}>{m(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line font-semibold">
                  <tr>
                    <td className="px-3 py-2">{t('common.total')}</td>
                    <td className="px-3 py-2 text-end tnum">{formatNumber(data.count, locale)}</td>
                    <td className="px-3 py-2 text-end tnum">{m(data.amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </TableColumns>
          </Card>
          <Card padded={false} className="overflow-x-auto">
            <TableColumns id="analytics.increases.invoices">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    {invHead.map((h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-2 font-normal ${i < 5 ? 'text-start' : 'text-end'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.invoices.map((i) => (
                    <tr key={i.id}>
                      <td className={`${cell} tnum`}>
                        <Link className="text-brand hover:underline" to={`/sales/invoices/${i.id}`}>
                          {i.number}
                        </Link>
                      </td>
                      <td className={`${cell} tnum`}>{formatDate(i.issueDate, locale)}</td>
                      <td className={`${cell} max-w-[12rem] truncate`}>{i.partyName}</td>
                      <td className={`${cell} max-w-[10rem] truncate`}>{i.repName ?? ''}</td>
                      <td className={`${cell} max-w-[12rem] truncate`}>{i.by.join('، ')}</td>
                      <td className={`${cell} text-end tnum`}>{m(i.grandTotal)}</td>
                      <td className={`${cell} text-end tnum text-positive`}>{m(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableColumns>
          </Card>
        </div>
      )}
    </div>
  );
}
