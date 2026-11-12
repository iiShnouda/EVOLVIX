import { useRef, useState, type ReactNode } from 'react';
import {
  companyToday,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTime,
  type TranslationKey,
} from '@skb/shared';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from './ui';
import { ReportActions } from './ReportActions';
import { ItemLink } from './ItemLink';
import { DocLink, PartyLink } from './Links';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useReportTools } from '../lib/report';
import { useHiddenColumns } from '../lib/queries';
import { TableColumns } from './TableColumns';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

interface ExpenseStatement {
  name: string;
  currency: string;
  total: number;
  lines: {
    id: string;
    number: string;
    date: string;
    amount: number;
    category: string | null;
    accountName: string | null;
    branchName: string | null;
    notes: string | null;
    createdByName: string | null;
  }[];
}

interface WarehouseStatement {
  name: string;
  currency: string;
  opening: number;
  openingValue: number | null;
  in: number;
  out: number;
  closing: number;
  closingValue: number | null;
  lines: {
    date: string;
    type: string;
    reference: string | null;
    documentId: string | null;
    productId: string;
    code: string;
    name: string;
    quantity: number;
    value: number | null;
    balance: number;
    note: string | null;
    counterpart: string | null;
    documentKind?: string | null;
    partyId?: string | null;
    partyTypes?: string[] | null;
  }[];
}

type Cell = string | number | { money: number } | null;

/**
 * The columns a statement's table shows, in the person's order (TableColumns keeps both by the
 * header's text): Excel carries the same (owner, 2026-11-12).
 */
function useShownColumns<C extends { label: string }>(id: string, cols: C[]): C[] {
  const [hidden] = useHiddenColumns(id);
  const [order] = useHiddenColumns(`order:${id}`);
  const known = order.filter((h) => cols.some((c) => c.label === h));
  return [
    ...known.map((h) => cols.find((c) => c.label === h)!),
    ...cols.filter((c) => !known.includes(c.label)),
  ].filter((c) => !hidden.includes(c.label));
}

/** From–to days, the print button, and the body below; shared by the statements here. */
function Period({
  title,
  from,
  to,
  onFrom,
  onTo,
  canPrint,
  onExcel,
  children,
}: {
  title: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  canPrint: boolean;
  /** Saves the statement as Excel (header, rows and the totals line). */
  onExcel?: () => { header: string[]; rows: Cell[][]; total?: Cell[] } | null | undefined;
  children: ReactNode;
}) {
  const { t, locale } = useT();
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block w-40">
          <span className="mb-0.5 block text-xs text-muted">{t('money.from')}</span>
          <input
            className={field}
            type="date"
            value={from}
            max={to}
            onChange={(e) => onFrom(e.target.value || from)}
          />
        </label>
        <label className="block w-40">
          <span className="mb-0.5 block text-xs text-muted">{t('money.to')}</span>
          <input
            className={field}
            type="date"
            value={to}
            min={from}
            onChange={(e) => onTo(e.target.value || to)}
          />
        </label>
        <div className="ms-auto">
          <ReportActions
            scope="statement"
            disabled={!canPrint}
            onPrint={() =>
              report.print(
                paper.current,
                title,
                `${formatDate(from, locale)} – ${formatDate(to, locale)}`,
              )
            }
            onExcel={
              onExcel &&
              (() => {
                const x = onExcel();
                if (x)
                  report.excel(
                    title,
                    `${formatDate(from, locale)} – ${formatDate(to, locale)}`,
                    x.header,
                    x.rows as never,
                    x.total as never,
                  );
              })
            }
          />
        </div>
      </div>
      <div ref={paper}>{children}</div>
    </div>
  );
}

interface Col<L> {
  label: string;
  cell: (l: L, i: number) => ReactNode;
  text: (l: L, i: number) => Cell;
  className?: string;
  num?: boolean;
}

