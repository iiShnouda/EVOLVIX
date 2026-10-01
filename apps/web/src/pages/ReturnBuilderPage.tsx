import { useState } from 'react';
import { useWorkDraft } from '../lib/workDraft';
import { useNavigate, useParams } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  formatQuantity,
  toMinor,
  type DocumentLine,
  type Party,
} from '@skb/shared';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ApiError } from '../lib/api';
import { useCreateReturn, useDocument, useDocumentList, type DocScope } from '../lib/queries';
import { MoneyAccountPicker } from '../components/MoneyAccountPicker';
import { TableColumns } from '../components/TableColumns';
import { PartyPicker } from '../components/PartyPicker';
import { useDeviceInfo } from '../lib/device';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** A line's units, largest first: its own unit and, for a carton line, the item's base unit. */
const unitsOf = (l: DocumentLine) =>
  l.unitFactor > 1
    ? [
        { name: l.unitName, factor: l.unitFactor },
        { name: l.baseUnitName, factor: 1 },
      ]
    : [{ name: l.unitName || l.baseUnitName, factor: 1 }];

/**
 * Sales return (مرتجع مبيعات) or purchase return (مرتجع مشتريات) against one invoice.
 * The user only picks quantities: price, discount and cost always come from the original
 * invoice line on the server. The totals here mirror the server's math so the user sees the
 * value, cost and profit being reversed before saving; the server's figures are final.
 */
export function ReturnBuilderPage({ scope }: { scope: DocScope }) {
  const { id = '' } = useParams();
  // A new return starts on the same page: the customer (by code or name), then their invoice.
  return id ? <ReturnForm key={id} scope={scope} id={id} /> : <ReturnStart scope={scope} />;
}

