import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  type AccountDocument,
  type CustomerAccount,
  type Party,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, Spinner } from './ui';
import { DocumentPreview } from './DocumentPreview';
import { SidedMoney, StatementBody } from './LedgerStatementSheet';
import { Sheet } from './Sheet';
import { TableColumns } from './TableColumns';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useDeviceInfo } from '../lib/device';
import { useCustomerAccount, useDepartments, useDocument } from '../lib/queries';
import { statusOf } from '../lib/status';

const small =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';

/**
 * A party's whole account on one page (owner, 2026-10-02: "the statement with everything it has
 * and everything of the by-department page"): the statement's filters, then — printed together —
 * the customer's totals, their account per sales department (a department opens the statement on
 * it), the statement itself and every invoice with its state, what was paid and what is left.
 * Used by the account page and the statement page. No cost or profit.
 */
export function PartyAccount({ party }: { party: Party }) {
  const { t } = useT();
  const can = useCan();
  const canStatement = can('ledger:view');
  const canInvoices = party.types.includes('CUSTOMER') && can('sales:view');
  const [department, setDepartment] = useState('');
  const account = useCustomerAccount(party.id, department, canInvoices);
  const departments = useDepartments();
  const [openId, setOpenId] = useState<string | null>(null);
  const doc = useDocument('sales', openId);
  const a = account.data;

  const top = canInvoices && a && (
    <AccountSummary a={a} department={department} onDepartment={setDepartment} />
  );
  const bottom = canInvoices && a && <AccountDocuments a={a} onOpen={setOpenId} />;
  const preview = openId && (
    <Sheet
      title={doc.data?.number ?? ''}
      onClose={() => setOpenId(null)}
      closeLabel={t('common.close')}
      wide
    >
      <div className="h-[70vh]">
        <DocumentPreview doc={doc.data} loading={doc.isFetching} />
      </div>
    </Sheet>
  );

  if (canStatement)
    return (
      <Card>
        <StatementBody
          kind="parties"
          id={party.id}
          title={party.name}
          department={department}
          onDepartment={setDepartment}
          before={top}
          after={bottom}
        />
        {preview}
      </Card>
    );
  if (!canInvoices) return <EmptyState title={t('common.empty')} icon="parties" />;
  // Without the ledger: the account by department and the invoices only.
  return (
    <Card>
      <label className="mb-3 block w-fit">
        <span className="mb-1 block text-xs text-muted">{t('invoice.department')}</span>
        <select
          className={small}
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <option value="">{t('account.allDepartments')}</option>
          {(departments.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {account.isLoading || !a ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={24} />
        </div>
      ) : (
        <>
          {top}
          {bottom}
        </>
      )}
      {preview}
    </Card>
  );
}

/** The customer's totals and their account per sales department. */
function AccountSummary({
  a,
  department,
  onDepartment,
}: {
  a: CustomerAccount;
  department: string;
  onDepartment: (id: string) => void;
}) {
  const { t, locale } = useT();
  const money = (v: number) => formatMoney(v, a.currency, locale);
  const kpis: { label: string; value: number; tone?: string }[] = [
    { label: t('account.invoiced'), value: a.invoiced },
    { label: t('account.discounts'), value: a.discounts },
    { label: t('account.returned'), value: a.returned },
    { label: t('account.outstanding'), value: a.outstanding },
    { label: t('account.pending'), value: a.pending, tone: a.pending > 0 ? 'text-warning' : '' },
    ...(a.creditLimit != null
      ? [
          { label: t('account.creditLimit'), value: a.creditLimit },
          {
            label: t('account.available'),
            value: Math.max(0, a.creditLimit - a.balance),
            tone: a.creditLimit - a.balance <= 0 ? 'text-destructive' : 'text-positive',
          },
        ]
      : []),
  ];
  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
        <div className="rounded-[var(--radius-app)] border border-line p-2.5">
          <p className="text-xs text-muted">{t('account.balance')}</p>
          <p className="mt-0.5 font-semibold">
            <SidedMoney value={a.balance} currency={a.currency} />
          </p>
        </div>
        {kpis.map((k) => (
          <div key={k.label} className="rounded-[var(--radius-app)] border border-line p-2.5">
            <p className="text-xs text-muted">{k.label}</p>
            <p className={`mt-0.5 font-semibold tnum ${k.tone ?? ''}`}>{money(k.value)}</p>
          </div>
        ))}
      </div>
      {(a.shippingAddress || a.notes) && (
        <p className="text-sm text-muted">
          {a.shippingAddress && (
            <>
              {t('parties.shippingAddress')}: <span className="text-fg">{a.shippingAddress}</span>
            </>
          )}
          {a.shippingAddress && a.notes && ' · '}
          {a.notes}
        </p>
      )}
      {a.departments.length > 0 && (
        <div className="rounded-[var(--radius-app)] border border-line">
          <h3 className="border-b border-line px-3 py-2 text-sm font-semibold">
            {t('account.byDepartment')}
          </h3>
          <div className="overflow-x-auto">
            <TableColumns id="account.departments">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="p-2 text-start font-medium">{t('invoice.department')}</th>
                    <th className="p-2 text-end font-medium">{t('analytics.invoices')}</th>
                    <th className="p-2 text-end font-medium">{t('account.invoiced')}</th>
                    <th className="p-2 text-end font-medium">{t('account.discounts')}</th>
                    <th className="p-2 text-end font-medium">{t('account.returned')}</th>
                    <th className="p-2 text-end font-medium">{t('account.left')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--c-line)]">
                  {a.departments.map((d) => {
                    const on = !!d.departmentId && d.departmentId === department;
                    return (
                      <tr
                        key={d.departmentId ?? 'none'}
                        onClick={() => d.departmentId && onDepartment(on ? '' : d.departmentId)}
                        title={d.departmentId ? t('account.showDepartment') : undefined}
                        className={`${d.departmentId ? 'cursor-pointer hover:bg-surface-2' : ''} ${on ? 'bg-brand-soft' : ''}`}
                      >
                        <td className="p-2 font-medium">{d.name || t('invoice.noDepartment')}</td>
                        <td className="p-2 text-end tnum">{d.invoices}</td>
                        <td className="p-2 text-end tnum">{money(d.total)}</td>
                        <td className="p-2 text-end tnum">{money(d.discounts)}</td>
                        <td className="p-2 text-end tnum">{money(d.returns)}</td>
                        <td className="p-2 text-end font-semibold tnum">{money(d.outstanding)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableColumns>
          </div>
        </div>
      )}
    </div>
  );
}

/** Every invoice and return of the customer: its state, total, discount, paid and what is left. */
function AccountDocuments({ a, onOpen }: { a: CustomerAccount; onOpen: (id: string) => void }) {
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const { deviceClass } = useDeviceInfo();
  const money = (v: number) => formatMoney(v, a.currency, locale);
  const receiveNote = (d: AccountDocument) =>
    navigate(`/notes?receiveFor=${a.partyId}&invoice=${d.id}&amount=${d.outstanding}`);
  const badge = (d: AccountDocument) => {
    if (d.type === 'SALES_INVOICE') {
      const status = statusOf(d);
      return <Badge tone={status.tone}>{t(status.key as TranslationKey)}</Badge>;
    }
    return (
      <Badge tone={d.type === 'SALES_RETURN' ? 'warning' : 'info'}>{t(`doc.${d.type}`)}</Badge>
    );
  };
  const noteButton = (d: AccountDocument) =>
    d.type === 'SALES_INVOICE' &&
    d.outstanding > 0 &&
    can('notes:receive') && (
      <Button
        data-noprint
        size="sm"
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          receiveNote(d);
        }}
      >
        {t('order.receiveNote')}
      </Button>
    );

  return (
    <div className="mt-4 rounded-[var(--radius-app)] border border-line">
      <h3 className="border-b border-line px-3 py-2 text-sm font-semibold">
        {t('account.documents')}
      </h3>
      {a.documents.length === 0 ? (
        <p className="p-3 text-sm text-muted">{t('common.empty')}</p>
      ) : deviceClass !== 'desktop' ? (
        <div className="space-y-2 p-2">
          {a.documents.map((d) => {
            const isReturn = d.type === 'SALES_RETURN';
            return (
              <div
                key={d.id}
                onClick={() => onOpen(d.id)}
                className="cursor-pointer rounded-[var(--radius-app)] border border-line p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 font-medium">
                      <bdi className="tnum">{d.number}</bdi> {badge(d)}
                    </p>
                    <p className="text-xs text-muted">
                      <span className="tnum">{formatDate(d.issueDate, locale)}</span>
                      {d.departmentName && ` · ${d.departmentName}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-end tnum">
                    <p className="font-semibold">
                      {isReturn ? '−' : ''}
                      {money(d.grandTotal)}
                    </p>
                    {d.type === 'SALES_INVOICE' && (
                      <p className="text-xs text-muted">
                        {t('account.left')} {money(d.outstanding)}
                      </p>
                    )}
                  </div>
                </div>
                {(d.notes || noteButton(d)) && (
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                    <span className="min-w-0 truncate">{d.notes ?? ''}</span>
                    {noteButton(d)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <TableColumns id="account.documents">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="p-2 text-start font-medium">{t('common.date')}</th>
                  <th className="p-2 text-start font-medium">#</th>
                  <th className="p-2 text-start font-medium">{t('invoice.department')}</th>
                  <th className="p-2 text-end font-medium">{t('common.total')}</th>
                  <th className="p-2 text-end font-medium">{t('account.discounts')}</th>
                  <th className="p-2 text-end font-medium">{t('account.paid')}</th>
                  <th className="p-2 text-end font-medium">{t('account.left')}</th>
                  <th className="p-2 text-start font-medium">{t('invoice.notes')}</th>
                  <th className="p-2" data-noprint />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {a.documents.map((d) => {
                  const isReturn = d.type === 'SALES_RETURN';
                  const invoice = d.type === 'SALES_INVOICE';
                  return (
                    <tr
                      key={d.id}
                      onClick={() => onOpen(d.id)}
                      className="cursor-pointer hover:bg-surface-2"
                    >
                      <td className="p-2 tnum">{formatDate(d.issueDate, locale)}</td>
                      <td className="p-2">
                        <span className="font-medium tnum">{d.number}</span>
                        <span className="ms-2">{badge(d)}</span>
                      </td>
                      <td className="p-2 text-muted">{d.departmentName ?? '—'}</td>
                      <td className="p-2 text-end tnum">
                        {isReturn ? '−' : ''}
                        {money(d.grandTotal)}
                      </td>
                      <td className="p-2 text-end tnum text-muted">
                        {d.discountTotal ? money(d.discountTotal) : '—'}
                      </td>
                      <td className="p-2 text-end tnum">{invoice ? money(d.paidAmount) : '—'}</td>
                      <td className="p-2 text-end font-semibold tnum">
                        {invoice ? money(d.outstanding) : '—'}
                      </td>
                      <td className="max-w-48 truncate p-2 text-muted">{d.notes ?? ''}</td>
                      <td className="p-2 text-end" data-noprint>
                        {noteButton(d)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableColumns>
        </div>
      )}
    </div>
  );
}