/** A statement's lines in columns that can be hidden and moved; Excel takes the shown ones. */
function StatementTable<L>({
  id,
  cols,
  lines,
  minWidth,
  total,
}: {
  id: string;
  cols: Col<L>[];
  lines: L[];
  minWidth?: string;
  /** The totals line, by column label. */
  total?: Record<string, ReactNode>;
}) {
  const { t } = useT();
  return (
    <div className="overflow-x-auto">
      <TableColumns id={id}>
        <table className={`w-full text-sm ${minWidth ?? ''}`}>
          <thead className="border-b border-line bg-surface-2 text-xs text-muted">
            <tr>
              {cols.map((c) => (
                <th
                  key={c.label}
                  className={`p-2 font-medium ${c.num ? 'text-end' : 'text-start'}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--c-line)]">
            {lines.map((l, i) => (
              <tr key={i} className="hover:bg-surface-2/60">
                {cols.map((c) => (
                  <td
                    key={c.label}
                    className={`p-2 align-top ${c.num ? 'whitespace-nowrap text-end tnum' : ''} ${c.className ?? ''}`}
                  >
                    {c.cell(l, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot className="bg-surface-2 font-semibold">
              <tr>
                {cols.map((c, i) => (
                  <td key={c.label} className={`p-2 ${c.num ? 'text-end tnum' : ''}`}>
                    {i === 0 && !(c.label in total) ? t('ledger.total') : total[c.label]}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </TableColumns>
    </div>
  );
}

/** An expense item's statement (owner, 2026-10-19): every expense under it between two days. */
export function ExpenseStatementBody({ id, title }: { id: string; title: string }) {
  const { t, locale } = useT();
  const [from, setFrom] = useState(companyToday);
  const [to, setTo] = useState(companyToday);
  const q = useQuery({
    queryKey: ['statement', 'expense', id, from, to],
    queryFn: () =>
      api.get<ExpenseStatement>(`/expense-categories/${id}/statement?from=${from}&to=${to}`),
  });
  const d = q.data;
  const money = (v: number) => formatMoney(v, d?.currency ?? 'EGP', locale);
  type Line = ExpenseStatement['lines'][number];
  // Every expense in columns (owner, 2026-11-10): when, what, from which box, who.
  const cols: Col<Line>[] = [
    { label: t('ledger.entryNumber'), cell: (_l, i) => i + 1, text: (_l, i) => i + 1 },
    {
      label: t('common.date'),
      cell: (l) => formatDate(l.date, locale),
      text: (l) => formatDate(l.date, locale),
      className: 'whitespace-nowrap tnum',
    },
    {
      label: t('money.time'),
      cell: (l) => formatTime(l.date, locale),
      text: (l) => formatTime(l.date, locale),
      className: 'whitespace-nowrap tnum',
    },
    {
      label: t('money.document'),
      cell: (l) => <DocLink id={l.id} kind="EXPENSE" number={l.number} />,
      text: (l) => l.number,
      className: 'whitespace-nowrap tnum',
    },
    { label: t('statement.expenses'), cell: (l) => l.category, text: (l) => l.category ?? '' },
    {
      label: t('money.counterpart'),
      cell: (l) => l.accountName ?? '',
      text: (l) => l.accountName ?? '',
    },
    {
      label: t('ledger.branchCol'),
      cell: (l) => l.branchName ?? '',
      text: (l) => l.branchName ?? '',
      className: 'text-muted',
    },
    {
      label: t('ledger.noteCol'),
      cell: (l) => <span className="line-clamp-2">{l.notes ?? ''}</span>,
      text: (l) => l.notes ?? '',
      className: 'text-muted',
    },
    {
      label: t('money.createdBy'),
      cell: (l) => l.createdByName ?? '',
      text: (l) => l.createdByName ?? '',
      className: 'text-muted',
    },
    {
      label: t('common.amount'),
      cell: (l) => money(l.amount),
      text: (l) => ({ money: l.amount }),
      num: true,
      className: 'font-semibold text-destructive',
    },
  ];
  const shown = useShownColumns('statement.expense', cols);
  return (
    <Period
      title={title}
      from={from}
      to={to}
      onFrom={setFrom}
      onTo={setTo}
      canPrint={!!d}
      onExcel={() =>
        d && {
          header: shown.map((c) => c.label),
          rows: d.lines.map((l, i) => shown.map((c) => c.text(l, i))),
          total: shown.map((c, i) =>
            c.label === t('common.amount')
              ? { money: d.total }
              : i === 0
                ? t('ledger.total')
                : '',
          ),
        }
      }
    >
      {q.error ? (
        <p className="text-sm text-destructive">{errorText(t, q.error)}</p>
      ) : !d ? (
        <div className="grid place-items-center py-10 text-muted">
          <Spinner size={22} />
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-baseline justify-between rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm">
            <span className="text-muted">{t('statement.total')}</span>
            <span className="text-lg font-semibold tnum">{money(d.total)}</span>
          </div>
          {d.lines.length === 0 ? (
            <p className="py-4 text-sm text-muted">{t('money.noMovements')}</p>
          ) : (
            <StatementTable
              id="statement.expense"
              cols={cols}
              lines={d.lines}
              minWidth="min-w-[900px]"
              total={{ [t('common.amount')]: money(d.total) }}
            />
          )}
        </>
      )}
    </Period>
  );
}

/**
 * A warehouse's statement (owner, 2026-10-19): every movement in or out between two days with the
 * pieces it holds after each; values only for whoever may see costs (the server sends none else).
 * The document opens, the customer or supplier opens their statement, the item its card.
 */
export function WarehouseStatementBody({ id, title }: { id: string; title: string }) {
  const { t, locale } = useT();
  const [from, setFrom] = useState(companyToday);
  const [to, setTo] = useState(companyToday);
  const q = useQuery({
    queryKey: ['statement', 'warehouse', id, from, to],
    queryFn: () =>
      api.get<WarehouseStatement>(`/inventory/warehouses/${id}/statement?from=${from}&to=${to}`),
  });
  const d = q.data;
  const money = (v: number) => formatMoney(v, d?.currency ?? 'EGP', locale);
  const n = (v: number) => formatNumber(v, locale);
  type Line = WarehouseStatement['lines'][number];
  const side = (l: Line) =>
    l.counterpart ? `${t(l.quantity > 0 ? 'money.from' : 'money.to')} ${l.counterpart}` : '';
  const cols: Col<Line>[] = [
    {
      label: t('common.date'),
      cell: (l) => formatDateTime(l.date, locale),
      text: (l) => formatDateTime(l.date, locale),
      className: 'whitespace-nowrap text-xs text-muted',
    },
    {
      label: t('statement.movement'),
      cell: (l) => t(`movement.${l.type}` as TranslationKey),
      text: (l) => t(`movement.${l.type}` as TranslationKey),
      className: 'whitespace-nowrap text-xs',
    },
    {
      label: t('ledger.docNumber'),
      cell: (l) =>
        l.reference ? <DocLink id={l.documentId} kind={l.documentKind} number={l.reference} /> : '',
      text: (l) => l.reference ?? '',
      className: 'whitespace-nowrap text-xs tnum',
    },
    {
      label: t('statement.fromTo'),
      cell: (l) =>
        l.counterpart && l.partyId ? (
          <>
            {t(l.quantity > 0 ? 'money.from' : 'money.to')}{' '}
            <PartyLink id={l.partyId} name={l.counterpart} types={l.partyTypes} />
          </>
        ) : (
          side(l)
        ),
      text: side,
      className: 'text-xs',
    },
    {
      label: t('inventory.itemName'),
      cell: (l) => <ItemLink id={l.productId} name={l.name} code={l.code} />,
      text: (l) => `${l.code} ${l.name}`,
    },
    {
      label: t('ledger.noteCol'),
      cell: (l) => <span className="line-clamp-2">{l.note ?? ''}</span>,
      text: (l) => l.note ?? '',
      className: 'text-xs text-muted',
    },
    {
      label: t('money.in'),
      cell: (l) => (l.quantity > 0 ? n(l.quantity) : ''),
      text: (l) => (l.quantity > 0 ? l.quantity : ''),
      num: true,
      className: 'text-positive',
    },
    {
      label: t('money.out'),
      cell: (l) => (l.quantity < 0 ? n(-l.quantity) : ''),
      text: (l) => (l.quantity < 0 ? -l.quantity : ''),
      num: true,
      className: 'text-destructive',
    },
    ...(d?.closingValue != null
      ? [
          {
            label: t('statement.value'),
            cell: (l: Line) => money(Math.abs(l.value ?? 0)),
            text: (l: Line) => ({ money: Math.abs(l.value ?? 0) }),
            num: true,
          },
        ]
      : []),
    {
      label: t('statement.itemBalance'),
      cell: (l) => n(l.balance),
      text: (l) => l.balance,
      num: true,
    },
  ];
  const shown = useShownColumns('statement.warehouse', cols);
  return (
    <Period
      title={title}
      from={from}
      to={to}
      onFrom={setFrom}
      onTo={setTo}
      canPrint={!!d}
      onExcel={() =>
        d && {
          header: shown.map((c) => c.label),
          rows: d.lines.map((l, i) => shown.map((c) => c.text(l, i))),
        }
      }
    >
      {q.error ? (
        <p className="text-sm text-destructive">{errorText(t, q.error)}</p>
      ) : !d ? (
        <div className="grid place-items-center py-10 text-muted">
          <Spinner size={22} />
        </div>
      ) : (
        <>
          <dl className="mb-3 grid grid-cols-2 gap-2 rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm sm:grid-cols-4">
            {(
              [
                ['money.openingBal', d.opening, d.openingValue],
                ['money.in', d.in, null],
                ['money.out', d.out, null],
                ['money.closing', d.closing, d.closingValue],
              ] as const
            ).map(([k, v, value]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted">{t(k)}</dt>
                <dd className="font-semibold tnum">{n(v)}</dd>
                {value != null && <dd className="text-xs text-muted tnum">{money(value)}</dd>}
              </div>
            ))}
          </dl>
          {d.lines.length === 0 ? (
            <p className="py-4 text-sm text-muted">{t('money.noMovements')}</p>
          ) : (
            <StatementTable
              id="statement.warehouse"
              cols={cols}
              lines={d.lines}
              minWidth="min-w-[900px]"
            />
          )}
        </>
      )}
    </Period>
  );
}
