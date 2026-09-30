import { useDeferredValue, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  type SalesDocument,
  type SalesDocumentSummary,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { DocumentPreview } from '../components/DocumentPreview';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
import {
  useCancelOrder,
  useCancelQuotation,
  useDepartments,
  useRejectOrder,
  useDocument,
  useDocumentList,
  type DocKind,
  type DocScope,
} from '../lib/queries';
import { useDeviceInfo } from '../lib/device';
import { statusOf } from '../lib/status';
import { errorText } from '../lib/errors';
import { ConvertQuoteSheet } from '../components/ConvertQuoteSheet';
import { ApproveOrderSheet } from '../components/ApproveOrderSheet';
import { EditOrderSheet } from '../components/EditOrderSheet';
import { PartyPicker } from '../components/PartyPicker';
import { Sheet } from '../components/Sheet';
import type { Party } from '@skb/shared';

const filterField =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

const TAB_LABEL: Record<DocScope, Partial<Record<DocKind, TranslationKey>>> = {
  sales: {
    invoices: 'sales.invoices',
    orders: 'order.tab',
    returns: 'sales.returns',
    quotations: 'quote.tab',
  },
  purchases: { invoices: 'purchases.invoices', returns: 'purchases.returns' },
};

/** An invoice that still has something left to return (and isn't cancelled). */
function isReturnable(doc: SalesDocument | undefined): doc is SalesDocument {
  return (
    !!doc &&
    (doc.type === 'SALES_INVOICE' || doc.type === 'PURCHASE_INVOICE') &&
    doc.status !== 'CANCELLED' &&
    doc.lines.some((l) => l.quantity > l.returnedQuantity)
  );
}

/**
 * Sales or purchases: invoices and returns (and, for sales, price quotations) in one master-detail
 * screen. `?tab=returns` / `?tab=quotations` opens that list.
 */
export function DocumentsPage({ scope }: { scope: DocScope }) {
  const isSales = scope === 'sales';
  const { t, locale } = useT();
  const { deviceClass } = useDeviceInfo();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  // Invoices post at once (owner decision 2026-09-30). Pending invoices are only for someone who may
  // just save them; the tab shows for them, and for approvers while some are still waiting.
  const mayOrders =
    isSales && (permissions.includes('sales:order') || permissions.includes('sales:approve'));
  const waiting = useDocumentList(scope, 'orders', { page: 1, status: 'PENDING', enabled: mayOrders });
  const onlyOrders = permissions.includes('sales:order') && !permissions.includes('sales:create');
  const seesOrders =
    mayOrders && (onlyOrders || tab === 'orders' || (waiting.data?.total ?? 0) > 0);
  const kind: DocKind =
    tab === 'returns'
      ? 'returns'
      : tab === 'quotations' && isSales
        ? 'quotations'
        : tab === 'orders' && seesOrders
          ? 'orders'
          : 'invoices';
  const kinds: DocKind[] = isSales
    ? seesOrders
      ? ['invoices', 'orders', 'returns', 'quotations']
      : ['invoices', 'returns', 'quotations']
    : ['invoices', 'returns'];

  const canCreate = permissions.includes(isSales ? 'sales:create' : 'purchases:create');
  // A sales person who may only save pending invoices still starts one from here.
  const canStart = canCreate || (isSales && permissions.includes('sales:order'));
  const canReturn = permissions.includes(isSales ? 'sales:return' : 'purchases:return');
  const canQuote = isSales && permissions.includes('sales:quote');
  const [converting, setConverting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [editingOrder, setEditingOrder] = useState(false);
  const cancelQuote = useCancelQuotation();
  const cancelOrder = useCancelOrder();
  const myId = useAuth((s) => s.user?.id);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // `?doc=<id>` (e.g. from an item card) opens that document straight away.
  const linkedId = params.get('doc');
  const [selectedId, setSelectedId] = useState<string | null>(linkedId);
  useEffect(() => {
    if (linkedId) setSelectedId(linkedId);
  }, [linkedId]);
  // Filters: number or customer, department, status, company days.
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const departments = useDepartments();
  const list = useDocumentList(scope, kind, {
    page: 1,
    search: useDeferredValue(search.trim()) || undefined,
    status: status || undefined,
    departmentId: isSales ? departmentId || undefined : undefined,
    from: from || undefined,
    to: to || undefined,
  });
  const statuses: Record<DocKind, string[]> = {
    invoices: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'RETURNED', 'CANCELLED'],
    orders: ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'],
    quotations: ['PENDING', 'CONFIRMED', 'CANCELLED'],
    returns: [],
  };
  const [rejecting, setRejecting] = useState(false);
  const [newReturn, setNewReturn] = useState(false);
  const detail = useDocument(scope, selectedId);
  const isPhone = deviceClass === 'phone';
  const rows = list.data?.items ?? [];

  function switchKind(next: DocKind) {
    setSelectedId(null);
    setStatus('');
    setParams(next === 'invoices' ? {} : { tab: next }, { replace: true });
  }

  const quote = detail.data?.type === 'QUOTATION' ? detail.data : undefined;
  const quoteOpen = quote && quote.status === 'PENDING';
  const quoteActions = quote ? (
    <>
      {quoteOpen && canCreate && (
        <Button size="sm" icon="receipts" onClick={() => setConverting(true)}>
          {t('quote.makeInvoice')}
        </Button>
      )}
      {quoteOpen && canQuote && !confirmCancel && (
        <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
          {t('quote.cancel')}
        </Button>
      )}
      {quoteOpen && confirmCancel && (
        <Button
          size="sm"
          variant="danger"
          loading={cancelQuote.isPending}
          onClick={() => cancelQuote.mutate(quote.id, { onSettled: () => setConfirmCancel(false) })}
        >
          {t('quote.cancelConfirm')}
        </Button>
      )}
      {quote.invoiceId && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setSelectedId(quote.invoiceId!);
            setParams({ doc: quote.invoiceId! }, { replace: true });
          }}
        >
          {quote.invoiceNumber}
        </Button>
      )}
    </>
  ) : undefined;

  const order = detail.data?.type === 'SALES_ORDER' ? detail.data : undefined;
  const orderOpen = order && order.status === 'PENDING';
  const canApprove = permissions.includes('sales:approve');
  // Its maker (who may save them) or an approver may cancel it; the server checks the same.
  const canCancelOrder =
    canApprove || (permissions.includes('sales:order') && order?.staffId === myId);
  const orderActions = order ? (
    <>
      {orderOpen && canApprove && (
        <Button size="sm" icon="check" onClick={() => setApproving(true)}>
          {t('order.approve')}
        </Button>
      )}
      {orderOpen && canApprove && (
        <Button size="sm" variant="danger" onClick={() => setRejecting(true)}>
          {t('order.reject')}
        </Button>
      )}
      {orderOpen && canCancelOrder && !confirmCancel && (
        <Button size="sm" variant="secondary" onClick={() => setEditingOrder(true)}>
          {t('order.edit')}
        </Button>
      )}
      {orderOpen && canCancelOrder && !confirmCancel && (
        <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
          {t('order.cancel')}
        </Button>
      )}
      {orderOpen && confirmCancel && (
        <Button
          size="sm"
          variant="danger"
          loading={cancelOrder.isPending}
          onClick={() => cancelOrder.mutate(order.id, { onSettled: () => setConfirmCancel(false) })}
        >
          {t('order.cancelConfirm')}
        </Button>
      )}
      {order.invoiceId && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setSelectedId(order.invoiceId!);
            setParams({ doc: order.invoiceId! }, { replace: true });
          }}
        >
          {order.invoiceNumber}
        </Button>
      )}
    </>
  ) : undefined;

  const returnAction = quote ? (
    quoteActions
  ) : order ? (
    orderActions
  ) : canReturn && isReturnable(detail.data) ? (
    <Button
      size="sm"
      variant="secondary"
      icon="returns"
      onClick={() => navigate(`/${scope}/invoices/${detail.data!.id}/return`)}
    >
      {t('return.action')}
    </Button>
  ) : undefined;

  const partyLabel = isSales ? t('sales.customer') : t('invoice.supplier');

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(isSales ? 'nav.sales' : 'nav.purchases')}
        subtitle={list.data ? `${list.data.total} ${t('common.total')}` : undefined}
        action={
          kind === 'returns' && canReturn ? (
            <Button icon="plus" size="sm" onClick={() => setNewReturn(true)}>
              {t('return.new')}
            </Button>
          ) : kind === 'quotations' ? (
            canQuote ? (
              <Button icon="plus" size="sm" onClick={() => navigate('/sales/quotes/new')}>
                {t('quote.new')}
              </Button>
            ) : undefined
          ) : canStart ? (
            <Button icon="plus" size="sm" onClick={() => navigate(`/${scope}/new`)}>
              {t(isSales ? 'sales.newInvoice' : 'invoice.newPurchase')}
            </Button>
          ) : undefined
        }
      />

      <div
        role="tablist"
        className="inline-flex rounded-[var(--radius-app)] border border-line bg-surface p-1"
      >
        {kinds.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => switchKind(k)}
            className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
              kind === k ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
            }`}
          >
            {t(TAB_LABEL[scope][k]!)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-48 flex-1">
          <span className="mb-0.5 block text-xs text-muted">{t('common.search')}</span>
          <input
            type="search"
            className={filterField}
            placeholder={t('sales.filterSearch')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {isSales && (departments.data ?? []).length > 0 && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('invoice.department')}</span>
            <select className={filterField} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">{t('account.allDepartments')}</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              <option value="none">{t('invoice.noDepartment')}</option>
            </select>
          </label>
        )}
        {statuses[kind].length > 0 && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('common.status')}</span>
            <select className={filterField} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('sales.allStatuses')}</option>
              {statuses[kind].map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}` as TranslationKey)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('sales.filterFrom')}</span>
          <input type="date" className={`${filterField} tnum`} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('sales.filterTo')}</span>
          <input type="date" className={`${filterField} tnum`} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <div className={`grid gap-4 ${isPhone ? '' : 'lg:grid-cols-[1fr_minmax(340px,420px)]'}`}>
        {/* List */}
        <Card padded={false} className="overflow-hidden">
          {list.isLoading ? (
            <div className="grid place-items-center py-16 text-muted">
              <Spinner size={26} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={
                kind === 'quotations'
                  ? t('quote.empty')
                  : kind === 'orders'
                    ? t('order.empty')
                    : t('common.empty')
              }
              icon={kind === 'returns' ? 'returns' : scope}
            />
          ) : isPhone ? (
            <ul className="divide-y divide-[var(--c-line)]">
              {rows.map((doc) => (
                <li key={doc.id}>
                  <button
                    onClick={() => setSelectedId(doc.id)}
                    className="flex w-full items-center gap-3 p-4 text-start hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{doc.partyName}</span>
                      <span className="text-xs text-muted tnum">
                        {doc.number} · {formatDate(doc.issueDate, locale)}
                        {doc.sourceNumber && <> · {doc.sourceNumber}</>}
                        {doc.departmentName && <> · {doc.departmentName}</>}
                      </span>
                    </span>
                    <span className="text-end">
                      <span className="block text-sm font-semibold tnum">
                        {formatMoney(doc.grandTotal, doc.currency, locale)}
                      </span>
                      <Badge tone={statusOf(doc).tone}>
                        {t(statusOf(doc).key as TranslationKey)}
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="p-3 text-start font-medium">{t('sales.number')}</th>
                  <th className="p-3 text-start font-medium">{partyLabel}</th>
                  {kind === 'returns' && (
                    <th className="hidden p-3 text-start font-medium md:table-cell">
                      {t('return.against')}
                    </th>
                  )}
                  <th className="hidden p-3 text-start font-medium md:table-cell">
                    {t('common.date')}
                  </th>
                  <th className="p-3 text-start font-medium">{t('common.status')}</th>
                  <th className="p-3 text-end font-medium">{t('common.total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {rows.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    showSource={kind === 'returns'}
                    selected={doc.id === selectedId}
                    onSelect={() => setSelectedId(doc.id)}
                    locale={locale}
                    statusLabel={t(statusOf(doc).key as TranslationKey)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Detail (side panel on tablet/desktop) */}
        {!isPhone && (
          <Card padded={false} className="sticky top-20 h-[calc(100vh-7rem)] overflow-hidden">
            <DocumentPreview
              doc={detail.data}
              loading={detail.isFetching && !!selectedId}
              action={returnAction}
            />
          </Card>
        )}
      </div>

      {cancelQuote.error && (
        <p className="text-sm text-destructive">{errorText(t, cancelQuote.error)}</p>
      )}
      {cancelOrder.error && (
        <p className="text-sm text-destructive">{errorText(t, cancelOrder.error)}</p>
      )}
      {editingOrder && order && (
        <EditOrderSheet
          order={order}
          onClose={() => setEditingOrder(false)}
          onDone={() => setEditingOrder(false)}
        />
      )}
      {rejecting && order && (
        <RejectSheet id={order.id} number={order.number} onClose={() => setRejecting(false)} />
      )}
      {newReturn && <NewReturnSheet scope={scope} onClose={() => setNewReturn(false)} />}
      {approving && order && (
        <ApproveOrderSheet
          order={order}
          onClose={() => setApproving(false)}
          onDone={(invoice) => {
            setApproving(false);
            setSelectedId(invoice.id);
            setParams({ doc: invoice.id }, { replace: true });
          }}
        />
      )}
      {converting && quote && (
        <ConvertQuoteSheet
          quote={quote}
          onClose={() => setConverting(false)}
          onDone={(invoice) => {
            setConverting(false);
            setSelectedId(invoice.id);
            setParams({ doc: invoice.id }, { replace: true });
          }}
        />
      )}

      {/* Detail (full-screen sheet on phone) */}
      {isPhone && selectedId && (
        <div className="fixed inset-0 z-40 bg-canvas">
          <div className="h-full">
            <DocumentPreview
              doc={detail.data}
              loading={detail.isFetching}
              onClose={() => setSelectedId(null)}
              action={returnAction}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentRow({
  doc,
  showSource,
  selected,
  onSelect,
  locale,
  statusLabel,
}: {
  doc: SalesDocumentSummary;
  showSource: boolean;
  selected: boolean;
  onSelect: () => void;
  locale: 'en' | 'ar';
  statusLabel: string;
}) {
  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer transition-colors hover:bg-surface-2 ${selected ? 'bg-brand-soft' : ''}`}
    >
      <td className="p-3 font-medium tnum">{doc.number}</td>
      <td className="p-3">
        <span className="flex items-center gap-2">
          <Icon name="parties" size={16} className="text-faint" />
          <span className="truncate">{doc.partyName}</span>
          {doc.departmentName && (
            <span className="shrink-0 text-xs text-muted">· {doc.departmentName}</span>
          )}
        </span>
      </td>
      {showSource && (
        <td className="hidden p-3 text-muted tnum md:table-cell">{doc.sourceNumber ?? '—'}</td>
      )}
      <td className="hidden p-3 text-muted tnum md:table-cell">
        {formatDate(doc.issueDate, locale)}
      </td>
      <td className="p-3">
        <Badge tone={statusOf(doc).tone}>{statusLabel}</Badge>
      </td>
      <td className="p-3 text-end font-semibold tnum">
        {formatMoney(doc.grandTotal, doc.currency, locale)}
      </td>
    </tr>
  );
}

/** Turn a pending invoice down, saying why (its maker sees it; the goods are free again). */
function RejectSheet({ id, number, onClose }: { id: string; number: string; onClose: () => void }) {
  const { t } = useT();
  const reject = useRejectOrder();
  const [reason, setReason] = useState('');
  return (
    <Sheet title={`${t('order.rejectTitle')} — ${number}`} onClose={onClose} closeLabel={t('common.close')}>
      <div className="space-y-3">
        <p className="text-xs text-faint">{t('order.rejectHint')}</p>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('order.rejectReason')}</span>
          <textarea
            className="min-h-24 w-full rounded-[var(--radius-app)] border border-line bg-surface p-2.5 text-sm outline-none focus:border-brand"
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {reject.error && <p className="text-sm text-destructive">{errorText(t, reject.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={reject.isPending}
            disabled={!reason.trim()}
            onClick={() => reject.mutate({ id, reason: reason.trim() }, { onSuccess: onClose })}
          >
            {t('order.reject')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** A new return: the customer (or supplier), then the invoice the goods came on, then its return screen. */
function NewReturnSheet({ scope, onClose }: { scope: DocScope; onClose: () => void }) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const isSales = scope === 'sales';
  const [party, setParty] = useState<Party | null>(null);
  const invoices = useDocumentList(scope, 'invoices', { page: 1, search: party?.name });
  const rows = party
    ? (invoices.data?.items ?? []).filter((d) => d.partyName === party.name && d.status !== 'CANCELLED')
    : [];
  return (
    <Sheet title={t('return.new')} onClose={onClose} closeLabel={t('common.close')}>
      <div className="space-y-3">
        <p className="text-xs text-faint">{t('return.pickCustomer')}</p>
        <PartyPicker
          type={isSales ? 'CUSTOMER' : 'SUPPLIER'}
          value={party}
          onChange={setParty}
          label={t(isSales ? 'invoice.customer' : 'invoice.supplier')}
          placeholder={t(isSales ? 'invoice.selectCustomer' : 'invoice.selectSupplier')}
        />
        {party && (
          <div>
            <p className="mb-1 text-xs text-muted">{t('return.pickInvoice')}</p>
            {invoices.isLoading ? (
              <div className="grid place-items-center py-6 text-muted">
                <Spinner size={18} />
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted">{t('return.noInvoices')}</p>
            ) : (
              <ul className="max-h-80 divide-y divide-[var(--c-line)] overflow-auto rounded-[var(--radius-app)] border border-line">
                {rows.map((d) => (
                  <li key={d.id}>
                    <button
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-surface-2"
                      onClick={() => navigate(`/${scope}/invoices/${d.id}/return`)}
                    >
                      <span>
                        <span className="block font-medium tnum">{d.number}</span>
                        <span className="text-xs text-muted">
                          {formatDate(d.issueDate, locale)}
                          {d.departmentName && <> · {d.departmentName}</>}
                        </span>
                      </span>
                      <span className="tnum">{formatMoney(d.grandTotal, d.currency, locale)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
