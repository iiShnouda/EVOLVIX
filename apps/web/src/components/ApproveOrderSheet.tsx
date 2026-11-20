import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, toMinor, type SalesDocument } from '@skb/shared';
import { Sheet } from './Sheet';
import { Button } from './ui';
import { MoneyAccountPicker } from './MoneyAccountPicker';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import {
  AdjustEditor,
  adjustPayload,
  adjustPreview,
  badPercent,
  boxesChanged,
  boxesOf,
  mayAdjust,
  useAdjustRights,
  type AdjustBoxes,
} from './AdjustEditor';
import { IncreaseDetails, IncreasesToggle, useIncreaseView } from './Increases';
import { errorText } from '../lib/errors';
import { useApproveOrder } from '../lib/queries';
import { useAuth } from '../stores/auth';
import { CodeName } from './CodeName';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/**
 * The accountant approves a pending invoice: the items, prices, department and rep stay as the
 * sales person entered them; the discounts there are may change in place (each box with the
 * accountant's own permission, within his limit — the server checks; there is no second discount); the customer pays what they pay now and the rest stays on their
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
  // The discounts it has, filled in (owner, 2026-11-20): the accountant changes them in place, each
  // box with its permission, within his limit (the server checks).
  const rights = useAdjustRights();
  // The increases and who gave them, behind the eye (owner, 2026-11-20).
  const increases = useIncreaseView();
  const [boxes, setBoxes] = useState<AdjustBoxes>(() => boxesOf(order));
  const money = (v: number) => formatMoney(v, order.currency, locale);
  const [paid, setPaid] = useState('');
  const [account, setAccount] = useState('');
  const [override, setOverride] = useState(false);
  const [done, setDone] = useState<SalesDocument | null>(null);

  const preview = adjustPreview(order, boxes);
  const changed = boxesChanged(order, boxes);
  const badPct = badPercent(boxes);
  const total = preview.total;
  const paidAmount = paid === '' ? 0 : toMinor(Number(paid));
  const valid = paidAmount >= 0 && paidAmount <= total && !badPct && !preview.tooBig;

  async function save() {
    try {
      const invoice = await approve.mutateAsync({
        id: order.id,
        input: {
          paidAmount,
          paidAccountId: paidAmount > 0 && account ? account : undefined,
          ...(changed ? adjustPayload(order, boxes) : {}),
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
      <Sheet
        title={t('order.approved')}
        onClose={() => onDone(done)}
        closeLabel={t('common.close')}
      >
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium tnum">{done.number}</span> · {done.partyName} ·{' '}
            <span className="font-semibold tnum">{money(done.grandTotal)}</span>
          </p>
          <p className="text-sm text-muted">
            {t('account.paid')}: <span className="tnum">{money(done.paidAmount)}</span> ·{' '}
            {t('account.left')}: <span className="font-medium text-fg tnum">{money(left)}</span>
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {left > 0 && can('notes:receive') && done.partyId && (
              <Button
                variant="secondary"
                onClick={() =>
                  navigate(`/notes?receiveFor=${done.partyId}&invoice=${done.id}&amount=${left}`)
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
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted">
            <CodeName code={order.partyCode} name={order.partyName} />
            {order.departmentName && <> · {order.departmentName}</>} · {order.staffName}
          </p>
          {increases.may && <IncreasesToggle on={increases.shown} onChange={increases.setShown} />}
        </div>
        {increases.shown && <IncreaseDetails doc={order} />}

        <AdjustEditor
          doc={order}
          value={boxes}
          onChange={setBoxes}
          rights={rights}
          showIncreases={increases.shown}
        />
        {mayAdjust(rights) && maxDiscount !== null && (
          <p className="text-xs text-faint">
            {t('invoice.discountLimit')}: <span className="tnum">{maxDiscount}%</span>
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
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
        {preview.tooBig && <p className="text-sm text-destructive">{t('charge.tooBig')}</p>}
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
