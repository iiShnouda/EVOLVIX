import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  formatNumber,
  type DocumentType,
  type Permission,
  type StockMovement,
  type WarehouseStock,
  formatQuantity,
  addDays,
  companyToday,
} from '@skb/shared';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { WarehouseSelect, useDefaultWarehouseId } from '../components/WarehouseSelect';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useAuth } from '../stores/auth';

const NO_PERMISSIONS: Permission[] = [];
import { useDeviceInfo } from '../lib/device';
import { ApiError } from '../lib/api';
import { useItemCard, useStocktake } from '../lib/queries';
import { TableColumns } from '../components/TableColumns';
import { errorText } from '../lib/errors';

const field =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

const daysAgo = (n: number) => addDays(companyToday(), -n);

/** Where a movement's source document lives in the app, and who may open it. */
function documentLink(m: StockMovement): { to: string; permission: Permission } | null {
  if (!m.documentId || !m.documentType) return null;
  if (m.documentType === 'STOCK_TRANSFER')
    return { to: `/inventory/transfers?doc=${m.documentId}`, permission: 'inventory:view' };
  const type: DocumentType = m.documentType;
  const scope = type.startsWith('PURCHASE') ? 'purchases' : 'sales';
  const tab = type.endsWith('RETURN') ? 'tab=returns&' : '';
  return { to: `/${scope}?${tab}doc=${m.documentId}`, permission: `${scope}:view` as Permission };
}

/**
 * Item card (كارت الصنف): opening balance, every in/out movement in the period with its
 * running balance and cost, and the closing balance — for all warehouses or one (`?wh=<id>`).
 * Shows today's stock per warehouse. Inventory editors can post a quick adjustment (a one-item
 * stocktake of one warehouse) from here.
 */
