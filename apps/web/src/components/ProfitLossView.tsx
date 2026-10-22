import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  companyToday,
  formatMoney,
  formatNumber,
  type PlFigures,
  type PlUnit,
  type ProfitLoss,
} from '@skb/shared';
import { Card, EmptyState, Spinner } from './ui';
import { Icon } from './Icon';
import { ReportActions } from './ReportActions';
import { useT } from '../lib/i18n';
import { useReportTools } from '../lib/report';
import { useProfitLoss } from '../lib/queries';
import type { Cell } from '../lib/xlsx';
import { TableColumns } from './TableColumns';

const small =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';

/** Gross margin as a percentage of net sales (one decimal), or null with no sales. */
const marginOf = (f: PlFigures) =>
  f.netSales > 0 ? Math.round((f.grossProfit * 1000) / f.netSales) / 10 : null;

const tone = (v: number) => (v > 0 ? 'text-positive' : v < 0 ? 'text-destructive' : 'text-muted');

/** A figure tile: label, amount, and an optional line under it. */
function Tile({
  label,
  value,
  sub,
  strong,
  className = '',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-[var(--radius-app)] border border-line bg-surface px-3 py-2.5 ${
        strong ? 'ring-1 ring-brand/30' : ''
      }`}
    >
      <p className="truncate text-xs text-muted">{label}</p>
      {/* Never cut an amount: smaller on a phone, and onto a second line if it must. */}
      <p
        className={`mt-0.5 break-words text-base font-bold leading-tight tnum sm:text-lg ${className}`}
      >
        {value}
      </p>
      {sub && <p className="truncate text-[11px] text-faint tnum">{sub}</p>}
    </div>
  );
}

/** The six figures of the period as tiles. */
export function PlTiles({ f, currency }: { f: PlFigures; currency: string }) {
  const { t, locale } = useT();
  const m = (v: number) => formatMoney(v, currency, locale);
  const margin = marginOf(f);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <Tile label={t('pnl.netSales')} value={m(f.netSales)} />
      <Tile label={t('pnl.cogs')} value={m(f.cogs)} />
      <Tile
        label={t('pnl.grossProfit')}
        value={m(f.grossProfit)}
        className={tone(f.grossProfit)}
        sub={margin != null ? `${t('pnl.margin')} ${formatNumber(margin, locale)}%` : undefined}
      />
      <Tile label={t('pnl.otherIncome')} value={m(f.otherIncome)} className="text-positive" />
      <Tile label={t('pnl.expenses')} value={m(f.expenses)} className="text-destructive" />
      <Tile
        strong
        label={f.netProfit < 0 ? t('pnl.netLoss') : t('pnl.netProfit')}
        value={m(Math.abs(f.netProfit))}
        className={tone(f.netProfit)}
      />
    </div>
  );
}

/**
 * Profit and loss (owner, 2026-10-06): the company, each branch and each of its warehouses, and the
 * general expenses paid from the main cash box. Money moved between boxes is neither a gain nor a
 * loss; general expenses can be shown shared over the branches by their share of net sales.
 */
export function ProfitLossTab() {
  const { t, locale } = useT();
  const today = companyToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [share, setShare] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { data, isLoading } = useProfitLoss(from, to);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const subtitle = `${t('report.from')} ${from} ${t('report.to')} ${to}`;
  const m = (v: number) => (data ? formatMoney(v, data.currency, locale) : '');
  const nameOf = (u: PlUnit) => (u.kind === 'BRANCH_REST' ? t('pnl.branchRest') : u.name);

  const columns = [
    t('pnl.place'),
    t('pnl.netSales'),
    t('pnl.cogs'),
    t('pnl.grossProfit'),
    t('pnl.margin'),
    t('pnl.otherIncome'),
    t('pnl.expenses'),
    t('pnl.netProfit'),
    ...(share ? [t('pnl.generalShare'), t('pnl.afterShare')] : []),
  ];
  const cells = (name: string, f: PlFigures, generalShare?: number): Cell[] => [
    name,
    { money: f.netSales },
    { money: f.cogs },
    { money: f.grossProfit },
    marginOf(f) != null ? `${marginOf(f)}%` : '',
    { money: f.otherIncome },
    { money: f.expenses },
    { money: f.netProfit },
    ...(share
      ? generalShare == null
        ? ['', '']
        : [{ money: -generalShare }, { money: f.netProfit - generalShare }]
      : []),
  ];

  function excel(d: ProfitLoss) {
    const rows: Cell[][] = [];
    for (const b of d.branches) {
      rows.push(cells(b.name, b.figures, b.generalShare));
      for (const c of b.children ?? []) rows.push(cells(`   ${nameOf(c)}`, c.figures));
    }
    if (d.general) rows.push(cells(t('pnl.general'), d.general));
    report.excel(t('pnl.title'), subtitle, columns, rows, cells(t('ledger.total'), d.total));
  }

  const row = (
    key: string,
    name: ReactNode,
    f: PlFigures,
    opts: { depth?: number; bold?: boolean; share?: number | null } = {},
  ) => (
    <tr key={key} className={opts.bold ? 'bg-surface-2/60 font-semibold' : ''}>
      <td
        className="px-2 py-2"
        style={{ paddingInlineStart: `${0.5 + (opts.depth ?? 0) * 1.25}rem` }}
      >
        {name}
      </td>
      <td className="px-2 py-2 text-end tnum">{m(f.netSales)}</td>
      <td className="px-2 py-2 text-end tnum">{m(f.cogs)}</td>
      <td className={`px-2 py-2 text-end tnum ${tone(f.grossProfit)}`}>{m(f.grossProfit)}</td>
      <td className="px-2 py-2 text-end text-muted tnum">
        {marginOf(f) != null ? `${formatNumber(marginOf(f)!, locale)}%` : '—'}
      </td>
      <td className="px-2 py-2 text-end tnum">{m(f.otherIncome)}</td>
      <td className="px-2 py-2 text-end tnum">{m(f.expenses)}</td>
      <td className={`px-2 py-2 text-end font-semibold tnum ${tone(f.netProfit)}`}>
        {m(f.netProfit)}
      </td>
      {share && (
        <>
          <td className="px-2 py-2 text-end text-muted tnum">
            {opts.share == null ? '' : m(-opts.share)}
          </td>
          <td
            className={`px-2 py-2 text-end font-semibold tnum ${opts.share == null ? '' : tone(f.netProfit - opts.share)}`}
          >
            {opts.share == null ? '' : m(f.netProfit - opts.share)}
          </td>
        </>
      )}
    </tr>
  );

  return (
    <div className="space-y-4">
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
          {data?.general && (
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
              {t('pnl.shareGeneral')}
            </label>
          )}
        </div>
        <ReportActions
          disabled={!data}
          onPrint={() => report.print(paper.current, t('pnl.title'), subtitle)}
          onExcel={() => data && excel(data)}
        />
      </div>

      {isLoading || !data ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : (
        <div ref={paper} className="space-y-4">
          <PlTiles f={data.total} currency={data.currency} />

          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">
              {t('pnl.byPlace')}
            </div>
            {data.branches.length === 0 && !data.general ? (
              <EmptyState title={t('common.empty')} icon="analytics" />
            ) : (
              <div className="overflow-x-auto">
                <TableColumns id="pnl.places">
                  <table className="w-full min-w-[860px] whitespace-nowrap text-[13px]">
                    <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                      <tr>
                        {columns.map((c, i) => (
                          <th
                            key={c}
                            className={`px-2 py-2 font-medium ${i === 0 ? 'text-start' : 'text-end'}`}
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--c-line)]">
                      {data.branches.flatMap((b) => {
                        const expanded = open.has(b.id);
                        return [
                          row(
                            b.id,
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 font-semibold"
                              onClick={() =>
                                setOpen((s) => {
                                  const next = new Set(s);
                                  if (next.has(b.id)) next.delete(b.id);
                                  else next.add(b.id);
                                  return next;
                                })
                              }
                            >
                              <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
                              <Icon name="branches" size={14} className="text-brand" />
                              {b.name}
                            </button>,
                            b.figures,
                            { bold: true, share: data.general ? b.generalShare : null },
                          ),
                          ...(expanded
                            ? (b.children ?? []).map((c) =>
                                row(
                                  `${b.id}-${c.kind}-${c.id}`,
                                  <span
                                    className={`inline-flex items-center gap-1.5 ${c.kind === 'BRANCH_REST' ? 'text-muted' : ''}`}
                                  >
                                    <Icon
                                      name={c.kind === 'BRANCH_REST' ? 'receipts' : 'inventory'}
                                      size={13}
                                    />
                                    {nameOf(c)}
                                  </span>,
                                  c.figures,
                                  { depth: 1 },
                                ),
                              )
                            : []),
                        ];
                      })}
                      {data.general &&
                        row(
                          'general',
                          <span className="inline-flex items-center gap-1.5 font-semibold">
                            <Icon name="receipts" size={14} className="text-warning" />
                            {t('pnl.general')}
                          </span>,
                          data.general,
                          { bold: true, share: share ? null : undefined },
                        )}
                    </tbody>
                    <tfoot className="border-t-2 border-line font-bold">
                      {row('total', t('ledger.total'), data.total, {
                        share: share && data.general ? -data.general.netProfit : null,
                      })}
                    </tfoot>
                  </table>
                </TableColumns>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(['GAIN', 'LOSS'] as const).map((side) => {
              const items = data.lines.filter((l) =>
                side === 'GAIN'
                  ? l.section === 'SALES' || l.section === 'GAIN'
                  : l.section === 'COGS' || l.section === 'LOSS',
              );
              const total = items.reduce((s, l) => s + l.amount, 0);
              return (
                <Card key={side} className="space-y-2">
                  <p className="text-sm font-semibold">
                    {t(side === 'GAIN' ? 'pnl.gains' : 'pnl.losses')}
                  </p>
                  <ul className="divide-y divide-[var(--c-line)] text-sm">
                    {items.map((l) => (
                      <li key={l.code} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate">
                          <span className="me-2 text-xs text-faint tnum">{l.code}</span>
                          {l.name}
                        </span>
                        <span className={`shrink-0 tnum ${l.amount < 0 ? 'text-destructive' : ''}`}>
                          {m(l.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p
                    className={`flex justify-between border-t border-line pt-2 text-sm font-bold ${side === 'GAIN' ? 'text-positive' : 'text-destructive'}`}
                  >
                    <span>{t('ledger.total')}</span>
                    <span className="tnum">{m(total)}</span>
                  </p>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** The dashboard's profit-and-loss card for the period, with each branch's net result. */
export function ProfitLossCard({ from, to, head }: { from: string; to: string; head: ReactNode }) {
  const { t, locale } = useT();
  const { data } = useProfitLoss(from, to);
  if (!data) return null;
  const m = (v: number) => formatMoney(v, data.currency, locale);
  const rows = [
    ...data.branches.map((b) => ({ key: b.id, name: b.name, v: b.figures.netProfit })),
    ...(data.general
      ? [{ key: 'general', name: t('pnl.general'), v: data.general.netProfit }]
      : []),
  ];
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <Card className="space-y-3">
      {head}
      <PlTiles f={data.total} currency={data.currency} />
      {rows.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {rows.map((r) => (
            <li
              key={r.key}
              className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2"
            >
              <span className="truncate text-muted">{r.name}</span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                <span
                  className={`block h-full rounded-full ${r.v < 0 ? 'bg-destructive' : 'bg-positive'}`}
                  style={{ width: `${(Math.abs(r.v) / max) * 100}%` }}
                />
              </span>
              <span className={`font-semibold tnum ${tone(r.v)}`}>{m(r.v)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/analytics?tab=pl"
        className="inline-flex items-center gap-1 text-xs font-medium text-brand"
      >
        {t('pnl.details')}
        <Icon name="chevronRight" size={12} />
      </Link>
    </Card>
  );
}
