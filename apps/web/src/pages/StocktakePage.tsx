import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, formatNumber, type StocktakeResult } from '@skb/shared';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { WarehouseSelect, useDefaultWarehouseId } from '../components/WarehouseSelect';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ApiError } from '../lib/api';
import { useInventory, useStocktake } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/**
 * Stocktake (الجرد والتسويات) of one warehouse: enter the physically counted quantity for the
 * items that were counted. Each difference from that warehouse's books is posted as an adjustment
 * at the current average cost, all under one ADJ- reference. Items left blank are not touched.
 */
export function StocktakePage() {
  const { t, locale } = useT();
  // What a count gains or loses at cost is the owner's unless given (costs:view).
  const seeCosts = useCan()('costs:view');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const defaultWarehouse = useDefaultWarehouseId();
  const [picked, setPicked] = useState('');
  const warehouseId = picked || defaultWarehouse;
  const list = useInventory({ warehouseId: warehouseId || undefined });
  const stocktake = useStocktake();
  const error = stocktake.error as ApiError | null;

  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<StocktakeResult | null>(null);

  const currency = list.data?.currency ?? 'EGP';
  const all = list.data?.items ?? [];
  const s = search.trim().toLowerCase();
  const visible = s
    ? all.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
    : all;

  const lines = all
    .filter((p) => (counted[p.id] ?? '') !== '')
    .map((p) => {
      const qty = Math.max(0, Math.floor(Number(counted[p.id]) || 0));
      const diff = qty - p.stockOnHand;
      return { item: p, qty, diff, value: diff * p.avgCost };
    });
  const changed = lines.filter((l) => l.diff !== 0);
  const gain = changed.filter((l) => l.value > 0).reduce((sum, l) => sum + l.value, 0);
  const loss = changed.filter((l) => l.value < 0).reduce((sum, l) => sum + l.value, 0);

  async function post() {
    try {
      const res = await stocktake.mutateAsync({
        lines: changed.map((l) => ({ productId: l.item.id, countedQuantity: l.qty })),
        reason: reason.trim() || undefined,
        warehouseId: warehouseId || undefined,
      });
      setResult(res);
      setCounted({});
      setReason('');
    } catch {
      /* surfaced via error */
    }
  }

  const back = (
    <Button variant="ghost" size="sm" icon="close" onClick={() => navigate('/inventory')}>
      {t('itemCard.back')}
    </Button>
  );

  return (
    <div className="space-y-5">
      <PageHeader title={t('stocktake.title')} action={back} />

      {result && (
        <Card className="border-positive">
          <p className="text-sm font-semibold text-positive">
            {t('stocktake.posted')} · <span className="tnum">{result.reference}</span> ·{' '}
            {result.warehouseName}
          </p>
          <p className="mt-1 text-sm text-muted tnum">
            {t('stocktake.changedItems')}: {formatNumber(result.itemsChanged, locale)}
            {seeCosts &&
              ` · ${t('stocktake.valueImpact')} ${formatMoney(result.valueChange, currency, locale)}`}
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,340px)]">
        <Card padded={false} className="overflow-hidden">
          <div className="grid gap-3 border-b border-line p-3 sm:grid-cols-[minmax(180px,260px)_1fr] sm:items-end">
            <WarehouseSelect
              label={t('warehouse.counting')}
              value={warehouseId}
              onChange={(id) => {
                // Counts belong to one warehouse: switching starts a fresh count.
                setPicked(id);
                setCounted({});
                setResult(null);
              }}
            />
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
            </div>
          </div>
          {list.isLoading ? (
            <div className="grid place-items-center py-16 text-muted">
              <Spinner size={26} />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState title={t('common.empty')} icon="inventory" />
          ) : (
            <ul className="divide-y divide-[var(--c-line)]">
              {visible.map((p) => {
                const line = lines.find((l) => l.item.id === p.id);
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted tnum">
                        {p.sku} · {t('stocktake.system')}: {formatNumber(p.stockOnHand, locale)}{' '}
                        {p.unit}
                      </p>
                      {line && line.diff !== 0 && (
                        <p
                          className={`text-xs tnum ${line.diff > 0 ? 'text-positive' : 'text-warning'}`}
                        >
                          {t('stocktake.difference')}: {line.diff > 0 ? '+' : ''}
                          {formatNumber(line.diff, locale)}
                          {seeCosts && ` · ${formatMoney(line.value, currency, locale)}`}
                        </p>
                      )}
                    </div>
                    <label className="block w-28">
                      <span className="mb-0.5 block text-xs text-muted">
                        {t('stocktake.counted')}
                      </span>
                      <input
                        type="number"
                        min={0}
                        className={`${field} tnum`}
                        value={counted[p.id] ?? ''}
                        onChange={(e) =>
                          setCounted((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <Card>
            <dl className="space-y-1.5 text-sm">
              <Row
                label={t('stocktake.changedItems')}
                value={formatNumber(changed.length, locale)}
              />
              {seeCosts && (
                <>
                  <Row
                    label={t('stocktake.gain')}
                    value={formatMoney(gain, currency, locale)}
                    tone="positive"
                  />
                  <Row
                    label={t('stocktake.loss')}
                    value={formatMoney(loss, currency, locale)}
                    tone="warning"
                  />
                  <div className="my-1 border-t border-line" />
                  <Row
                    label={t('stocktake.valueImpact')}
                    value={formatMoney(gain + loss, currency, locale)}
                    strong
                  />
                </>
              )}
            </dl>
            <label className="mt-3 block">
              <span className="mb-0.5 block text-xs text-muted">{t('stocktake.reason')}</span>
              <input
                className={field}
                placeholder={t('stocktake.reasonHint')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {changed.length === 0 && (
              <p className="mt-3 text-xs text-muted">{t('stocktake.noChanges')}</p>
            )}
            {error && (
              <p className="mt-3 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
                {error.message}
              </p>
            )}
            <Button
              className="mt-4 w-full"
              icon="check"
              loading={stocktake.isPending}
              disabled={changed.length === 0}
              onClick={post}
            >
              {stocktake.isPending ? t('stocktake.saving') : t('stocktake.save')}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'positive' | 'warning';
}) {
  const color = tone === 'positive' ? 'text-positive' : tone === 'warning' ? 'text-warning' : '';
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`tnum ${strong ? 'font-semibold' : ''} ${color}`}>{value}</dd>
    </div>
  );
}
