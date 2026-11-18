import { useRef, useState } from 'react';
import {
  companyToday,
  formatDate,
  formatMoney,
  formatNumber,
  type ReturnsReport,
  type TranslationKey,
} from '@skb/shared';
import { Card, EmptyState, Spinner } from '../components/ui';
import { ReportActions } from '../components/ReportActions';
import { TableColumns } from '../components/TableColumns';
import { useT } from '../lib/i18n';
import { useReportTools } from '../lib/report';
import { useReturnsReport } from '../lib/returnsQueries';

const small =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';
const BY: ReturnsReport['by'][] = ['reason', 'item', 'customer', 'rep'];

/**
 * The returns report (owner, 2026-11-18): sales returns of a period by reason, item, customer or
 * rep, with the return rate (returned ÷ sold; by reason, each reason's share).
 */
export function ReturnsReportTab() {
  const { t, locale } = useT();
  const today = companyToday();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [by, setBy] = useState<ReturnsReport['by']>('reason');
  const { data, isLoading } = useReturnsReport(from, to, by);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const m = (v: number) => formatMoney(v, data?.currency ?? 'EGP', locale);
  const pct = (bp?: number | null) => (bp == null ? '' : `${formatNumber(bp / 100, locale)}%`);
  const label = (r: { key: string; label: string; code?: string | null }) =>
    by === 'reason'
      ? r.key
        ? t(`return.reason.${r.key}` as TranslationKey)
        : t('return.reasonNone')
      : r.key
        ? r.code
          ? `${r.code} · ${r.label}`
          : r.label
        : t('returnsReport.none');
  const period = `${formatDate(from, locale)} – ${formatDate(to, locale)}`;
  const title = `${t('analytics.tabReturns')} · ${t(`returnsReport.by.${by}`)}`;
  const header = [
    t(`returnsReport.by.${by}`),
    t('returnsReport.returns'),
    t('returnsReport.qty'),
    ...(by === 'reason' ? [] : [t('returnsReport.sold')]),
    by === 'reason' ? t('returnsReport.share') : t('returnsReport.rate'),
    t('returnsReport.value'),
  ];
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
            <span className="mb-1 block text-xs text-muted">{t('returnsReport.by')}</span>
            <select
              className={small}
              value={by}
              onChange={(e) => setBy(e.target.value as ReturnsReport['by'])}
            >
              {BY.map((b) => (
                <option key={b} value={b}>
                  {t(`returnsReport.by.${b}`)}
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
            report.excel(title, period, header, [
              ...data.rows.map((r) => [
                label(r),
                r.returns,
                r.quantity,
                ...(by === 'reason' ? [] : [r.sold ?? 0]),
                pct(r.rate),
                { money: r.value },
              ]),
            ])
          }
        />
      </div>
      {isLoading || !data ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : data.rows.length === 0 ? (
        <EmptyState title={t('analytics.empty')} icon="returns" />
      ) : (
        <Card padded={false} className="overflow-x-auto">
          <div ref={paper}>
            <TableColumns id="analytics.returns">
              <table className="w-full min-w-[30rem] text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    {header.map((h, i) => (
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
                    <tr key={r.key || 'none'}>
                      <td className="max-w-[16rem] truncate px-3 py-1.5">{label(r)}</td>
                      <td className="px-3 py-1.5 text-end tnum">
                        {formatNumber(r.returns, locale)}
                      </td>
                      <td className="px-3 py-1.5 text-end tnum">
                        {formatNumber(r.quantity, locale)}
                      </td>
                      {by !== 'reason' && (
                        <td className="px-3 py-1.5 text-end tnum">
                          {formatNumber(r.sold ?? 0, locale)}
                        </td>
                      )}
                      <td className="px-3 py-1.5 text-end tnum">{pct(r.rate)}</td>
                      <td className="px-3 py-1.5 text-end tnum">{m(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line font-semibold">
                  <tr>
                    <td className="px-3 py-2">{t('common.total')}</td>
                    <td className="px-3 py-2 text-end tnum">
                      {formatNumber(data.returns, locale)}
                    </td>
                    <td className="px-3 py-2 text-end tnum">
                      {formatNumber(data.quantity, locale)}
                    </td>
                    {by !== 'reason' && (
                      <td className="px-3 py-2 text-end tnum">
                        {formatNumber(data.sold ?? 0, locale)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-end tnum">
                      {by === 'reason' ? '' : pct(data.rate)}
                    </td>
                    <td className="px-3 py-2 text-end tnum">{m(data.value)}</td>
                  </tr>
                </tfoot>
              </table>
            </TableColumns>
          </div>
        </Card>
      )}
    </div>
  );
}
