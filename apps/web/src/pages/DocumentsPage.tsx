import { useDeferredValue, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  companyToday,
  formatDate,
  formatMoney,
  type SalesDocument,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { DocumentPreview } from '../components/DocumentPreview';
import { DocumentTable } from '../components/DocumentTable';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
import {
  useCancelOrder,
  useCancelQuotation,
  useCancelInvoice,
  useDepartments,
  useWarehouses,
  useRejectOrder,
  useDocument,
  useDocumentList,
  type DocKind,
  type DocScope,
} from '../lib/queries';
import { useDeviceInfo } from '../lib/device';
import { PAY_STATES, statusOf } from '../lib/status';
import { errorText } from '../lib/errors';
import { ConvertQuoteSheet } from '../components/ConvertQuoteSheet';
import { ApproveOrderSheet } from '../components/ApproveOrderSheet';
import { EditOrderSheet } from '../components/EditOrderSheet';
import { Sheet } from '../components/Sheet';

/** Documents per page of the list. */
const PAGE_SIZE = 50;

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
  const waiting = useDocumentList(scope, 'orders', {
    page: 1,
    status: 'PENDING',
    enabled: mayOrders,
  });
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
  const [deleting, setDeleting] = useState(false);
  const cancelInvoice = useCancelInvoice();

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
  const [from, setFrom] = useState(companyToday);
  const [to, setTo] = useState(companyToday);
  // Invoices: one payment state (owner, 2026-10-01) instead of status + payment.
  const [state, setState] = useState('');
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const myBranches = useAuth((s) => s.user?.branches ?? []);
  const warehouses = useWarehouses(true);
  const shownWarehouses = (warehouses.data ?? []).filter(
    (w) => w.kind !== 'TRANSIT' && (!branchId || w.branchId === branchId),
  );
  const [page, setPage] = useState(1);
  const departments = useDepartments();
  const deferredSearch = useDeferredValue(search.trim());
  const list = useDocumentList(scope, kind, {
    page,
    pageSize: PAGE_SIZE,
    search: deferredSearch || undefined,
    status: status || undefined,
    departmentId: isSales ? departmentId || undefined : undefined,
    from: from || undefined,
    to: to || undefined,
    state: kind === 'invoices' && state ? state : undefined,
    branchId: branchId || undefined,
    warehouseId: warehouseId || undefined,
  });
  // Another filter starts again at the first page.
  useEffect(
    () => setPage(1),
    [kind, deferredSearch, status, departmentId, from, to, state, branchId, warehouseId],
  );
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  // Escape closes an open document (unless a sheet over it is open: it closes that first).
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) setSelectedId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedId]);
  const statuses: Record<DocKind, string[]> = {
    invoices: [],
    orders: ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'],
    quotations: ['PENDING', 'CONFIRMED', 'CANCELLED'],
    returns: [],
  };
  const [rejecting, setRejecting] = useState(false);
  const detail = useDocument(scope, selectedId);
  const isPhone = deviceClass === 'phone';
  const rows = list.data?.items ?? [];

  function switchKind(next: DocKind) {
    setSelectedId(null);
    setStatus('');
    setState('');
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

  // A posted sales invoice: edit it or delete (cancel) it, each with its own permission.
  const invoice =
    isSales && detail.data?.type === 'SALES_INVOICE' && detail.data.status !== 'CANCELLED'
      ? detail.data
      : undefined;
  const invoiceActions = (
    <>
      {canReturn && isReturnable(detail.data) && (
        <Button
          size="sm"
          variant="secondary"
          icon="returns"
          onClick={() => navigate(`/${scope}/invoices/${detail.data!.id}/return`)}
        >
          {t('return.action')}
        </Button>
      )}
      {invoice && permissions.includes('sales:edit') && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => navigate(`/sales/invoices/${invoice.id}/edit`)}
        >
          {t('invoice.edit')}
        </Button>
      )}
      {invoice && permissions.includes('sales:cancel') && (
        <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>
          {t('invoice.cancel')}
        </Button>
      )}
    </>
  );
  const returnAction = quote ? quoteActions : order ? orderActions : invoiceActions;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(isSales ? 'nav.sales' : 'nav.purchases')}
        subtitle={list.data ? `${list.data.total} ${t('common.total')}` : undefined}
        action={
          kind === 'returns' && canReturn ? (
            <Button icon="plus" size="sm" onClick={() => navigate(`/${scope}/returns/new`)}>
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
            placeholder={t('list.searchHint')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {myBranches.length > 1 && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('list.branch')}</span>
            <select
              className={filterField}
              value={branchId}
              onChange={(e) => {
                setBranchId(e.target.value);
                setWarehouseId('');
              }}
            >
              <option value="">{t('list.all')}</option>
              {myBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {shownWarehouses.length > 1 && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('list.warehouse')}</span>
            <select
              className={filterField}
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">{t('list.all')}</option>
              {shownWarehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {isSales && (departments.data ?? []).length > 0 && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('invoice.department')}</span>
            <select
              className={filterField}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">{t('list.all')}</option>
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
            <select
              className={filterField}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
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
          <input
            type="date"
            className={`${filterField} tnum`}
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('sales.filterTo')}</span>
          <input
            type="date"
            className={`${filterField} tnum`}
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {kind === 'invoices' && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('list.state')}</span>
            <select
              className={filterField}
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="">{t('list.all')}</option>
              {PAY_STATES.map((s) => (
                <option key={s} value={s}>
                  {t(`state.${s}`)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* The list, full width; a document opens over it. */}
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
                    <span className="block truncate font-medium">
                      {doc.partyName}
                      {doc.partyCode != null && (
                        <span className="ms-1 text-xs font-normal text-muted tnum">
                          ({doc.partyCode})
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted tnum">
                      {doc.number} · {formatDate(doc.issueDate, locale)}
                      {doc.sourceNumber && <> · {doc.sourceNumber}</>}
                      {doc.departmentName && <> · {doc.departmentName}</>}
                      {doc.repName && <> · {doc.repName}</>}
                    </span>
                  </span>
                  <span className="text-end">
                    <span className="block text-sm font-semibold tnum">
                      {formatMoney(doc.grandTotal, doc.currency, locale)}
                    </span>
                    {doc.owed > 0 ? (
                      <span className="block text-xs text-warning tnum">
                        {t('list.owed')} {formatMoney(doc.owed, doc.currency, locale)}
                      </span>
                    ) : (
                      <Badge tone={statusOf(doc).tone}>
                        {t(statusOf(doc).key as TranslationKey)}
                      </Badge>
                    )}
                  </span>
                </button>
              </li>
            ))}
            {list.data && (
              <li className="flex justify-between bg-surface-2 p-4 text-sm font-semibold tnum">
                <span>
                  {list.data.totals.count} {t('list.documents')}
                </span>
                <span>
                  {formatMoney(list.data.totals.grandTotal, rows[0]?.currency ?? 'EGP', locale)}
                </span>
              </li>
            )}
          </ul>
        ) : (
          list.data && (
            <DocumentTable
              scope={scope}
              kind={kind}
              list={list.data}
              selectedId={selectedId}
              onSelect={setSelectedId}
              showDepartment={isSales && (departments.data ?? []).length > 0}
            />
          )
        )}
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('list.prev')}
          </Button>
          <span className="text-muted tnum">
            {t('list.page')} {page} {t('list.of')} {pages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('list.next')}
          </Button>
        </div>
      )}

      {/* A document, over the list (a panel at the side on a wide screen). */}
      {!isPhone && selectedId && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/30"
          onClick={() => setSelectedId(null)}
        >
          <div
            className="h-full w-full max-w-xl border-s border-line bg-canvas shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <DocumentPreview
              doc={detail.data}
              loading={detail.isFetching}
              onClose={() => setSelectedId(null)}
              action={returnAction}
              autoPrint={params.get('print') === '1'}
              onPrinted={() => setParams({ doc: selectedId ?? '' }, { replace: true })}
            />
          </div>
        </div>
      )}

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
      {deleting && invoice && (
        <Sheet
          title={`${t('invoice.cancelTitle')} — ${invoice.number}`}
          onClose={() => setDeleting(false)}
          closeLabel={t('common.close')}
        >
          <div className="space-y-3">
            <p className="text-sm">{t('invoice.cancelConfirm')}</p>
            {cancelInvoice.error && (
              <p className="text-sm text-destructive">{errorText(t, cancelInvoice.error)}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                loading={cancelInvoice.isPending}
                onClick={() =>
                  cancelInvoice.mutate(invoice.id, { onSuccess: () => setDeleting(false) })
                }
              >
                {t('invoice.cancel')}
              </Button>
            </div>
          </div>
        </Sheet>
      )}
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
              autoPrint={params.get('print') === '1'}
              onPrinted={() => setParams({ doc: selectedId ?? '' }, { replace: true })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Turn a pending invoice down, saying why (its maker sees it; the goods are free again). */
function RejectSheet({ id, number, onClose }: { id: string; number: string; onClose: () => void }) {
  const { t } = useT();
  const reject = useRejectOrder();
  const [reason, setReason] = useState('');
  return (
    <Sheet
      title={`${t('order.rejectTitle')} — ${number}`}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <div className="space-y-3">
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
