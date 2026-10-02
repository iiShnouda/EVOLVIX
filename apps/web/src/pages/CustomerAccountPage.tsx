import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDate, formatMoney, type AccountDocument, type TranslationKey } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { DocumentPreview } from '../components/DocumentPreview';
import { SidedMoney, StatementBody } from '../components/LedgerStatementSheet';
import { Sheet } from '../components/Sheet';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useCustomerAccount, useDepartments, useDocument, useParty } from '../lib/queries';
import { statusOf } from '../lib/status';
import { TableColumns } from '../components/TableColumns';

/**
 * A party's account (owner, 2026-10-02: "the statement and the account are the same thing, put them
 * together"): one page, the statement (كشف الحساب) first, and for a customer their invoices per
 * sales department with what is left on each. Opening an invoice shows its items. No cost or profit.
 */
export function CustomerAccountPage() {
  const { id = '' } = useParams();
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const party = useParty(id);
  const p = party.data;
  const canStatement = can('ledger:view');
  const canInvoices = !!p?.types.includes('CUSTOMER') && can('sales:view');
  const [tab, setTab] = useState<'statement' | 'invoices' | null>(null);
  const shown = tab ?? (canStatement ? 'statement' : 'invoices');
  const [department, setDepartment] = useState('');
  const account = useCustomerAccount(id, department, canInvoices);
  const departments = useDepartments();
  const [openId, setOpenId] = useState<string | null>(null);
  const doc = useDocument('sales', openId);
  const a = account.data;
  const money = (v: number) => formatMoney(v, a?.currency ?? 'EGP', locale);

  if (party.isLoading)
    return (
      <div className="grid place-items-center py-24 text-muted">
        <Spinner size={26} />
      </div>
    );
  if (!p) return <EmptyState title={t('common.empty')} icon="parties" />;

  const header = (
    <>
      <PageHeader
        title={`${t('account.statement')} — ${p.name}`}
        subtitle={
          [p.code != null ? `${t('common.code')} ${p.code}` : null, p.phone, p.address]
            .filter(Boolean)
            .join(' · ') || undefined
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {canStatement && canInvoices && (
          <div
            role="tablist"
            className="flex gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1"
          >
            {(['statement', 'invoices'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={shown === k}
                onClick={() => setTab(k)}
                className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
                  shown === k ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
                }`}
              >
                {t(k === 'statement' ? 'account.statement' : 'account.byDepartment')}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-[var(--radius-app)] bg-surface-2 px-3 py-2 text-sm">
          <span className="text-muted">{t('account.balance')}</span>
          <SidedMoney value={p.balance} currency={a?.currency ?? 'EGP'} />
        </div>
      </div>
    </>
  );

  if (shown === 'statement' || !canInvoices)
    return (
      <div className="min-w-0 space-y-5">
        {header}
        {canStatement ? (
          <Card>
            <StatementBody kind="parties" id={p.id} title={p.name} />
          </Card>
        ) : (
          <EmptyState title={t('common.empty')} icon="parties" />
        )}
      </div>
    );
  if (account.isLoading || !a)
    return (
      <div className="space-y-5">
        {header}
        <div className="grid place-items-center py-24 text-muted">
          <Spinner size={26} />
        </div>
      </div>
    );

  const kpis: { label: string; value: number; tone?: string }[] = [
    { label: t('account.balance'), value: a.balance, tone: a.balance > 0 ? 'text-positive' : '' },
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
  const receiveNote = (d: AccountDocument) =>
    navigate(`/notes?receiveFor=${a.partyId}&invoice=${d.id}&amount=${d.outstanding}`);

  return (
    <div className="min-w-0 space-y-5">
      {header}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {kpis.map((k) => (
          <Card key={k.label}>
            <p className="text-xs text-muted">{k.label}</p>
            <p className={`mt-1 text-lg font-semibold tnum ${k.tone ?? ''}`}>{money(k.value)}</p>
          </Card>
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

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {t('account.byDepartment')}
          </h2>
          <select
            aria-label={t('invoice.department')}
            className="h-8 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">{t('account.allDepartments')}</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value="none">{t('invoice.noDepartment')}</option>
          </select>
        </div>
        {a.departments.length === 0 ? (
          <p className="p-4 text-sm text-muted">{t('common.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <TableColumns id="account.departments">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="p-3 text-start font-medium">{t('invoice.department')}</th>
                    <th className="p-3 text-end font-medium">{t('analytics.invoices')}</th>
                    <th className="p-3 text-end font-medium">{t('account.invoiced')}</th>
                    <th className="p-3 text-end font-medium">{t('account.discounts')}</th>
                    <th className="p-3 text-end font-medium">{t('account.returned')}</th>
                    <th className="p-3 text-end font-medium">{t('account.left')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--c-line)]">
                  {a.departments.map((d) => (
                    <tr key={d.departmentId ?? 'none'}>
                      <td className="p-3 font-medium">{d.name || t('invoice.noDepartment')}</td>
                      <td className="p-3 text-end tnum">{d.invoices}</td>
                      <td className="p-3 text-end tnum">{money(d.total)}</td>
                      <td className="p-3 text-end tnum">{money(d.discounts)}</td>
                      <td className="p-3 text-end tnum">{money(d.returns)}</td>
                      <td className="p-3 text-end font-semibold tnum">{money(d.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableColumns>
          </div>
        )}
      </Card>

      <Card padded={false} className="overflow-hidden">
        <h2 className="border-b border-line p-3 text-sm font-semibold uppercase tracking-wide text-muted">
          {t('account.documents')}
        </h2>
        {a.documents.length === 0 ? (
          <p className="p-4 text-sm text-muted">{t('common.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <TableColumns id="account.documents">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="p-3 text-start font-medium">{t('common.date')}</th>
                    <th className="p-3 text-start font-medium">#</th>
                    <th className="p-3 text-start font-medium">{t('invoice.department')}</th>
                    <th className="p-3 text-end font-medium">{t('common.total')}</th>
                    <th className="p-3 text-end font-medium">{t('account.discounts')}</th>
                    <th className="p-3 text-end font-medium">{t('account.paid')}</th>
                    <th className="p-3 text-end font-medium">{t('account.left')}</th>
                    <th className="p-3 text-start font-medium">{t('invoice.notes')}</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--c-line)]">
                  {a.documents.map((d) => {
                    const status = statusOf(d);
                    const isReturn = d.type === 'SALES_RETURN';
                    return (
                      <tr
                        key={d.id}
                        onClick={() => setOpenId(d.id)}
                        className="cursor-pointer hover:bg-surface-2"
                      >
                        <td className="p-3 tnum">{formatDate(d.issueDate, locale)}</td>
                        <td className="p-3">
                          <span className="font-medium tnum">{d.number}</span>
                          <span className="ms-2">
                            {d.type === 'SALES_INVOICE' ? (
                              <Badge tone={status.tone}>{t(status.key as TranslationKey)}</Badge>
                            ) : (
                              <Badge tone={isReturn ? 'warning' : 'info'}>
                                {t(`doc.${d.type}`)}
                              </Badge>
                            )}
                          </span>
                        </td>
                        <td className="p-3 text-muted">{d.departmentName ?? '—'}</td>
                        <td className="p-3 text-end tnum">
                          {isReturn ? '−' : ''}
                          {money(d.grandTotal)}
                        </td>
                        <td className="p-3 text-end tnum text-muted">
                          {d.discountTotal ? money(d.discountTotal) : '—'}
                        </td>
                        <td className="p-3 text-end tnum">
                          {d.type === 'SALES_INVOICE' ? money(d.paidAmount) : '—'}
                        </td>
                        <td className="p-3 text-end font-semibold tnum">
                          {d.type === 'SALES_INVOICE' ? money(d.outstanding) : '—'}
                        </td>
                        <td className="max-w-48 truncate p-3 text-muted">{d.notes ?? ''}</td>
                        <td className="p-3 text-end">
                          {d.type === 'SALES_INVOICE' &&
                            d.outstanding > 0 &&
                            can('notes:receive') && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  receiveNote(d);
                                }}
                              >
                                {t('order.receiveNote')}
                              </Button>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableColumns>
          </div>
        )}
      </Card>

      {openId && (
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
      )}
    </div>
  );
}
