import { useState } from 'react';
import { formatMoney, type SalesDocument } from '@skb/shared';
import { Sheet } from './Sheet';
import { Button } from './ui';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { useUpdateOrder } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/**
 * Change a pending invoice before the accountant approves it: quantities, removing items, the note.
 * It keeps its number and date and is checked again like a new one (prices, discounts, stock).
 * To add items, it is cancelled and made again.
 */
export function EditOrderSheet({
  order,
  onClose,
  onDone,
}: {
  order: SalesDocument;
  onClose: () => void;
  onDone: (order: SalesDocument) => void;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const update = useUpdateOrder();
  const money = (v: number) => formatMoney(v, order.currency, locale);
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.lines.map((l) => [l.id, String(l.unitQuantity || l.quantity)])),
  );
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState(order.notes ?? '');

  const kept = order.lines.filter((l) => !removed.has(l.id));
  const quantityOf = (id: string) => Math.floor(Number(qty[id]));
  const valid = kept.length > 0 && kept.every((l) => quantityOf(l.id) >= 1);

  async function save() {
    try {
      const saved = await update.mutateAsync({
        id: order.id,
        input: {
          partyId: order.partyId,
          lines: kept.map((l) => {
            const was = l.unitQuantity || l.quantity;
            const now = quantityOf(l.id);
            return {
              productId: l.productId,
              unitId: l.unitId ?? undefined,
              quantity: now,
              unitPrice: l.unitPrice,
              // A line's discount follows its quantity.
              discount: was ? Math.round((l.discount * now) / was) : 0,
              warehouseId: l.warehouseId ?? undefined,
              isBonus: l.isBonus || undefined,
            };
          }),
          charges: order.charges.map((c) =>
            c.rate != null
              ? { kind: c.kind, percent: c.rate, label: c.label ?? undefined }
              : { kind: c.kind, amount: c.fixedAmount ?? c.amount, label: c.label ?? undefined },
          ),
          paidAmount: 0,
          overrideFloor: false,
          notes: notes.trim() || undefined,
          priceLevelId:
            can('sales:choose_price_level') && order.priceLevelId ? order.priceLevelId : undefined,
          repId: order.repId ?? undefined,
          departmentId: order.departmentId ?? undefined,
          deliveryMethod: order.deliveryMethod,
          deliveryAddress: order.deliveryAddress ?? undefined,
          driverId: order.driverId ?? undefined,
          carrierId: order.carrierId ?? undefined,
        },
      });
      onDone(saved);
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet
      title={`${t('order.editTitle')} — ${order.number}`}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">{order.partyName}</p>
        <ul className="divide-y divide-[var(--c-line)] rounded-[var(--radius-app)] border border-line">
          {order.lines.map((l) => {
            const gone = removed.has(l.id);
            return (
              <li
                key={l.id}
                className={`flex items-center gap-2 p-2 text-sm ${gone ? 'opacity-50' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${gone ? 'line-through' : ''}`}>
                    {l.productName}
                  </span>
                  <span className="text-xs text-muted tnum">
                    {money(l.unitPrice)} / {l.unitName}
                  </span>
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  aria-label={t('invoice.qty')}
                  disabled={gone}
                  className="h-8 w-20 rounded-lg border border-line bg-surface px-2 text-sm tnum outline-none focus:border-brand"
                  value={qty[l.id] ?? ''}
                  onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setRemoved((s) => {
                      const next = new Set(s);
                      if (next.has(l.id)) next.delete(l.id);
                      else next.add(l.id);
                      return next;
                    })
                  }
                >
                  {gone ? t('common.cancel') : t('order.remove')}
                </Button>
              </li>
            );
          })}
        </ul>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('invoice.notes')}</span>
          <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {update.error && <p className="text-sm text-destructive">{errorText(t, update.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon="check"
            loading={update.isPending}
            disabled={!valid}
            onClick={() => void save()}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
