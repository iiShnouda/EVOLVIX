import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  formatMoney,
  formatNumber,
  formatQuantity,
  type InventoryItem,
  companyToday,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { WarehouseSelect } from '../components/WarehouseSelect';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useDeviceInfo } from '../lib/device';
import { useInventory, useValuation } from '../lib/queries';

const field =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

const today = companyToday;

type Tab = 'items' | 'valuation';

/**
 * Inventory (المخزون): every item with stock, average cost, value and reorder status,
 * plus stock valuation at any date — for all warehouses or one. `?low=1` opens the reorder
 * list; `?tab=valuation` the valuation; `?wh=<id>` limits both to one warehouse.
 */
export function InventoryPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const canEdit = can('inventory:edit');
  // Average cost, stock value and the valuation are the owner's unless given (costs:view).
  const seeCosts = can('costs:view');
  const tab: Tab = seeCosts && params.get('tab') === 'valuation' ? 'valuation' : 'items';
  const lowOnly = params.get('low') === '1';
  const warehouseId = params.get('wh') ?? '';

  const [search, setSearch] = useState('');
  const list = useInventory({
    search: search.trim() || undefined,
    lowOnly,
    warehouseId: warehouseId || undefined,
  });
  const currency = list.data?.currency ?? 'EGP';

  /** Change some URL params, keeping the rest (tab, low-stock filter, warehouse). */
  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  }
  const setTab = (next: Tab) =>
    update({ tab: next === 'valuation' ? 'valuation' : null, low: null });
  const setLowOnly = (on: boolean) => update({ low: on ? '1' : null });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('inventory.title')}
        action={
          <div className="flex flex-wrap gap-2">
            {can('products:create') && (
              <Button size="sm" icon="plus" onClick={() => navigate('/inventory/products/new')}>
                {t('catalog.newItem')}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => navigate('/inventory/models')}>
              {t('catalog.models')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="settings"
              onClick={() => navigate('/inventory/setup')}
            >
              {t('catalog.setup')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navigate('/inventory/price-lists')}>
              {t('pl.short')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="returns"
              onClick={() => navigate('/inventory/transfers')}
            >
              {t('transfer.title')}
            </Button>
            {canEdit && (
              <Button size="sm" icon="check" onClick={() => navigate('/inventory/stocktake')}>
                {t('stocktake.action')}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {seeCosts && (
          <Kpi
            label={t('inventory.stockValue')}
            value={formatMoney(list.data?.totalValue ?? 0, currency, locale)}
          />
        )}
        <Kpi
          label={t('inventory.itemCount')}
          value={formatNumber(list.data?.totalItems ?? 0, locale)}
        />
        <button
          onClick={() => setLowOnly(!lowOnly)}
          className="col-span-2 text-start lg:col-span-1"
        >
          <Kpi
            label={t('inventory.lowStock')}
            value={formatNumber(list.data?.lowStockCount ?? 0, locale)}
            tone={(list.data?.lowStockCount ?? 0) > 0 ? 'warning' : undefined}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div
          role="tablist"
          className="inline-flex rounded-[var(--radius-app)] border border-line bg-surface p-1"
        >
          {(seeCosts ? (['items', 'valuation'] as const) : (['items'] as const)).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
                tab === k ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
              }`}
            >
              {t(k === 'items' ? 'inventory.items' : 'inventory.valuation')}
            </button>
          ))}
        </div>
        <WarehouseSelect
          className="w-full sm:w-64"
          value={warehouseId}
          onChange={(id) => update({ wh: id || null })}
          allowAll
          includeClosed
        />
      </div>

      {tab === 'items' ? (
        <ItemsTab
          items={list.data?.items ?? []}
          loading={list.isLoading}
          currency={currency}
          seeCosts={seeCosts}
          search={search}
          onSearch={setSearch}
          lowOnly={lowOnly}
          onLowOnly={setLowOnly}
          onOpen={(id) =>
            navigate(`/inventory/items/${id}${warehouseId ? `?wh=${warehouseId}` : ''}`)
          }
        />
      ) : (
        <ValuationTab warehouseId={warehouseId} />
      )}
    </div>
  );
}

function ItemsTab({
  items,
  loading,
  currency,
  seeCosts,
  search,
  onSearch,
  lowOnly,
  onLowOnly,
  onOpen,
}: {
  items: InventoryItem[];
  loading: boolean;
  currency: string;
  seeCosts: boolean;
  search: string;
  onSearch: (v: string) => void;
  lowOnly: boolean;
  onLowOnly: (v: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const { t, locale } = useT();
  const { deviceClass } = useDeviceInfo();
  const isPhone = deviceClass === 'phone';

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute inset-y-0 start-2.5 grid place-items-center text-faint">
            <Icon name="search" size={16} />
          </span>
          <input
            className={`${field} w-full ps-8`}
            placeholder={t('inventory.search')}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={lowOnly} onChange={(e) => onLowOnly(e.target.checked)} />
          {t('inventory.lowOnly')}
        </label>
      </div>

      {loading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t('common.empty')} icon="inventory" />
      ) : isPhone ? (
        <ul className="divide-y divide-[var(--c-line)]">
          {items.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onOpen(p.id)}
                className="flex w-full items-center gap-3 p-4 text-start hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-xs text-muted tnum">
                    {p.sku}
                    {seeCosts &&
                      ` · ${t('inventory.avgCost')} ${formatMoney(p.avgCost, currency, locale)}`}
                  </span>
                </span>
                <span className="text-end">
                  <span className="block text-sm font-semibold tnum">
                    {formatQuantity(p.stockOnHand, p.units, locale)}
                  </span>
                  <StockBadge item={p} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2 text-xs text-muted">
            <tr>
              <th className="p-3 text-start font-medium">{t('inventory.sku')}</th>
              <th className="p-3 text-start font-medium">{t('inventory.products')}</th>
              <th className="hidden p-3 text-start font-medium xl:table-cell">
                {t('inventory.category')}
              </th>
              <th className="p-3 text-end font-medium">{t('inventory.stock')}</th>
              <th className="hidden p-3 text-end font-medium md:table-cell">
                {t('inventory.reorder')}
              </th>
              {seeCosts && (
                <>
                  <th className="hidden p-3 text-end font-medium md:table-cell">
                    {t('inventory.avgCost')}
                  </th>
                  <th className="p-3 text-end font-medium">{t('inventory.value')}</th>
                </>
              )}
              <th className="p-3 text-start font-medium">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--c-line)]">
            {items.map((p) => (
              <tr
                key={p.id}
                onClick={() => onOpen(p.id)}
                className="cursor-pointer transition-colors hover:bg-surface-2"
              >
                <td className="p-3 text-muted tnum">{p.sku}</td>
                <td className="p-3 font-medium">{p.name}</td>
                <td className="hidden p-3 text-muted xl:table-cell">{p.categoryName}</td>
                <td className="p-3 text-end font-semibold tnum">
                  {formatNumber(p.stockOnHand, locale)}{' '}
                  <span className="text-xs font-normal text-muted">{p.unit}</span>
                  {p.units.length > 1 && p.stockOnHand > 0 && (
                    <span className="block text-xs font-normal text-muted">
                      {formatQuantity(p.stockOnHand, p.units, locale)}
                    </span>
                  )}
                </td>
                <td className="hidden p-3 text-end text-muted tnum md:table-cell">
                  {formatNumber(p.reorderLevel, locale)}
                </td>
                {seeCosts && (
                  <>
                    <td className="hidden p-3 text-end tnum md:table-cell">
                      {formatMoney(p.avgCost, currency, locale)}
                    </td>
                    <td className="p-3 text-end tnum">
                      {formatMoney(p.stockValue, currency, locale)}
                    </td>
                  </>
                )}
                <td className="p-3">
                  <StockBadge item={p} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ValuationTab({ warehouseId }: { warehouseId: string }) {
  const { t, locale } = useT();
  const [asOf, setAsOf] = useState(today());
  const valuation = useValuation(asOf, warehouseId || undefined);
  const data = valuation.data;
  const currency = data?.currency ?? 'EGP';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('inventory.asOf')}</span>
            <input
              type="date"
              className={field}
              value={asOf}
              max={today()}
              onChange={(e) => setAsOf(e.target.value || today())}
            />
          </label>
          <div className="text-end">
            <p className="text-xs text-muted">{t('inventory.stockValue')}</p>
            <p className="text-lg font-semibold tnum">
              {formatMoney(data?.value ?? 0, currency, locale)}
            </p>
            <p className="text-xs text-muted tnum">
              {formatNumber(data?.quantity ?? 0, locale)} {t('inventory.qty')}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs text-faint">{t('inventory.valuationHint')}</p>
      </Card>

      {valuation.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('common.empty')} icon="inventory" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.models.length > 0 && (
            <ValuationTable
              title={t('inventory.byModel')}
              rows={data.models}
              currency={currency}
              locale={locale}
            />
          )}
          {!warehouseId && data.warehouses.length > 1 && (
            <ValuationTable
              title={t('warehouse.byWarehouse')}
              rows={data.warehouses}
              currency={currency}
              locale={locale}
            />
          )}
          <ValuationTable
            title={t('inventory.byCategory')}
            rows={data.categories}
            currency={currency}
            locale={locale}
          />
          <ValuationTable
            title={t('inventory.byItem')}
            rows={data.items}
            currency={currency}
            locale={locale}
          />
        </div>
      )}
    </div>
  );
}

function ValuationTable({
  title,
  rows,
  currency,
  locale,
}: {
  title: string;
  rows: { key: string; label: string; quantity: number; value: number }[];
  currency: string;
  locale: 'en' | 'ar';
}) {
  const { t } = useT();
  return (
    <Card padded={false} className="h-fit overflow-hidden">
      <h2 className="border-b border-line p-3 text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>
            <th className="p-3 text-start font-medium">{title}</th>
            <th className="p-3 text-end font-medium">{t('inventory.qty')}</th>
            <th className="p-3 text-end font-medium">{t('inventory.value')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--c-line)]">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="p-3">{r.label}</td>
              <td className="p-3 text-end tnum">{formatNumber(r.quantity, locale)}</td>
              <td className="p-3 text-end font-medium tnum">
                {formatMoney(r.value, currency, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function StockBadge({ item }: { item: InventoryItem }) {
  const { t } = useT();
  return item.isLow ? (
    <Badge tone="warning">{t('inventory.lowStock')}</Badge>
  ) : (
    <Badge tone="positive">{t('inventory.ok')}</Badge>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <Card>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold tnum ${tone === 'warning' ? 'text-warning' : ''}`}>
        {value}
      </p>
    </Card>
  );
}
