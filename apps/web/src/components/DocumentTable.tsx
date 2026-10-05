import { type ReactNode } from 'react';
import {
  formatDate,
  formatTime,
  toMajor,
  type DocumentList,
  type SalesDocumentSummary,
  type TranslationKey,
} from '@skb/shared';
import { Badge } from './ui';
import { Icon } from './Icon';
import { TableColumns } from './TableColumns';
import { useT } from '../lib/i18n';
import { CodeName } from './CodeName';
import { PartyLink } from './PartyContact';
import { StateBadge } from './StateBadge';

type ColumnKey =
  | 'number'
  | 'date'
  | 'time'
  | 'code'
  | 'name'
  | 'rep'
  | 'department'
  | 'source'
  | 'gross'
  | 'discount'
  | 'net'
  | 'paid'
  | 'owed'
  | 'status'
  | 'notes'
  | 'print';

interface Column {
  key: ColumnKey;
  label: TranslationKey;
  /** Amounts line up at the end. */
  money?: boolean;
  cell: (d: SalesDocumentSummary) => ReactNode;
}

/**
 * The invoice list as a table, like the old program's (owner, 2026-10-01): serial, date, the
 * customer's code and name, rep, department, total, discount, net, paid, what is left, status and
 * note — never cost or profit. Columns can be hidden (TableColumns, kept per person); the last row
 * adds up everything the filter found, not just this page.
 */
export function DocumentTable({
  scope,
  kind,
  list,
  selectedId,
  onSelect,
  showDepartment,
  onPrint,
}: {
  scope: 'sales' | 'purchases';
  kind: string;
  list: DocumentList;
  selectedId: string | null;
  onSelect: (id: string) => void;
  showDepartment: boolean;
  /** Print a document straight from the list (owner, 2026-10-01). */
  onPrint?: (id: string) => void;
}) {
  const { t, locale } = useT();
  // Plain amounts, as on the old screen: the currency is the company's, said once in the header.
  const number = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const money = (v: number) => number.format(toMajor(v));
  const invoices = kind === 'invoices';

  const all: Column[] = [
    {
      key: 'number',
      label: 'list.serial',
      cell: (d) => <span className="font-medium">{d.number}</span>,
    },
    { key: 'date', label: 'common.date', cell: (d) => formatDate(d.issueDate, locale, true) },
    // When it was made, to the millisecond (owner, 2026-10-01).
    { key: 'time', label: 'common.time', cell: (d) => formatTime(d.issueDate, locale) },
    { key: 'code', label: 'common.code', cell: (d) => d.partyCode ?? '' },
    {
      key: 'name',
      label: scope === 'sales' ? 'sales.customer' : 'invoice.supplier',
      cell: (d) => (
        <PartyLink
          id={d.partyId}
          name={d.partyName}
          truncate
          className="block max-w-44 font-medium"
        />
      ),
    },
    ...(scope === 'sales'
      ? [
          {
            key: 'rep',
            label: 'invoice.rep',
            cell: (d) => (d.repName ? <CodeName code={d.repCode} name={d.repName} truncate /> : ''),
          } satisfies Column,
        ]
      : []),
    ...(showDepartment
      ? [
          {
            key: 'department',
            label: 'invoice.department',
            cell: (d) => d.departmentName ?? '',
          } satisfies Column,
        ]
      : []),
    ...(kind === 'returns'
      ? [
          {
            key: 'source',
            label: 'return.against',
            cell: (d) => d.sourceNumber ?? '',
          } satisfies Column,
        ]
      : []),
    { key: 'gross', label: 'list.gross', money: true, cell: (d) => money(d.subtotal) },
    {
      key: 'discount',
      label: 'list.discount',
      money: true,
      cell: (d) => (d.discountTotal ? money(d.discountTotal) : ''),
    },
    {
      key: 'net',
      label: 'list.net',
      money: true,
      cell: (d) => <span className="font-semibold">{money(d.grandTotal)}</span>,
    },
    ...(invoices
      ? [
          {
            key: 'paid',
            label: 'list.paid',
            money: true,
            cell: (d) => (d.paidAmount ? money(d.paidAmount) : ''),
          } satisfies Column,
          {
            key: 'owed',
            label: 'list.owed',
            money: true,
            cell: (d) =>
              d.owed ? <span className="font-medium text-warning">{money(d.owed)}</span> : '',
          } satisfies Column,
        ]
      : []),
    {
      key: 'status',
      label: 'common.status',
      cell: (d) => (
        <span className="inline-flex items-center gap-1">
          <StateBadge doc={d} />
          {/* A changed invoice over the limit shows all three: paid state, changed, waiting. */}
          {d.edited && d.status !== 'CANCELLED' && <Badge tone="info">{t('state.EDITED')}</Badge>}
          {d.overLimit && d.type === 'SALES_INVOICE' && d.status !== 'CANCELLED' && (
            <Badge tone="warning">{t('state.AWAITING')}</Badge>
          )}
        </span>
      ),
    },
    {
      key: 'notes',
      label: 'list.notes',
      cell: (d) => <span className="block max-w-36 truncate text-muted">{d.notes ?? ''}</span>,
    },
    ...(onPrint
      ? [
          {
            key: 'print',
            label: 'common.print',
            cell: (d) => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPrint(d.id);
                }}
                className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-brand"
                aria-label={`${t('common.print')} ${d.number}`}
                title={t('common.print')}
              >
                <Icon name="print" size={16} />
              </button>
            ),
          } satisfies Column,
        ]
      : []),
  ];

  const columns = all;

  // The totals row: the count under the first column, the sums under their amounts.
  const footer: Partial<Record<ColumnKey, ReactNode>> = {
    net: money(list.totals.grandTotal),
    paid: money(list.totals.paidAmount),
    owed: money(list.totals.owed),
  };

  return (
    <div>
      <TableColumns
        id={`documents.${scope}`}
        className="pt-2"
        toolbar={
          <span className="ps-2 tnum">
            {list.totals.count} {t('list.documents')}
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-xs text-muted">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`px-2 py-2 font-medium ${c.money ? 'text-end' : 'text-start'}`}
                  >
                    {t(c.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {list.items.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => onSelect(d.id)}
                  className={`cursor-pointer transition-colors hover:bg-surface-2 ${d.id === selectedId ? 'bg-brand-soft' : ''} ${d.status === 'CANCELLED' ? 'opacity-60' : ''}`}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`px-2 py-1.5 tnum ${c.money ? 'text-end' : ''}`}>
                      {c.cell(d)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line bg-surface-2 text-sm font-semibold">
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={`px-2 py-2 tnum ${c.money ? 'text-end' : ''}`}>
                    {i === 0 ? t('list.totals') : (footer[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </TableColumns>
    </div>
  );
}
