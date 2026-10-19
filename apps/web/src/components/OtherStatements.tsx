import { useRef, useState, type ReactNode } from 'react';
import {
  companyToday,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  type TranslationKey,
} from '@skb/shared';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from './ui';
import { ReportActions } from './ReportActions';
import { ItemLink } from './ItemLink';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useReportTools } from '../lib/report';

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
  }[];
}

/** From–to days, the print button, and the body below; shared by the statements here. */
function Period({
  title,
  from,
  to,
  onFrom,
  onTo,
  canPrint,
  children,
}: {
  title: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  canPrint: boolean;
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
            disabled={!canPrint}
            onPrint={() =>
              report.print(
                paper.current,
                title,
                `${formatDate(from, locale)} – ${formatDate(to, locale)}`,
              )
            }
          />
        </div>
      </div>
      <div ref={paper}>{children}</div>
    </div>
  );
}

const firstOfYear = () => `${companyToday().slice(0, 4)}-01-01`;

/** An expense item's statement (owner, 2026-10-19): every expense under it between two days. */
export function ExpenseStatementBody({ id, title }: { id: string; title: string }) {
  const { t, locale } = useT();
  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(companyToday);
  const q = useQuery({
    queryKey: ['statement', 'expense', id, from, to],
    queryFn: () =>
      api.get<ExpenseStatement>(`/expense-categories/${id}/statement?from=${from}&to=${to}`),
  });
  const d = q.data;
  const money = (v: number) => formatMoney(v, d?.currency ?? 'EGP', locale);
  return (
    <Period title={title} from={from} to={to} onFrom={setFrom} onTo={setTo} canPrint={!!d}>
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
            <ul className="divide-y divide-line">
              {d.lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {l.category}
                      <span className="ms-2 text-xs font-normal text-muted tnum" dir="ltr">
                        {l.number}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[l.accountName, l.branchName, l.notes].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-xs text-faint">
                      {formatDateTime(l.date, locale)}
                      {l.createdByName ? ` · ${l.createdByName}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tnum text-destructive">
                    {money(l.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Period>
  );
}

/**
 * A warehouse's statement (owner, 2026-10-19): every movement in or out between two days with the
 * pieces it holds after each; values only for whoever may see costs (the server sends none else).
 */
export function WarehouseStatementBody({ id, title }: { id: string; title: string }) {
  const { t, locale } = useT();
  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(companyToday);
  const q = useQuery({
    queryKey: ['statement', 'warehouse', id, from, to],
    queryFn: () =>
      api.get<WarehouseStatement>(`/inventory/warehouses/${id}/statement?from=${from}&to=${to}`),
  });
  const d = q.data;
  const money = (v: number) => formatMoney(v, d?.currency ?? 'EGP', locale);
  const n = (v: number) => formatNumber(v, locale);
  return (
    <Period title={title} from={from} to={to} onFrom={setFrom} onTo={setTo} canPrint={!!d}>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="p-2 text-start font-medium">{t('common.date')}</th>
                    <th className="p-2 text-start font-medium">{t('statement.movement')}</th>
                    <th className="p-2 text-start font-medium">{t('statement.fromTo')}</th>
                    <th className="p-2 text-start font-medium">{t('inventory.itemName')}</th>
                    <th className="p-2 text-end font-medium">{t('money.in')}</th>
                    <th className="p-2 text-end font-medium">{t('money.out')}</th>
                    {d.closingValue != null && (
                      <th className="p-2 text-end font-medium">{t('statement.value')}</th>
                    )}
                    <th className="p-2 text-end font-medium">{t('statement.itemBalance')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--c-line)]">
                  {d.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap p-2 text-xs text-muted">
                        {formatDateTime(l.date, locale)}
                      </td>
                      <td className="whitespace-nowrap p-2 text-xs">
                        {t(`movement.${l.type}` as TranslationKey)}
                        {l.reference && (
                          <span className="block text-muted tnum" dir="ltr">
                            {l.reference}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        {l.counterpart
                          ? `${t(l.quantity > 0 ? 'money.from' : 'money.to')} ${l.counterpart}`
                          : (l.note ?? '')}
                      </td>
                      <td className="p-2">
                        <ItemLink id={l.productId} name={l.name} code={l.code} />
                      </td>
                      <td className="p-2 text-end tnum text-positive">
                        {l.quantity > 0 ? n(l.quantity) : ''}
                      </td>
                      <td className="p-2 text-end tnum text-destructive">
                        {l.quantity < 0 ? n(-l.quantity) : ''}
                      </td>
                      {d.closingValue != null && (
                        <td className="p-2 text-end tnum">{money(Math.abs(l.value ?? 0))}</td>
                      )}
                      <td className="p-2 text-end tnum">{n(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Period>
  );
}
