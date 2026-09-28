import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDate, formatMoney, formatNumber, toMinor } from '@skb/shared';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { useT } from '../lib/i18n';
import { ApiError } from '../lib/api';
import { useCreateReturn, useDocument, type DocScope } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/**
 * Sales return (مرتجع مبيعات) or purchase return (مرتجع مشتريات) against one invoice.
 * The user only picks quantities: price, discount and cost always come from the original
 * invoice line on the server. The totals here mirror the server's math so the user sees the
 * value, cost and profit being reversed before saving; the server's figures are final.
 */
export function ReturnBuilderPage({ scope }: { scope: DocScope }) {
  const isSale = scope === 'sales';
  const { id = '' } = useParams();
  const { t, locale } = useT();
  const navigate = useNavigate();

  const invoice = useDocument(scope, id);
  const create = useCreateReturn(scope);
  const serverError = create.error as ApiError | null;

  const [qty, setQty] = useState<Record<string, number>>({});
  const [refund, setRefund] = useState('');
  const [notes, setNotes] = useState('');

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
    const q = Math.min(Math.max(0, qty[l.id] ?? 0), remaining);
    // Proportional share of the line's flat discount (the server settles the last piastre).
    const discount = l.quantity > 0 ? Math.round((l.discount * q) / l.quantity) : 0;
    const value = q * l.unitPrice - discount;
    const cost = q * l.unitCost;
    return { line: l, remaining, q, value, cost, profit: value - cost };
  });
  const nothingLeft = rows.every((r) => r.remaining === 0);

  const value = rows.reduce((s, r) => s + r.value, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const profit = value - cost;
  const invoiceTaxable = doc.subtotal - doc.discountTotal;
  const tax = invoiceTaxable > 0 ? Math.round((doc.taxTotal * value) / invoiceTaxable) : 0;
  const total = value + tax;
  const refundMinor = Math.min(Math.max(0, refund === '' ? 0 : toMinor(Number(refund) || 0)), total);
  const anyQty = rows.some((r) => r.q > 0);
  const canSave = anyQty && !create.isPending;

  function setAll(fill: boolean) {
    setQty(Object.fromEntries(rows.map((r) => [r.line.id, fill ? r.remaining : 0])));
  }

  async function save() {
    if (!doc) return;
    try {
      await create.mutateAsync({
        invoiceId: doc.id,
        input: {
          lines: rows.filter((r) => r.q > 0).map((r) => ({ lineId: r.line.id, quantity: r.q })),
          refundAmount: refundMinor,
          notes: notes.trim() || undefined,
        },
      });
      navigate(`${backTo}?tab=returns`);
    } catch {
      /* surfaced via serverError */
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={title} action={back} />

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(300px,360px)]">
        {/* Left: invoice + quantities */}
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
              <div>
                <p className="text-xs text-muted">{t('return.against')}</p>
                <p className="font-semibold tnum">{doc.number}</p>
                <p className="text-xs text-muted tnum">{formatDate(doc.issueDate, locale)}</p>
              </div>
              <div className="text-end">
                <p className="text-xs text-muted">{isSale ? t('sales.customer') : t('invoice.supplier')}</p>
                <p className="font-medium">{doc.partyName}</p>
              </div>
            </div>
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
                          {t('return.onInvoice')}: {formatNumber(r.line.quantity, locale)} ·{' '}
                          {t('return.alreadyReturned')}: {formatNumber(r.line.returnedQuantity, locale)} ·{' '}
                          {t('return.remaining')}: {formatNumber(r.remaining, locale)}
                        </p>
                        <p className="text-xs text-muted tnum">
                          {isSale ? t('invoice.price') : t('invoice.receiveCost')}{' '}
                          {formatMoney(r.line.unitPrice, currency, locale)}
                        </p>
                      </div>
                      <label className="block w-28">
                        <span className="mb-0.5 block text-xs text-muted">{t('return.qty')}</span>
                        <input
                          type="number"
                          min={0}
                          max={r.remaining}
                          disabled={r.remaining === 0}
                          className={`${field} tnum`}
                          value={r.q}
                          onChange={(e) =>
                            setQty((prev) => ({
                              ...prev,
                              [r.line.id]: Math.min(r.remaining, Math.max(0, Math.floor(Number(e.target.value) || 0))),
                            }))
                          }
                        />
                      </label>
                    </div>
                    {r.q > 0 && (
                      <p className="mt-2 text-xs tnum">
                        {t('return.value')}: <span className="font-medium">{formatMoney(r.value, currency, locale)}</span>
                        {isSale && (
                          <>
                            {' · '}
                            {t('return.profitReversed')}:{' '}
                            <span className="font-medium text-warning">{formatMoney(r.profit, currency, locale)}</span>
                          </>
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!isSale && !nothingLeft && (
              <p className="mt-3 text-xs text-faint">{t('return.stockHint')}</p>
            )}
          </Card>
        </div>

        {/* Right: summary */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              {t('common.total')}
            </h2>
            <dl className="space-y-1.5 text-sm">
              <Row label={t('return.value')} value={formatMoney(value, currency, locale)} />
              <Row label={t('invoice.tax')} value={formatMoney(tax, currency, locale)} />
              <div className="my-1 border-t border-line" />
              <Row label={t('invoice.grandTotal')} value={formatMoney(total, currency, locale)} strong />
              <div className="my-1 border-t border-line" />
              <Row
                label={isSale ? t('return.costBack') : t('return.costOut')}
                value={formatMoney(cost, currency, locale)}
              />
              {isSale && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted">{t('return.profitReversed')}</dt>
                  <dd className="font-semibold tnum text-warning">{formatMoney(profit, currency, locale)}</dd>
                </div>
              )}
            </dl>

            <div className="mt-3 space-y-2">
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
              <p className="text-xs text-faint">{isSale ? t('return.creditHint') : t('return.debitHint')}</p>
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

            <Button className="mt-4 w-full" icon="check" loading={create.isPending} disabled={!canSave} onClick={save}>
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