export function ItemCardPage() {
  const { id = '' } = useParams();
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { deviceClass } = useDeviceInfo();
  const can = useCan();
  const permissions = useAuth((st) => st.user?.permissions ?? NO_PERMISSIONS);
  const canEdit = can('inventory:stocktake');
  const canEditItem = can('products:edit') || can('prices:edit');
  // Costs and stock values are the owner's unless given (costs:view); the server sends 0 otherwise.
  const seeCosts = can('costs:view');

  const [params, setParams] = useSearchParams();
  const warehouseId = params.get('wh') ?? '';
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(companyToday);
  const card = useItemCard(id, from, to, warehouseId || undefined);
  const data = card.data;
  const currency = data?.currency ?? 'EGP';
  const isPhone = deviceClass === 'phone';

  const back = (
    <Button
      variant="ghost"
      size="sm"
      icon="close"
      onClick={() => navigate(`/inventory${warehouseId ? `?wh=${warehouseId}` : ''}`)}
    >
      {t('itemCard.back')}
    </Button>
  );

  if (card.isLoading) {
    return (
      <div className="grid place-items-center py-24 text-muted">
        <Spinner size={26} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('itemCard.title')} action={back} />
        <Card>
          <EmptyState title={t('common.errorTitle')} icon="inventory" />
        </Card>
      </div>
    );
  }

  const item = data.item;

  return (
    <div className="space-y-5">
      <PageHeader
        title={item.name}
        subtitle={`${t('itemCard.title')} · ${item.sku} · ${item.categoryName}`}
        action={
          <div className="flex flex-wrap gap-2">
            {canEditItem && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate(`/inventory/products/${item.id}/edit`)}
              >
                {t('catalog.editItem')}
              </Button>
            )}
            {item.modelId && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate(`/inventory/models/${item.modelId}`)}
              >
                {t('item.openModel')}
              </Button>
            )}
            {back}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,320px)]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('report.from')}</span>
                <input
                  type="date"
                  className={field}
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value || from)}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('report.to')}</span>
                <input
                  type="date"
                  className={field}
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value || to)}
                />
              </label>
              <WarehouseSelect
                className="min-w-48 flex-1"
                value={warehouseId}
                onChange={(wh) => setParams(wh ? { wh } : {}, { replace: true })}
                allowAll
                includeClosed
              />
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label={t('itemCard.opening')}
              qty={data.openingBalance}
              value={seeCosts ? data.openingValue : undefined}
              unit={item.unit}
              currency={currency}
            />
            <Kpi label={t('itemCard.in')} qty={data.totalIn} unit={item.unit} tone="positive" />
            <Kpi label={t('itemCard.out')} qty={data.totalOut} unit={item.unit} tone="warning" />
            <Kpi
              label={t('itemCard.closing')}
              qty={data.closingBalance}
              value={seeCosts ? data.closingValue : undefined}
              unit={item.unit}
              currency={currency}
            />
          </div>

          <Card padded={false} className="overflow-hidden">
            {data.movements.length === 0 ? (
              <EmptyState title={t('itemCard.noMovements')} icon="inventory" />
            ) : isPhone ? (
              <ul className="divide-y divide-[var(--c-line)]">
                {data.movements.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 p-4">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{t(`movement.${m.type}`)}</span>
                      <span className="text-xs text-muted tnum">
                        {formatDate(m.date, locale)} · <Reference m={m} permissions={permissions} />
                        {!warehouseId && <> · {m.warehouseName}</>}
                      </span>
                    </span>
                    <span className="text-end tnum">
                      <span
                        className={`block text-sm font-semibold ${m.quantityIn ? 'text-positive' : 'text-warning'}`}
                      >
                        {m.quantityIn
                          ? `+${formatNumber(m.quantityIn, locale)}`
                          : `−${formatNumber(m.quantityOut, locale)}`}
                      </span>
                      <span className="text-xs text-muted">
                        {t('itemCard.balance')} {formatNumber(m.balance, locale)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <TableColumns id="itemCard.movements">
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="p-3 text-start font-medium">{t('common.date')}</th>
                      <th className="p-3 text-start font-medium">{t('itemCard.movement')}</th>
                      <th className="p-3 text-start font-medium">{t('itemCard.reference')}</th>
                      {!warehouseId && (
                        <th className="hidden p-3 text-start font-medium lg:table-cell">
                          {t('warehouse.label')}
                        </th>
                      )}
                      <th className="p-3 text-end font-medium">{t('itemCard.in')}</th>
                      <th className="p-3 text-end font-medium">{t('itemCard.out')}</th>
                      <th className="p-3 text-end font-medium">{t('itemCard.balance')}</th>
                      {seeCosts && (
                        <th className="hidden p-3 text-end font-medium md:table-cell">
                          {t('itemCard.unitCost')}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--c-line)]">
                    <tr data-span className="bg-surface-2 text-muted">
                      <td className="p-3 tnum">{formatDate(data.from, locale)}</td>
                      <td className="p-3" colSpan={2}>
                        {t('itemCard.opening')}
                      </td>
                      {!warehouseId && <td className="hidden p-3 lg:table-cell" />}
                      <td className="p-3" />
                      <td className="p-3" />
                      <td className="p-3 text-end font-semibold tnum text-fg">
                        {formatNumber(data.openingBalance, locale)}
                      </td>
                      <td className="hidden p-3 md:table-cell" />
                    </tr>
                    {data.movements.map((m) => (
                      <tr key={m.id}>
                        <td className="p-3 text-muted tnum">{formatDate(m.date, locale)}</td>
                        <td className="p-3">
                          {t(`movement.${m.type}`)}
                          {m.note && <span className="block text-xs text-muted">{m.note}</span>}
                        </td>
                        <td className="p-3 tnum">
                          <Reference m={m} permissions={permissions} />
                        </td>
                        {!warehouseId && (
                          <td className="hidden p-3 text-muted lg:table-cell">{m.warehouseName}</td>
                        )}
                        <td className="p-3 text-end tnum text-positive">
                          {m.quantityIn ? formatNumber(m.quantityIn, locale) : ''}
                        </td>
                        <td className="p-3 text-end tnum text-warning">
                          {m.quantityOut ? formatNumber(m.quantityOut, locale) : ''}
                        </td>
                        <td className="p-3 text-end font-semibold tnum">
                          {formatNumber(m.balance, locale)}
                        </td>
                        {seeCosts && (
                          <td className="hidden p-3 text-end tnum text-muted md:table-cell">
                            {formatMoney(m.unitCost, currency, locale)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableColumns>
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <Card>
            <dl className="space-y-1.5 text-sm">
              <Row
                label={t('inventory.stock')}
                value={`${formatNumber(item.stockOnHand, locale)} ${item.unit}`}
                strong
              />
              {item.units.length > 1 && (
                <>
                  {item.units.some(
                    (u) => u.factor > 1 && Math.abs(item.stockOnHand) >= u.factor,
                  ) && (
                    <Row label="" value={formatQuantity(item.stockOnHand, item.units, locale)} />
                  )}
                  <Row
                    label={t('item.units')}
                    value={item.units
                      .filter((u) => u.factor > 1)
                      .map((u) => `${u.name} = ${formatNumber(u.factor, locale)} ${item.unit}`)
                      .join(' · ')}
                  />
                </>
              )}
              <Row label={t('inventory.reorder')} value={formatNumber(item.reorderLevel, locale)} />
              {seeCosts && (
                <Row
                  label={t('inventory.avgCost')}
                  value={formatMoney(item.avgCost, currency, locale)}
                />
              )}
              <Row
                label={t('inventory.salePrice')}
                value={formatMoney(item.salePrice, currency, locale)}
              />
              {seeCosts && (
                <Row
                  label={t('inventory.stockValue')}
                  value={formatMoney(item.stockValue, currency, locale)}
                  strong
                />
              )}
            </dl>
          </Card>
          <StockByWarehouse stock={data.stock} unit={item.unit} />
          {canEdit && (
            <AdjustCard
              productId={item.id}
              stock={data.stock}
              initialWarehouseId={warehouseId}
              avgCost={item.avgCost}
              currency={currency}
              seeCosts={seeCosts}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Today's quantity of the item in each warehouse that holds it. */
function StockByWarehouse({ stock, unit }: { stock: WarehouseStock[]; unit: string }) {
  const { t, locale } = useT();
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        {t('warehouse.stockByWarehouse')}
      </h2>
      {stock.length === 0 ? (
        <p className="text-sm text-muted">{t('common.empty')}</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {stock.map((s) => (
            <li key={s.warehouseId} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {s.name} <span className="text-xs text-muted">· {s.branchName}</span>
              </span>
              <span className="font-medium tnum">
                {formatNumber(s.quantity, locale)}{' '}
                <span className="text-xs font-normal text-muted">{unit}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Quick one-item stocktake of one warehouse: enter what was actually counted there. */
function AdjustCard({
  productId,
  stock,
  initialWarehouseId,
  avgCost,
  currency,
  seeCosts,
}: {
  productId: string;
  stock: WarehouseStock[];
  initialWarehouseId: string;
  avgCost: number;
  currency: string;
  seeCosts: boolean;
}) {
  const { t, locale } = useT();
  const stocktake = useStocktake();
  const defaultWarehouse = useDefaultWarehouseId();
  const [picked, setPicked] = useState(initialWarehouseId);
  const warehouseId = picked || defaultWarehouse;
  const held = stock.find((s) => s.warehouseId === warehouseId);
  const bookQty = held?.quantity ?? 0;
  // Cost is per branch: value the difference at this warehouse's cost when it holds the item.
  const unitCost = held && held.quantity > 0 ? Math.round(held.value / held.quantity) : avgCost;
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const error = stocktake.error as ApiError | null;

  const countedQty = counted === '' ? null : Math.max(0, Math.floor(Number(counted) || 0));
  const diff = countedQty === null ? 0 : countedQty - bookQty;

  async function post() {
    if (countedQty === null || diff === 0) return;
    try {
      await stocktake.mutateAsync({
        lines: [{ productId, countedQuantity: countedQty }],
        reason: reason.trim() || undefined,
        warehouseId: warehouseId || undefined,
      });
      setCounted('');
      setReason('');
    } catch {
      /* surfaced below */
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        {t('stocktake.adjust')}
      </h2>
      <div className="space-y-2">
        <WarehouseSelect value={warehouseId} onChange={setPicked} />
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">
            {t('stocktake.counted')} ({t('stocktake.system')}: {formatNumber(bookQty, locale)})
          </span>
          <input
            type="number"
            min={0}
            className={`${field} w-full tnum`}
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
        </label>
        {diff !== 0 && (
          <p className={`text-xs tnum ${diff > 0 ? 'text-positive' : 'text-warning'}`}>
            {diff > 0 ? t('stocktake.gain') : t('stocktake.loss')}:{' '}
            {formatNumber(Math.abs(diff), locale)}
            {seeCosts &&
              ` · ${t('stocktake.valueImpact')} ${formatMoney(diff * unitCost, currency, locale)}`}
          </p>
        )}
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('stocktake.reason')}</span>
          <input
            className={`${field} w-full`}
            placeholder={t('stocktake.reasonHint')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="mt-3 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
          {errorText(t, error)}
        </p>
      )}
      {stocktake.isSuccess && !counted && (
        <p className="mt-3 rounded-[var(--radius-app)] bg-positive-soft p-2 text-xs text-positive">
          {t('stocktake.posted')} · {stocktake.data.reference}
        </p>
      )}
      <Button
        className="mt-3 w-full"
        icon="check"
        loading={stocktake.isPending}
        disabled={countedQty === null || diff === 0}
        onClick={post}
      >
        {stocktake.isPending ? t('stocktake.saving') : t('stocktake.save')}
      </Button>
    </Card>
  );
}

function Reference({ m, permissions }: { m: StockMovement; permissions: Permission[] }) {
  const { t } = useT();
  if (m.type === 'OPENING') return <span className="text-muted">{t('movement.OPENING')}</span>;
  const link = documentLink(m);
  if (link && permissions.includes(link.permission)) {
    return (
      <Link to={link.to} className="font-medium text-brand hover:underline">
        {m.reference}
      </Link>
    );
  }
  return <span>{m.reference}</span>;
}

function Kpi({
  label,
  qty,
  value,
  unit,
  currency,
  tone,
}: {
  label: string;
  qty: number;
  value?: number;
  unit: string;
  currency?: string;
  tone?: 'positive' | 'warning';
}) {
  const { locale } = useT();
  const color = tone === 'positive' ? 'text-positive' : tone === 'warning' ? 'text-warning' : '';
  return (
    <Card>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold tnum ${color}`}>
        {formatNumber(qty, locale)} <span className="text-xs font-normal text-muted">{unit}</span>
      </p>
      {value !== undefined && currency && (
        <p className="text-xs text-muted tnum">{formatMoney(value, currency, locale)}</p>
      )}
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`tnum ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}