function ReturnForm({ scope, id }: { scope: DocScope; id: string }) {
  const isSale = scope === 'sales';
  const isPhone = useDeviceInfo().deviceClass === 'phone';
  const { t, locale } = useT();
  // The cost and profit a sales return reverses are the owner's unless given (costs:view).
  const seeCosts = useCan()('costs:view');
  const canRefund = useCan()('sales:approve');
  const navigate = useNavigate();

  const invoice = useDocument(scope, id);
  const create = useCreateReturn(scope);
  const serverError = create.error as ApiError | null;

  /** Typed return quantity per line, and whether it is in the line's unit (carton) or base units. */
  const [qty, setQty] = useState<Record<string, number>>({});
  const [inBase, setInBase] = useState<Record<string, boolean>>({});
  const [refund, setRefund] = useState('');
  const [refundAccountId, setRefundAccountId] = useState('');
  // Shipping we paid to get a customer's goods back: our expense.
  const [shipping, setShipping] = useState('');
  const [shippingAccountId, setShippingAccountId] = useState('');
  const [notes, setNotes] = useState('');

  // What's typed is kept through an app update (lines of the invoice that are gone are skipped).
  const work = useWorkDraft<ReturnDraft>(
    1,
    () =>
      Object.keys(qty).length === 0 && !notes && !refund && !shipping
        ? null
        : { qty, inBase, refund, refundAccountId, shipping, shippingAccountId, notes },
    (d) => {
      const text = (v: unknown) => (typeof v === 'string' ? v : '');
      const numbers = Object.fromEntries(
        Object.entries(d.qty ?? {}).filter(([, v]) => typeof v === 'number' && v >= 0),
      );
      const flags = Object.fromEntries(
        Object.entries(d.inBase ?? {}).filter(([, v]) => typeof v === 'boolean'),
      );
      setQty(numbers);
      setInBase(flags);
      setRefund(text(d.refund));
      setRefundAccountId(text(d.refundAccountId));
      setShipping(text(d.shipping));
      setShippingAccountId(text(d.shippingAccountId));
      setNotes(text(d.notes));
    },
  );

  const backTo = `/${scope}`;
  const title = t(isSale ? 'return.newSale' : 'return.newPurchase');
  const back = (
    <Button variant="ghost" size="sm" icon="close" onClick={() => navigate(backTo)}>
      {t('invoice.back')}
    </Button>
  );

  if (invoice.isLoading) {
    return (
      <div className="grid place-items-center py-24 text-muted">
        <Spinner size={26} />
      </div>
    );
  }
  const doc = invoice.data;
  const expectedType = isSale ? 'SALES_INVOICE' : 'PURCHASE_INVOICE';
  if (!doc || doc.type !== expectedType || doc.status === 'CANCELLED') {
    return (
      <div className="space-y-5">
        <PageHeader title={title} action={back} />
        <Card>
          <EmptyState title={t('return.notReturnable')} icon="returns" />
        </Card>
      </div>
    );
  }

  const currency = doc.currency;
  const rows = doc.lines.map((l) => {
    const remaining = Math.max(0, l.quantity - l.returnedQuantity);
    const factor = Math.max(1, l.unitFactor);
    // Quantities are typed in the line's unit (cartons of a carton line) or, for part of one, in
    // base units; the server always counts base units.
    const base = factor === 1 || !!inBase[l.id];
    const step = base ? 1 : factor;
    const typed = Math.max(0, qty[l.id] ?? 0);
    const q = Math.min(typed * step, remaining);
    // Proportional shares of the line's amount, discount and cost (the server settles the last piastre).
    const share = (total: number) => (l.quantity > 0 ? Math.round((total * q) / l.quantity) : 0);
    const discount = share(l.discount) + share(l.docDiscount);
    const value = share(l.lineTotal + l.discount) - discount;
    const cost = share(l.lineCost);
    return { line: l, remaining, factor, base, step, typed, q, value, cost, profit: value - cost };
  });
  const nothingLeft = rows.every((r) => r.remaining === 0);

  // A line's return quantity and its unit, shared by the table (wide screens) and the cards (phones).
  type Row = (typeof rows)[number];
  const cell =
    'h-8 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand disabled:bg-surface-2';
  const qtyInput = (r: Row, className = `${field} tnum`) => (
    <input
      type="number"
      min={0}
      max={Math.floor(r.remaining / r.step)}
      disabled={r.remaining === 0}
      className={className}
      value={r.typed}
      onChange={(e) =>
        setQty((prev) => ({
          ...prev,
          [r.line.id]: Math.min(
            Math.floor(r.remaining / r.step),
            Math.max(0, Math.floor(Number(e.target.value) || 0)),
          ),
        }))
      }
    />
  );
  const unitSelect = (r: Row, className = field) => (
    <select
      className={className}
      value={r.base ? 'base' : 'unit'}
      disabled={r.remaining === 0}
      onChange={(e) => {
        const toBase = e.target.value === 'base';
        setInBase((prev) => ({ ...prev, [r.line.id]: toBase }));
        setQty((prev) => ({
          ...prev,
          [r.line.id]: toBase ? r.q : Math.floor(r.q / r.factor),
        }));
      }}
    >
      <option value="unit">{r.line.unitName}</option>
      <option value="base">{r.line.baseUnitName}</option>
    </select>
  );

  const value = rows.reduce((s, r) => s + r.value, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const profit = value - cost;
  const invoiceTaxable = doc.subtotal - doc.discountTotal;
  const tax = invoiceTaxable > 0 ? Math.round((doc.taxTotal * value) / invoiceTaxable) : 0;
  const total = value + tax;
  const refundMinor = Math.min(
    Math.max(0, refund === '' ? 0 : toMinor(Number(refund) || 0)),
    total,
  );
  const anyQty = rows.some((r) => r.q > 0);
  const canSave = anyQty && !create.isPending;

  function setAll(fill: boolean) {
    // Everything left: in the line's unit when it divides evenly, else in base units.
    setInBase(
      Object.fromEntries(
        rows.map((r) => [r.line.id, r.factor > 1 && r.remaining % r.factor !== 0]),
      ),
    );
    setQty(
      Object.fromEntries(
        rows.map((r) => [
          r.line.id,
          fill
            ? r.factor > 1 && r.remaining % r.factor === 0
              ? r.remaining / r.factor
              : r.remaining
            : 0,
        ]),
      ),
    );
  }

  async function save() {
    if (!doc) return;
    try {
      await create.mutateAsync({
        invoiceId: doc.id,
        input: {
          lines: rows.filter((r) => r.q > 0).map((r) => ({ lineId: r.line.id, quantity: r.q })),
          refundAmount: refundMinor,
          refundAccountId: refundMinor > 0 && refundAccountId ? refundAccountId : undefined,
          shippingCost: isSale && Number(shipping) > 0 ? toMinor(Number(shipping)) : undefined,
          shippingAccountId:
            isSale && Number(shipping) > 0 && shippingAccountId ? shippingAccountId : undefined,
          notes: notes.trim() || undefined,
        },
      });
      work.finished();
      navigate(`${backTo}?tab=returns`);
    } catch {
      /* surfaced via serverError */
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={title} action={back} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        {/* Left: invoice + quantities */}
        <div className="min-w-0 space-y-4">
          {/* Like the invoice: who, which invoice, its rep and department. */}
          <Card className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <Info
                className="w-24 shrink-0"
                label={t('invoice.code')}
                value={doc.partyCode ?? ''}
              />
              <Info
                className="min-w-0 flex-1"
                label={isSale ? t('sales.customer') : t('invoice.supplier')}
                value={doc.partyName}
              />
            </div>
            <div className="flex items-end gap-2">
              <Info
                className="min-w-0 flex-1"
                label={t('return.against')}
                value={`${doc.number} · ${formatDate(doc.issueDate, locale)}`}
              />
              <Button size="sm" variant="ghost" onClick={() => navigate(`/${scope}/returns/new`)}>
                {t('return.otherInvoice')}
              </Button>
            </div>
            {doc.repName && (
              <Info
                label={t('invoice.rep')}
                value={`${doc.repName}${doc.repCode != null ? ` (${doc.repCode})` : ''}`}
              />
            )}
            {doc.departmentName && (
              <Info label={t('invoice.department')} value={doc.departmentName} />
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                {t('invoice.addItems')}
              </h2>
              {!nothingLeft && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setAll(false)}>
                    {t('return.clear')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setAll(true)}>
                    {t('return.all')}
                  </Button>
                </div>
              )}
            </div>

            {nothingLeft ? (
              <p className="rounded-[var(--radius-app)] bg-surface-2 p-4 text-center text-sm text-muted">
                {t('return.nothingLeft')}
              </p>
            ) : !isPhone ? (
              <TableColumns id={`return.${scope}`}>
                <div className="overflow-x-auto rounded-[var(--radius-app)] border border-line">
                  <table className="w-full text-[13px]">
                    <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                      <tr className="whitespace-nowrap">
                        <th className="px-1.5 py-2 text-start font-medium">#</th>
                        <th className="px-1.5 py-2 text-start font-medium">{t('invoice.item')}</th>
                        <th className="px-1.5 py-2 text-start font-medium">
                          {t('warehouse.label')}
                        </th>
                        <th className="px-1.5 py-2 text-end font-medium">
                          {t('return.onInvoice')}
                        </th>
                        <th className="px-1.5 py-2 text-end font-medium">
                          {t('return.alreadyReturned')}
                        </th>
                        <th className="px-1.5 py-2 text-end font-medium">
                          {t('return.remaining')}
                        </th>
                        <th className="px-1.5 py-2 text-start font-medium">{t('return.qty')}</th>
                        <th className="px-1.5 py-2 text-end font-medium">
                          {isSale ? t('invoice.price') : t('invoice.receiveCost')}
                        </th>
                        <th className="px-1.5 py-2 text-end font-medium">{t('return.value')}</th>
                        {isSale && seeCosts && (
                          <th className="px-1.5 py-2 text-end font-medium">
                            {t('return.profitReversed')}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--c-line)]">
                      {rows.map((r, i) => (
                        <tr
                          key={r.line.id}
                          className={`${r.q > 0 ? 'bg-brand-soft/40' : ''} ${r.remaining === 0 ? 'opacity-60' : ''}`}
                        >
                          <td className="px-1.5 py-2 text-muted tnum">{i + 1}</td>
                          <td className="min-w-32 px-1.5 py-2 font-medium">{r.line.productName}</td>
                          <td className="whitespace-nowrap px-1.5 py-2 text-muted">
                            {r.line.warehouseName ?? ''}
                          </td>
                          <td className="whitespace-nowrap px-1.5 py-2 text-end tnum">
                            {formatQuantity(r.line.quantity, unitsOf(r.line), locale)}
                          </td>
                          <td className="whitespace-nowrap px-1.5 py-2 text-end text-muted tnum">
                            {r.line.returnedQuantity
                              ? formatQuantity(r.line.returnedQuantity, unitsOf(r.line), locale)
                              : ''}
                          </td>
                          <td className="whitespace-nowrap px-1.5 py-2 text-end tnum">
                            {formatQuantity(r.remaining, unitsOf(r.line), locale)}
                          </td>
                          <td className="whitespace-nowrap px-1.5 py-1.5">
                            <span className="flex items-center gap-1">
                              {qtyInput(r, `${cell} w-16 tnum`)}
                              {r.factor > 1 && unitSelect(r, `${cell} w-24`)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-1.5 py-2 text-end tnum">
                            {formatMoney(r.line.unitPrice, currency, locale)} / {r.line.unitName}
                          </td>
                          <td className="whitespace-nowrap px-1.5 py-2 text-end font-semibold tnum">
                            {r.q > 0 ? formatMoney(r.value, currency, locale) : ''}
                          </td>
                          {isSale && seeCosts && (
                            <td className="whitespace-nowrap px-1.5 py-2 text-end text-warning tnum">
                              {r.q > 0 ? formatMoney(r.profit, currency, locale) : ''}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TableColumns>
            ) : (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li
                    key={r.line.id}
                    className={`rounded-[var(--radius-app)] border p-3 ${r.q > 0 ? 'border-brand' : 'border-line'} ${
                      r.remaining === 0 ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.line.productName}</p>
                        <p className="text-xs text-muted tnum">
                          {t('return.onInvoice')}:{' '}
                          {formatQuantity(r.line.quantity, unitsOf(r.line), locale)} ·{' '}
                          {t('return.alreadyReturned')}:{' '}
                          {formatQuantity(r.line.returnedQuantity, unitsOf(r.line), locale)} ·{' '}
                          {t('return.remaining')}:{' '}
                          {formatQuantity(r.remaining, unitsOf(r.line), locale)}
                        </p>
                        <p className="text-xs text-muted tnum">
                          {isSale ? t('invoice.price') : t('invoice.receiveCost')}{' '}
                          {formatMoney(r.line.unitPrice, currency, locale)} / {r.line.unitName}
                        </p>
                      </div>
                      <div className="flex items-end gap-2">
                        <label className="block w-24">
                          <span className="mb-0.5 block text-xs text-muted">{t('return.qty')}</span>
                          {qtyInput(r)}
                        </label>
                        {r.factor > 1 && (
                          <label className="block w-28">
                            <span className="mb-0.5 block text-xs text-muted">
                              {t('invoice.unit')}
                            </span>
                            {unitSelect(r)}
                          </label>
                        )}
                      </div>
                    </div>
                    {r.q > 0 && (
                      <p className="mt-2 text-xs tnum">
                        {t('return.value')}:{' '}
                        <span className="font-medium">
                          {formatMoney(r.value, currency, locale)}
                        </span>
                        {isSale && seeCosts && (
                          <>
                            {' · '}
                            {t('return.profitReversed')}:{' '}
                            <span className="font-medium text-warning">
                              {formatMoney(r.profit, currency, locale)}
                            </span>
                          </>
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Right: summary */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              {t('common.total')}
            </h2>
            <dl className="space-y-1.5 text-sm">
              <Row label={t('return.value')} value={formatMoney(value, currency, locale)} />
              {tax > 0 && (
                <Row label={t('invoice.tax')} value={formatMoney(tax, currency, locale)} />
              )}
              <div className="my-1 border-t border-line" />
              <Row
                label={t('invoice.grandTotal')}
                value={formatMoney(total, currency, locale)}
                strong
              />
              {(!isSale || seeCosts) && (
                <>
                  <div className="my-1 border-t border-line" />
                  <Row
                    label={isSale ? t('return.costBack') : t('return.costOut')}
                    value={formatMoney(cost, currency, locale)}
                  />
                </>
              )}
              {isSale && seeCosts && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted">{t('return.profitReversed')}</dt>
                  <dd className="font-semibold tnum text-warning">
                    {formatMoney(profit, currency, locale)}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-3 space-y-2">
              {/* Cash back to a customer is the accountant's; the seller's return goes on the account. */}
              {(!isSale || canRefund) && (
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">
                    {isSale ? t('return.refundNow') : t('return.refundFromSupplier')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${field} tnum`}
                    value={refund}
                    onChange={(e) => setRefund(e.target.value)}
                  />
                </label>
              )}
              {refundMinor > 0 && (
                <MoneyAccountPicker
                  className={field}
                  label={t('money.refundThrough')}
                  value={refundAccountId}
                  onChange={setRefundAccountId}
                />
              )}
              {isSale && (
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">
                    {t('invoice.shippingCost')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${field} tnum`}
                    value={shipping}
                    onChange={(e) => setShipping(e.target.value)}
                  />
                </label>
              )}
              {isSale && Number(shipping) > 0 && (
                <MoneyAccountPicker
                  className={field}
                  label={t('money.paidInto')}
                  value={shippingAccountId}
                  onChange={setShippingAccountId}
                />
              )}
              {doc.additionTotal > 0 && (
                <p className="text-xs text-faint">{t('charge.feeNotRefunded')}</p>
              )}
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('invoice.notes')}</span>
                <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>

            {!anyQty && !nothingLeft && (
              <p className="mt-3 text-xs text-muted">{t('return.pickQty')}</p>
            )}
            {serverError && (
              <p className="mt-3 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
                {serverError.message}
              </p>
            )}

            <Button
              className="mt-4 w-full"
              icon="check"
              loading={create.isPending}
              disabled={!canSave}
              onClick={save}
            >
              {create.isPending ? t('return.saving') : t('return.save')}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`tnum ${strong ? 'text-base font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}

/** A return being written, as kept through an app update. */
interface ReturnDraft {
  qty: Record<string, number>;
  inBase: Record<string, boolean>;
  refund: string;
  refundAccountId: string;
  shipping: string;
  shippingAccountId: string;
  notes: string;
}

/** A read-only field, laid out like the invoice's inputs. */
function Info({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="mb-0.5 block text-xs text-muted">{label}</span>
      <div className="grid h-9 items-center truncate rounded-[var(--radius-app)] border border-line bg-surface-2 px-2.5 text-sm tnum">
        {value}
      </div>
    </div>
  );
}

/**
 * A new return, on the same page as the return itself (owner, 2026-10-01: the return page looks like
 * the sales page): the customer by code or name, then which of their invoices the goods came on.
 */
function ReturnStart({ scope }: { scope: DocScope }) {
  const isSale = scope === 'sales';
  const { t, locale } = useT();
  const navigate = useNavigate();
  const [party, setParty] = useState<Party | null>(null);
  const invoices = useDocumentList(scope, 'invoices', {
    page: 1,
    pageSize: 100,
    search: party?.name,
    enabled: !!party,
  });
  const rows = party
    ? (invoices.data?.items ?? []).filter(
        (d) => d.partyName === party.name && d.status !== 'CANCELLED',
      )
    : [];
  const title = t(isSale ? 'return.newSale' : 'return.newPurchase');

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        action={
          <Button
            variant="ghost"
            size="sm"
            icon="close"
            onClick={() => navigate(`/${scope}?tab=returns`)}
          >
            {t('invoice.back')}
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <div className="min-w-0 space-y-4">
          <Card className="space-y-3">
            <PartyPicker
              type={isSale ? 'CUSTOMER' : 'SUPPLIER'}
              withCode
              value={party}
              onChange={setParty}
              label={t(isSale ? 'invoice.customer' : 'invoice.supplier')}
              placeholder={t(isSale ? 'invoice.selectCustomer' : 'invoice.selectSupplier')}
            />
            <p className="text-xs text-faint">{t('return.pickCustomer')}</p>
          </Card>
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-muted">{t('return.pickInvoice')}</h2>
            {!party ? (
              <p className="rounded-[var(--radius-app)] bg-surface-2 p-4 text-center text-sm text-muted">
                {t('return.pickCustomerFirst')}
              </p>
            ) : invoices.isLoading ? (
              <div className="grid place-items-center py-6 text-muted">
                <Spinner size={18} />
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted">{t('return.noInvoices')}</p>
            ) : (
              <TableColumns id={`return.pick.${scope}`}>
                <div className="overflow-x-auto rounded-[var(--radius-app)] border border-line">
                  <table className="w-full whitespace-nowrap text-[13px]">
                    <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                      <tr>
                        <th className="px-2 py-2 text-start font-medium">{t('sales.number')}</th>
                        <th className="px-2 py-2 text-start font-medium">{t('common.date')}</th>
                        <th className="px-2 py-2 text-start font-medium">
                          {t('invoice.department')}
                        </th>
                        <th className="px-2 py-2 text-end font-medium">{t('list.net')}</th>
                        <th className="px-2 py-2 text-end font-medium">{t('list.owed')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--c-line)]">
                      {rows.map((d) => (
                        <tr
                          key={d.id}
                          className="cursor-pointer hover:bg-surface-2"
                          onClick={() =>
                            navigate(`/${scope}/invoices/${d.id}/return`, { replace: true })
                          }
                        >
                          <td className="px-2 py-2 font-medium tnum">{d.number}</td>
                          <td className="px-2 py-2 tnum">
                            {formatDate(d.issueDate, locale, true)}
                          </td>
                          <td className="px-2 py-2 text-muted">{d.departmentName ?? ''}</td>
                          <td className="px-2 py-2 text-end tnum">
                            {formatMoney(d.grandTotal, d.currency, locale)}
                          </td>
                          <td className="px-2 py-2 text-end text-warning tnum">
                            {d.owed ? formatMoney(d.owed, d.currency, locale) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TableColumns>
            )}
          </Card>
        </div>
        <div className="min-w-0 lg:sticky lg:top-20 lg:h-fit">
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              {t('common.total')}
            </h2>
            <p className="text-sm text-muted">{t('return.pickQty')}</p>
            <Button className="mt-4 w-full" icon="check" disabled>
              {t('return.save')}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
