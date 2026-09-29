import { useState } from 'react';
import { toMinor, formatMoney, type DeliveryMethod, type SalesDocument } from '@skb/shared';
import { Sheet } from './Sheet';
import { Button } from './ui';
import { WarehouseSelect } from './WarehouseSelect';
import { MoneyAccountPicker } from './MoneyAccountPicker';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { useConvertQuotation, useParties, useReps } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';
const METHODS: DeliveryMethod[] = ['PICKUP', 'OWN_DELIVERY', 'SHIPPING_COMPANY'];

/**
 * Turn a quotation into a sales invoice: its lines, prices and charges come from the quotation;
 * here go what's decided now — where the goods leave from, payment and delivery.
 */
export function ConvertQuoteSheet({
  quote,
  onClose,
  onDone,
}: {
  quote: SalesDocument;
  onClose: () => void;
  onDone: (invoice: SalesDocument) => void;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const convert = useConvertQuotation();
  const reps = useReps(true);
  const carriers = useParties({ page: 1, pageSize: 100, type: 'CARRIER', active: true });
  const [warehouse, setWarehouse] = useState('');
  const [paid, setPaid] = useState('');
  const [account, setAccount] = useState('');
  const [method, setMethod] = useState<DeliveryMethod>('PICKUP');
  const [address, setAddress] = useState('');
  const [driverId, setDriverId] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [override, setOverride] = useState(false);
  const paidAmount = paid === '' ? 0 : toMinor(Number(paid));
  const valid =
    paidAmount >= 0 &&
    paidAmount <= quote.grandTotal &&
    !(method === 'SHIPPING_COMPANY' && !carrierId);

  async function save() {
    try {
      const invoice = await convert.mutateAsync({
        id: quote.id,
        input: {
          warehouseId: warehouse || undefined,
          paidAmount,
          paidAccountId: paidAmount > 0 && account ? account : undefined,
          deliveryMethod: method,
          deliveryAddress: method !== 'PICKUP' && address.trim() ? address.trim() : undefined,
          driverId: method === 'OWN_DELIVERY' && driverId ? driverId : undefined,
          carrierId: method === 'SHIPPING_COMPANY' ? carrierId : undefined,
          overrideFloor: override || undefined,
        },
      });
      onDone(invoice);
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet
      title={`${t('quote.makeInvoice')} — ${quote.number}`}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {quote.partyName} ·{' '}
          <span className="font-medium text-fg tnum">
            {formatMoney(quote.grandTotal, quote.currency, locale)}
          </span>
        </p>
        <p className="text-xs text-faint">{t('quote.convertHint')}</p>
        <WarehouseSelect
          value={warehouse || quote.lines[0]?.warehouseId || ''}
          onChange={setWarehouse}
        />
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
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('delivery.method')}</span>
          <select
            className={field}
            value={method}
            onChange={(e) => setMethod(e.target.value as DeliveryMethod)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`delivery.${m}`)}
              </option>
            ))}
          </select>
        </label>
        {method !== 'PICKUP' && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('delivery.address')}</span>
            <input
              className={field}
              maxLength={300}
              placeholder={t('delivery.addressPlaceholder')}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
        )}
        {method === 'OWN_DELIVERY' && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('delivery.driver')}</span>
            <select
              className={field}
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              <option value="">{t('delivery.noDriver')}</option>
              {(reps.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {method === 'SHIPPING_COMPANY' && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('delivery.carrier')}</span>
            <select
              className={field}
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
            >
              <option value="">{t('delivery.pickCarrier')}</option>
              {(carriers.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
        {convert.error && <p className="text-sm text-destructive">{errorText(t, convert.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon="check"
            loading={convert.isPending}
            disabled={!valid}
            onClick={() => void save()}
          >
            {t('quote.makeInvoice')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
