import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, toMajor, toMinor, type SalesDocument } from '@skb/shared';
import { Sheet } from './Sheet';
import { Button } from './ui';
import { MoneyAccountPicker } from './MoneyAccountPicker';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { useApproveOrder } from '../lib/queries';
import { useAuth } from '../stores/auth';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

type Mode = 'percent' | 'piece' | 'amount';

/** A line's discount in minor units from what was typed: a %, so much per piece, or an amount. */
function discountOf(mode: Mode, value: string, gross: number, pieces: number) {
  const v = Number(value);
  if (!value.trim() || !Number.isFinite(v) || v <= 0) return 0;
  const d =
    mode === 'percent'
      ? Math.round((gross * Math.min(v, 100)) / 100)
      : mode === 'piece'
        ? toMinor(v) * pieces
        : toMinor(v);
  return Math.min(d, gross);
}

/**
 * The accountant approves a pending invoice: the items, prices, department and rep stay as the
 * sales person entered them; the discounts may change (within the accountant's own permission and
 * limit — the server checks); the customer pays what they pay now and the rest stays on their
 * account. A cheque or promissory note is then taken against the invoice from Cheques & notes.
 */
export function ApproveOrderSheet({
  order,
  onClose,
  onDone,
}: {
  order: SalesDocument;
  onClose: () => void;
  onDone: (invoice: SalesDocument) => void;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const approve = useApproveOrder();
  const maxDiscount = useAuth((s) => s.user?.maxDiscountPercent ?? null);
  const canDiscount = can('sales:discount');
  const money = (v: number) => formatMoney(v, order.currency, locale);

  const lines = order.lines.filter((l) => !l.isBonus);
  const [edits, setEdits] = useState<Record<string, { mode: Mode; value: string }>>({});
  const invoiceRate = order.charges.find((c) => c.kind === 'DISCOUNT')?.rate ?? null;
  const [invoicePct, setInvoicePct] = useState(invoiceRate != null ? String(invoiceRate) : '');
  const [paid, setPaid] = useState('');
  const [account, setAccount] = useState('');
  const [override, setOverride] = useState(false);
  const [done, setDone] = useState<SalesDocument | null>(null);

  const grossOf = (l: (typeof lines)[number]) => l.unitPrice * (l.unitQuantity || l.quantity);
  const newDiscount = (l: (typeof lines)[number]) => {
    const e = edits[l.id];
    return e ? discountOf(e.mode, e.value, grossOf(l), l.quantity) : l.discount;
  };
  const changedLines = lines.filter((l) => edits[l.id] && newDiscount(l) !== l.discount);
  const invoiceChanged = (invoicePct.trim() === '' ? null : Number(invoicePct)) !== invoiceRate;
  const badPct =
    invoicePct.trim() !== '' &&
    !(Number.isFinite(Number(invoicePct)) && Number(invoicePct) >= 0 && Number(invoicePct) <= 100);

  // An estimate of the new total; the server works out the exact one.
  const net = lines.reduce((s, l) => s + grossOf(l) - newDiscount(l), 0);
  const invoiceOff = Math.round((net * (Number(invoicePct) || 0)) / 100);
  const others = order.charges
    .filter((c) => c.kind !== 'DISCOUNT' && c.kind !== 'EXTRA_DISCOUNT')
    .reduce((s, c) => s + c.amount, 0);
  const extra = order.charges.find((c) => c.kind === 'EXTRA_DISCOUNT')?.amount ?? 0;
  const total = net - invoiceOff - extra + others;
  const paidAmount = paid === '' ? 0 : toMinor(Number(paid));
  const valid = paidAmount >= 0 && paidAmount <= total && !badPct;

  async function save() {
    try {
      const invoice = await approve.mutateAsync({
        id: order.id,
        input: {
          paidAmount,
          paidAccountId: paidAmount > 0 && account ? account : undefined,
          lineDiscounts: changedLines.length
            ? changedLines.map((l) => ({ lineId: l.id, discount: newDiscount(l) }))
            : undefined,
          charges: invoiceChanged
            ? [
                ...(Number(invoicePct) > 0
                  ? [{ kind: 'DISCOUNT' as const, percent: Number(invoicePct) }]
                  : []),
                ...order.charges
                  .filter((c) => c.kind === 'EXTRA_DISCOUNT')
                  .map((c) =>
                    c.rate != null
                      ? { kind: c.kind, percent: c.rate }
                      : { kind: c.kind, amount: c.fixedAmount ?? c.amount },
                  ),
              ]
            : undefined,
          overrideFloor: override || undefined,
        },
      });
      setDone(invoice);
    } catch {
      /* shown below */
    }
  }

  if (done) {
    const left = done.grandTotal - done.paidAmount;
    return (
      <Sheet title={t('order.approved')} onClose={() => onDone(done)} closeLabel={t('common.close')}>
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium tnum">{done.number}</span> · {done.partyName} ·{' '}
            <span className="font-semibold tnum">{money(done.grandTotal)}</span>
          </p>
          <p className="text-sm text-muted">
            {t('account.paid')}: <span className="tnum">{money(done.paidAmount)}</span> ·{' '}
            {t('account.left')}: <span className="font-medium text-fg tnum">{money(left)}</span>
          </p>
          {left > 0 && <p className="text-xs text-faint">{t('order.payNoteHint')}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {left > 0 && can('notes:receive') && done.partyId && (
              <Button
                variant="secondary"
                onClick={() =>
                  navigate(
                    `/notes?receiveFor=${done.partyId}&invoice=${done.id}&amount=${left}`,
                  )
                }
              >
                {t('order.receiveNote')}
              </Button>
            )}
            <Button icon="check" onClick={() => onDone(done)}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={`${t('order.approveTitle')} — ${order.number}`}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {order.partyName}
          {order.departmentName && <> · {order.departmentName}</>} · {order.staffName}
        </p>
        <p className="text-xs text-faint">{t('order.approveHint')}</p>

        <div className="overflow-x-auto rounded-[var(--radius-app)] border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="p-2 text-start font-medium">{t('analytics.item')}</th>
                <th className="p-2 text-end font-medium">{t('invoice.qty')}</th>
                <th className="p-2 text-end font-medium">{t('invoice.price')}</th>
                <th className="p-2 text-start font-medium">{t('order.lineDiscount')}</th>
                <th className="p-2 text-end font-medium">{t('common.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {lines.map((l) => {
                const e = edits[l.id];
                const d = newDiscount(l);
                return (
                  <tr key={l.id}>
                    <td className="p-2">{l.productName}</td>
                    <td className="p-2 text-end tnum">
                      {l.unitQuantity || l.quantity} {l.unitName}
                    </td>
                    <td className="p-2 text-end tnum">{money(l.unitPrice)}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          aria-label={t('order.lineDiscount')}
                          disabled={!canDiscount}
                          className="h-8 w-20 rounded-lg border border-line bg-surface px-2 text-sm tnum outline-none focus:border-brand"
                          placeholder={l.discount ? String(toMajor(l.discount)) : '0'}
                          value={e?.value ?? ''}
                          onChange={(ev) =>
                            setEdits((s) => ({
                              ...s,
                              [l.id]: { mode: e?.mode ?? 'amount', value: ev.target.value },
                            }))
                          }
                        />
                        <select
                          aria-label={t('invoice.lineDiscountMode')}
                          disabled={!canDiscount}
                          className="h-8 rounded-lg border border-line bg-surface px-1 text-xs outline-none focus:border-brand"
                          value={e?.mode ?? 'amount'}
                          onChange={(ev) =>
                            setEdits((s) => ({
                              ...s,
                              [l.id]: { mode: ev.target.value as Mode, value: e?.value ?? '' },
                            }))
                          }
                        >
                          <option value="percent">%</option>
                          <option value="piece">{t('invoice.perPiece')}</option>
                          <option value="amount">{t('invoice.onLine')}</option>
                        </select>
                        {d > 0 && <span className="text-xs text-muted tnum">−{money(d)}</span>}
                      </div>
                    </td>
                    <td className="p-2 text-end tnum">{money(grossOf(l) - d)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('order.invoiceDiscount')}</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              disabled={!canDiscount}
              className={`${field} tnum`}
              value={invoicePct}
              onChange={(e) => setInvoicePct(e.target.value)}
            />
            {canDiscount && maxDiscount !== null && (
              <span className="mt-0.5 block text-xs text-faint">
                {t('invoice.discountLimit')}: <span className="tnum">{maxDiscount}%</span>
              </span>
            )}
          </label>
          <div className="rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">{t('order.newTotal')}</span>
              <span className="font-semibold tnum">{money(total)}</span>
            </div>
            {total !== order.grandTotal && (
              <div className="flex justify-between text-xs text-faint">
                <span>{t('doc.SALES_ORDER')}</span>
                <span className="tnum line-through">{money(order.grandTotal)}</span>
              </div>
            )}
          </div>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('invoice.paidNow')}</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className={`${field} tnum`}
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
            />
          </label>
          {paidAmount > 0 && (
            <MoneyAccountPicker
              className={field}
              label={t('money.receivedInto')}
              value={account}
              onChange={setAccount}
            />
          )}
        </div>
        {paidAmount < total && <p className="text-xs text-faint">{t('order.payNoteHint')}</p>}
        {can('sales:override_floor') && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            {t('invoice.overrideFloor')}
          </label>
        )}
        {badPct && <p className="text-sm text-destructive">{t('error.bad_percent')}</p>}
        {approve.error && <p className="text-sm text-destructive">{errorText(t, approve.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon="check"
            loading={approve.isPending}
            disabled={!valid}
            onClick={() => void save()}
          >
            {t('order.approve')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
