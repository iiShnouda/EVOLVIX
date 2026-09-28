import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, formatNumber, type InventoryItem } from '@skb/shared';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { WarehouseSelect, useDefaultWarehouseId } from '../components/WarehouseSelect';
import { useT } from '../lib/i18n';
import { ApiError } from '../lib/api';
import {
  useCompanySettings,
  useCreateTransfer,
  useInventory,
  useTransferDestinations,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

interface Line {
  item: InventoryItem;
  quantity: number;
}

/**
 * New transfer permit (إذن تحويل): pick the sending warehouse (one the user may use) and the
 * destination (any open store, any branch), then the items and quantities — never more than the
 * sending warehouse holds.
 */
export function TransferBuilderPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const settings = useCompanySettings();
  const currency = settings.data?.currency ?? 'EGP';
  const requireReceipt = settings.data?.transfersRequireReceipt ?? true;

  const defaultWarehouse = useDefaultWarehouseId();
  const [pickedFrom, setPickedFrom] = useState('');
  const fromId = pickedFrom || defaultWarehouse;
  const [toId, setToId] = useState('');
  const destinations = (useTransferDestinations().data ?? []).filter((w) => w.id !== fromId);

  const stock = useInventory({ warehouseId: fromId || undefined });
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');
  const create = useCreateTransfer();
  const error = create.error as ApiError | null;

  const s = search.trim().toLowerCase();
  const matches = s
    ? (stock.data?.items ?? [])
        .filter(
          (i) =>
            i.stockOnHand > 0 &&
            (i.name.toLowerCase().includes(s) || i.sku.toLowerCase().includes(s)),
        )
        .slice(0, 30)
    : [];

  function changeFrom(id: string) {
    // Availability belongs to the sending warehouse: switching it starts a fresh list.
    setPickedFrom(id);
    setLines([]);
    if (id === toId) setToId('');
  }
  function add(item: InventoryItem) {
    setLines((prev) =>
      prev.some((l) => l.item.id === item.id)
        ? prev.map((l) =>
            l.item.id === item.id
              ? { ...l, quantity: Math.min(item.stockOnHand, l.quantity + 1) }
              : l,
          )
        : [...prev, { item, quantity: 1 }],
    );
    setSearch('');
  }
  const setQty = (id: string, qty: number) =>
    setLines((prev) => prev.map((l) => (l.item.id === id ? { ...l, quantity: qty } : l)));
  const remove = (id: string) => setLines((prev) => prev.filter((l) => l.item.id !== id));

  const overStock = lines.some((l) => l.quantity > l.item.stockOnHand);
  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);
  const totalValue = lines.reduce((sum, l) => sum + l.quantity * l.item.avgCost, 0);
  const canSend =
    !!fromId && !!toId && lines.length > 0 && !overStock && lines.every((l) => l.quantity > 0);

  async function send() {
    try {
      const res = await create.mutateAsync({
        fromWarehouseId: fromId,
        toWarehouseId: toId,
        lines: lines.map((l) => ({ productId: l.item.id, quantity: l.quantity })),
        notes: notes.trim() || undefined,
      });
      navigate(`/inventory/transfers?tab=all&doc=${res.id}`);
    } catch {
      /* shown below */
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('transfer.new')}
        subtitle={t(requireReceipt ? 'transfer.hint' : 'transfer.hintInstant')}
        action={
          <Button
            variant="ghost"
            size="sm"
            icon="close"
            onClick={() => navigate('/inventory/transfers')}
          >
            {t('transfer.back')}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,340px)]">
        <div className="space-y-4">
          <Card className="grid gap-3 sm:grid-cols-2">
            <WarehouseSelect label={t('transfer.from')} value={fromId} onChange={changeFrom} />
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('transfer.to')}</span>
              <select className={field} value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="">{t('transfer.pickDestination')}</option>
                {destinations.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {w.branchName}
                  </option>
                ))}
              </select>
            </label>
          </Card>

          <Card>
            <label className="mb-1.5 block text-sm font-medium text-muted">
              {t('invoice.addItems')}
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-2.5 grid place-items-center text-faint">
                <Icon name="search" size={16} />
              </span>
              <input
                className={`${field} ps-8`}
                placeholder={t('inventory.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {s && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-card)]">
                  {stock.isLoading ? (
                    <div className="grid place-items-center py-6 text-muted">
                      <Spinner size={18} />
                    </div>
                  ) : matches.length === 0 ? (
                    <p className="p-3 text-sm text-muted">{t('common.empty')}</p>
                  ) : (
                    matches.map((i) => (
                      <button
                        key={i.id}
                        onClick={() => add(i)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{i.name}</span>
                          <span className="text-xs text-muted tnum">
                            {i.sku} · {t('transfer.available')}:{' '}
                            {formatNumber(i.stockOnHand, locale)} {i.unit}
                          </span>
                        </span>
                        <Icon name="plus" size={16} className="text-brand" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {lines.length === 0 ? (
              <p className="mt-4 rounded-[var(--radius-app)] bg-surface-2 p-4 text-center text-sm text-muted">
                {t('invoice.noItems')}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {lines.map((l) => {
                  const over = l.quantity > l.item.stockOnHand;
                  return (
                    <li
                      key={l.item.id}
                      className="flex flex-wrap items-center gap-3 rounded-[var(--radius-app)] border border-line p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.item.name}</p>
                        <p className={`text-xs tnum ${over ? 'text-destructive' : 'text-muted'}`}>
                          {t('transfer.available')}: {formatNumber(l.item.stockOnHand, locale)}{' '}
                          {l.item.unit}
                        </p>
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={l.item.stockOnHand}
                        aria-label={t('inventory.qty')}
                        className={`${field} !w-24 tnum ${over ? 'border-destructive' : ''}`}
                        value={l.quantity}
                        onChange={(e) =>
                          setQty(l.item.id, Math.max(0, Math.floor(Number(e.target.value) || 0)))
                        }
                      />
                      <button
                        onClick={() => remove(l.item.id)}
                        className="text-faint hover:text-destructive"
                        aria-label={t('invoice.remove')}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <Card>
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted">{t('inventory.qty')}</dt>
                <dd className="tnum">{formatNumber(totalQty, locale)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted">{t('inventory.value')}</dt>
                <dd className="font-semibold tnum">{formatMoney(totalValue, currency, locale)}</dd>
              </div>
            </dl>
            <label className="mt-3 block">
              <span className="mb-0.5 block text-xs text-muted">{t('invoice.notes')}</span>
              <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {error && (
              <p className="mt-3 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
                {error.message}
              </p>
            )}
            <Button
              className="mt-4 w-full"
              icon="check"
              loading={create.isPending}
              disabled={!canSend}
              onClick={send}
            >
              {create.isPending ? t('transfer.sending') : t('transfer.send')}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
