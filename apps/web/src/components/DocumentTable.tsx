import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  formatDate,
  toMajor,
  type DocumentList,
  type SalesDocumentSummary,
  type TranslationKey,
} from '@skb/shared';
import { Badge } from './ui';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { statusOf } from '../lib/status';

type ColumnKey =
  | 'number'
  | 'date'
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
  | 'notes';

interface Column {
  key: ColumnKey;
  label: TranslationKey;
  /** Amounts line up at the end. */
  money?: boolean;
  cell: (d: SalesDocumentSummary) => ReactNode;
}

/** Shown until the person picks their own (a screen preference, kept on this device). */
const HIDDEN_AT_FIRST: ColumnKey[] = ['discount'];

/**
 * The invoice list as a table, like the old program's (owner, 2026-10-01): serial, date, the
 * customer's code and name, rep, department, total, discount, net, paid, what is left, status and
 * note — never cost or profit. Columns can be hidden (remembered on this device, a UI preference
 * only); the last row adds up everything the filter found, not just this page.
 */
export function DocumentTable({
  scope,
  kind,
  list,
  selectedId,
  onSelect,
  showDepartment,
}: {
  scope: 'sales' | 'purchases';
  kind: string;
  list: DocumentList;
  selectedId: string | null;
  onSelect: (id: string) => void;
  showDepartment: boolean;
}) {
  const { t, locale } = useT();
  // Plain amounts, as on the old screen: the currency is the company's, said once in the header.
  const number = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const money = (v: number) => number.format(toMajor(v));
  const invoices = kind === 'invoices';

  const all: Column[] = [
    {
      key: 'number',
      label: 'sales.number',
      cell: (d) => <span className="font-medium">{d.number}</span>,
    },
    { key: 'date', label: 'common.date', cell: (d) => formatDate(d.issueDate, locale, true) },
    { key: 'code', label: 'common.code', cell: (d) => d.partyCode ?? '' },
    {
      key: 'name',
      label: scope === 'sales' ? 'sales.customer' : 'invoice.supplier',
      cell: (d) => <span className="block max-w-44 truncate font-medium">{d.partyName}</span>,
    },
    ...(scope === 'sales'
      ? [{ key: 'rep', label: 'invoice.rep', cell: (d) => d.repName ?? '' } satisfies Column]
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
      cell: (d) => <Badge tone={statusOf(d).tone}>{t(statusOf(d).key as TranslationKey)}</Badge>,
    },
    {
      key: 'notes',
      label: 'list.notes',
      cell: (d) => <span className="block max-w-36 truncate text-muted">{d.notes ?? ''}</span>,
    },
  ];

  const storeKey = `skb.columns.${scope}`;
  const [hidden, setHidden] = useState<ColumnKey[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) ?? 'null');
      return Array.isArray(saved) ? (saved as ColumnKey[]) : HIDDEN_AT_FIRST;
    } catch {
      return HIDDEN_AT_FIRST;
    }
  });
  function toggle(key: ColumnKey) {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try {
      localStorage.setItem(storeKey, JSON.stringify(next));
    } catch {
      /* not kept: fine */
    }
  }
  const columns = all.filter((c) => !hidden.includes(c.key));

  // The totals row: the count under the first column, the sums under their amounts.
  const footer: Partial<Record<ColumnKey, ReactNode>> = {
    net: money(list.totals.grandTotal),
    paid: money(list.totals.paidAmount),
    owed: money(list.totals.owed),
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-xs text-muted tnum">
          {list.totals.count} {t('list.documents')}
        </span>
        <ColumnMenu
          columns={all.map((c) => ({
            key: c.key,
            label: t(c.label),
            shown: !hidden.includes(c.key),
          }))}
          onToggle={toggle}
        />
      </div>
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
    </div>
  );
}

/** Which columns to show. */
function ColumnMenu({
  columns,
  onToggle,
}: {
  columns: { key: ColumnKey; label: string; shown: boolean }[];
  onToggle: (key: ColumnKey) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-surface-2 hover:text-fg"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {t('list.columns')} <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="absolute end-0 z-30 mt-1 w-48 rounded-[var(--radius-app)] border border-line bg-surface p-1 shadow-[var(--shadow-card)]">
          {columns.map((c) => (
            <label
              key={c.key}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2"
            >
              <input type="checkbox" checked={c.shown} onChange={() => onToggle(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
