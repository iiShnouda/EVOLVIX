import { useDeferredValue, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  companyToday,
  formatDate,
  formatDateTime,
  formatMoney,
  type SalesDocument,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { DocumentPreview } from '../components/DocumentPreview';
import { DocumentTable } from '../components/DocumentTable';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
import { useIsOwner } from '../lib/can';
import { useWorkPlace } from '../lib/workPlace';
import {
  useApproveLimit,
  useCompanySettings,
  useRejectLimit,
  useCancelOrder,
  useCancelInvoice,
  useDepartments,
  usePageSize,
  useWarehouses,
  useRejectOrder,
  useDocument,
  useDocumentList,
  type DocKind,
  type DocScope,
} from '../lib/queries';
import { useDeviceInfo } from '../lib/device';
import { PAY_STATES, statusOf } from '../lib/status';
import { Pager } from '../components/Pager';
import { errorText } from '../lib/errors';
import { ApproveOrderSheet } from '../components/ApproveOrderSheet';
import { EditOrderSheet } from '../components/EditOrderSheet';
import { Sheet } from '../components/Sheet';
import { CodeName, codeName } from '../components/CodeName';

/** Documents per page of the list. */

const filterField =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

const TAB_LABEL: Record<DocScope, Partial<Record<DocKind, TranslationKey>>> = {
  sales: {
    invoices: 'sales.invoices',
    returns: 'sales.returns',
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
 * Sales or purchases: invoices and returns in one master-detail screen; `?tab=returns` opens the
 * returns. No quotations and no separate list of pending invoices (owner decision 2026-10-01): an
 * invoice waiting for the accountant (over the customer's purchase limit) is in the sales list with
 * its state, and so are cancelled and changed ones.
 */
export function DocumentsPage({ scope }: { scope: DocScope }) {
  const isSales = scope === 'sales';
  const { t, locale } = useT();
  const { deviceClass } = useDeviceInfo();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const kind: DocKind = tab === 'returns' ? 'returns' : 'invoices';
  const kinds: DocKind[] = ['invoices', 'returns'];

  const canCreate = permissions.includes(isSales ? 'sales:create' : 'purchases:create');
  // A sales person who may only save pending invoices still starts one from here.
  const canStart = canCreate || (isSales && permissions.includes('sales:order'));
  const canReturn = permissions.includes(isSales ? 'sales:return' : 'purchases:return');
  const [approving, setApproving] = useState(false);
  const [editingOrder, setEditingOrder] = useState(false);
  const cancelOrder = useCancelOrder();
  const myId = useAuth((s) => s.user?.id);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelInvoice = useCancelInvoice();

  // `?doc=<id>` (e.g. from an item card) opens that document straight away.
  const linkedId = params.get('doc');
  const [selectedId, setSelectedId] = useState<string | null>(linkedId);
  useEffect(() => {
    if (linkedId) setSelectedId(linkedId);
  }, [linkedId]);
  // Filters: number or customer, department, status, company days.
  // Three searches (owner, 2026-10-06): the number, the customer's name, the customer's code.
  const [number, setNumber] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partyCode, setPartyCode] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(companyToday);
  const [to, setTo] = useState(companyToday);
  // Invoices: one payment state (owner, 2026-10-01) instead of status + payment.
  // An old link to the pending list opens the invoices waiting for approval.
  const [state, setState] = useState(tab === 'orders' ? 'AWAITING' : '');
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const myBranches = useAuth((s) => s.user?.branches ?? []);
  // The filters start at the branch, warehouse and department the person works in (owner,
  // 2026-10-02); picking one here changes it everywhere.
  const [place, setPlace] = useWorkPlace();
  const [placed, setPlaced] = useState(false);
  useEffect(() => {
    // Purchases start on everything (owner, 2026-10-19): nothing chosen until the person picks.
    if (!isSales) return;
    if (placed || (!place.branchId && !place.warehouseId && !place.departmentId)) return;
    setPlaced(true);
    if (place.branchId) setBranchId(place.branchId);
    if (place.warehouseId) setWarehouseId(place.warehouseId);
    if (isSales && place.departmentId) setDepartmentId(place.departmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.branchId, place.warehouseId, place.departmentId]);
  const warehouses = useWarehouses(true);
  const shownWarehouses = (warehouses.data ?? []).filter(
    (w) => w.kind !== 'TRANSIT' && (!branchId || w.branchId === branchId),
  );
  const [page, setPage] = useState(1);
  // Rows per page, kept per person (owner, 2026-10-01).
  const [pageSize, setPageSize] = usePageSize(`documents.${scope}`, 50);
  const departments = useDepartments();
  const deferredSearch = useDeferredValue(
    [number.trim(), partyName.trim(), partyCode.trim()].join('\u0001'),
  );
  const [dNumber = '', dParty = '', dCode = ''] = deferredSearch.split('\u0001');
  const list = useDocumentList(scope, kind, {
    page,
    pageSize,
    number: dNumber || undefined,
    party: dParty || undefined,
    partyCode: dCode || undefined,
    status: status || undefined,
    departmentId: kind === 'invoices' || isSales ? departmentId || undefined : undefined,
    from: from || undefined,
    to: to || undefined,
    state: kind === 'invoices' && state ? state : undefined,
    branchId: branchId || undefined,
    warehouseId: warehouseId || undefined,
  });
  // Another filter starts again at the first page.
  useEffect(
    () => setPage(1),
    [kind, deferredSearch, status, departmentId, from, to, state, branchId, warehouseId, pageSize],
  );
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / pageSize));
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
  // Goods come back on a sales invoice only some hours after it was made (Settings; owner
  // 2026-10-02): until then it is changed instead.
  const returnAfterHours = useCompanySettings().data?.returnAfterHours ?? 0;
  const returnFrom =
    invoice && returnAfterHours > 0
      ? new Date(new Date(invoice.issueDate).getTime() + returnAfterHours * 3_600_000)
      : null;
  const owner = useIsOwner();
  const returnTooSoon = !owner && !!returnFrom && returnFrom.getTime() > Date.now();
  const approveLimit = useApproveLimit();
  const [rejectingLimit, setRejectingLimit] = useState(false);
  const waitsOverLimit = !!invoice?.overLimit;
  const invoiceActions = (
    <>
      {waitsOverLimit && canApprove && (
        <Button
          size="sm"
          icon="check"
          loading={approveLimit.isPending}
          onClick={() => approveLimit.mutate(invoice!.id)}
        >
          {t('order.approve')}
        </Button>
      )}
      {waitsOverLimit && canApprove && (
        <Button size="sm" variant="danger" onClick={() => setRejectingLimit(true)}>
          {t('order.reject')}
        </Button>
      )}
      {canReturn && isReturnable(detail.data) && (
        <Button
          size="sm"
          variant="secondary"
          icon="returns"
          disabled={returnTooSoon}
          title={
            returnTooSoon && returnFrom
              ? `${t('return.from')} ${formatDateTime(returnFrom.toISOString(), locale)}`
              : undefined
          }
          onClick={() => navigate(`/${scope}/invoices/${detail.data!.id}/return`)}
        >
          {t('return.action')}
        </Button>
      )}
      {invoice && canApprove && invoice.partyCode !== 0 && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate(`/sales/together/${invoice.partyId}`)}
        >
          {t('together.open')}
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
  const returnAction = order ? orderActions : invoiceActions;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(isSales ? 'nav.sales' : 'nav.purchases')}
        subtitle={list.data ? `${list.data.total} ${t('common.total')}` : undefined}
        action={
          kind === 'invoices' && isSales && permissions.includes('sales:approve') && !canStart ? (
            <Button variant="secondary" size="sm" onClick={() => navigate('/sales/together')}>
              {t('together.open')}
            </Button>
          ) : kind === 'returns' && canReturn ? (
            <Button icon="plus" size="sm" onClick={() => navigate(`/${scope}/returns/new`)}>
              {t('return.new')}
            </Button>
          ) : canStart ? (
            <span className="flex gap-2">
              {isSales && permissions.includes('sales:approve') && (
                <Button variant="secondary" size="sm" onClick={() => navigate('/sales/together')}>
                  {t('together.open')}
                </Button>
              )}
              <Button icon="plus" size="sm" onClick={() => navigate(`/${scope}/new`)}>
                {t(isSales ? 'sales.newInvoice' : 'invoice.newPurchase')}
              </Button>
            </span>
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
        <label className="block w-40">
          <span className="mb-0.5 block text-xs text-muted">{t('ledger.docNumber')}</span>
          <input
            type="search"
            className={`${filterField} tnum`}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
        {/* The code before the name, as everywhere (owner, 2026-10-06). */}
        <label className="block w-28">
          <span className="mb-0.5 block text-xs text-muted">
            {t(isSales ? 'list.customerCode' : 'list.supplierCode')}
          </span>
          <input
            inputMode="numeric"
            className={`${filterField} tnum`}
            value={partyCode}
            onChange={(e) => setPartyCode(e.target.value.replace(/[^\d]/g, ''))}
          />
        </label>
        <label className="block min-w-48 flex-1">
          <span className="mb-0.5 block text-xs text-muted">
            {t(isSales ? 'list.customerName' : 'list.supplierName')}
          </span>
          <input
            type="search"
            className={filterField}
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
          />
        </label>
        {myBranches.length > 0 && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('list.branch')}</span>
            <select
              className={filterField}
              value={branchId}
              onChange={(e) => {
                setBranchId(e.target.value);
                setWarehouseId('');
                if (e.target.value) setPlace({ branchId: e.target.value, warehouseId: '' });
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
        {/* Always there (owner, 2026-10-06: picking a branch must not take the warehouse away). */}
        {(warehouses.data ?? []).length > 0 && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('list.warehouse')}</span>
            <select
              className={filterField}
              value={warehouseId}
              onChange={(e) => {
                setWarehouseId(e.target.value);
                if (e.target.value) setPlace({ warehouseId: e.target.value });
              }}
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
        {(isSales || kind === 'invoices') && (departments.data ?? []).length > 0 && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('invoice.department')}</span>
            <select
              className={filterField}
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                if (e.target.value && e.target.value !== 'none')
                  setPlace({ departmentId: e.target.value });
              }}
            >
              <option value="">{t('list.all')}</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              {isSales && <option value="none">{t('invoice.noDepartment')}</option>}
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
        <label className="block w-40 min-w-0">
          <span className="mb-0.5 block text-xs text-muted">{t('sales.filterFrom')}</span>
          <input
            type="date"
            className={`${filterField} tnum`}
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="block w-40 min-w-0">
          <span className="mb-0.5 block text-xs text-muted">{t('sales.filterTo')}</span>
          <input
            type="date"
            className={`${filterField} tnum`}
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {kind === 'invoices' && isSales && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('list.state')}</span>
            <select
              className={filterField}
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="">{t('list.all')}</option>
              {[...PAY_STATES, ...(isSales ? (['AWAITING', 'EDITED'] as const) : [])].map((s) => (
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
          <EmptyState title={t('common.empty')} icon={kind === 'returns' ? 'returns' : scope} />
        ) : isPhone ? (
          <ul className="divide-y divide-[var(--c-line)]">
            {rows.map((doc) => (
              <li key={doc.id}>
                <button
                  onClick={() => setSelectedId(doc.id)}
                  className="flex w-full items-center gap-3 p-4 text-start hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      <CodeName code={doc.partyCode} name={doc.partyName} truncate />
                    </span>
                    <span className="text-xs text-muted tnum">
                      {doc.number} · {formatDate(doc.issueDate, locale)}
                      {doc.sourceNumber && <> · {doc.sourceNumber}</>}
                      {doc.departmentName && <> · {doc.departmentName}</>}
                      {doc.repName && <> · {codeName(doc.repCode, doc.repName)}</>}
                    </span>
                    {(doc.edited || (doc.overLimit && doc.type === 'SALES_INVOICE')) &&
                      doc.status !== 'CANCELLED' && (
                        <span className="mt-1 flex gap-1">
                          {doc.edited && <Badge tone="info">{t('state.EDITED')}</Badge>}
                          {doc.overLimit && <Badge tone="warning">{t('state.AWAITING')}</Badge>}
                        </span>
                      )}
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
                      isSales && (
                        <Badge tone={statusOf(doc).tone}>
                          {t(statusOf(doc).key as TranslationKey)}
                        </Badge>
                      )
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
              onPrint={(id) => {
                setSelectedId(id);
                setParams({ ...(tab ? { tab } : {}), doc: id, print: '1' }, { replace: true });
              }}
            />
          )
        )}
      </Card>
      <div className="flex justify-end">
        <Pager page={page} size={pageSize} pages={pages} onPage={setPage} onSize={setPageSize} />
      </div>

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
      {rejectingLimit && invoice && (
        <RejectSheet
          id={invoice.id}
          number={invoice.number}
          posted
          onClose={() => setRejectingLimit(false)}
        />
      )}
      {approveLimit.error && (
        <p className="text-sm text-destructive">{errorText(t, approveLimit.error)}</p>
      )}
      {deleting && invoice && (
        <Sheet
          title={`${t('invoice.cancelTitle')} — ${invoice.number}`}
          onClose={() => setDeleting(false)}
          closeLabel={t('common.close')}
        >
          <div className="space-y-3">
            <p className="text-sm">{t('invoice.cancelConfirm')}</p>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t('invoice.cancelReason')}</span>
              <textarea
                className="min-h-20 w-full rounded-[var(--radius-app)] border border-line bg-surface p-2.5 text-sm outline-none focus:border-brand"
                maxLength={300}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </label>
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
                  cancelInvoice.mutate(
                    { id: invoice.id, reason: cancelReason.trim() || undefined },
                    {
                      onSuccess: () => {
                        setDeleting(false);
                        setCancelReason('');
                      },
                    },
                  )
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
function RejectSheet({
  id,
  number,
  posted,
  onClose,
}: {
  id: string;
  number: string;
  /** A posted invoice waiting over the limit: turning it down cancels it. */
  posted?: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const rejectOrder = useRejectOrder();
  const rejectPosted = useRejectLimit();
  const reject = posted ? rejectPosted : rejectOrder;
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
