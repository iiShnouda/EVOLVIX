import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, formatNumber, toMajor, toMinor, type Product } from '@skb/shared';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { WarehouseSelect, useDefaultWarehouseId } from '../components/WarehouseSelect';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
import { ApiError } from '../lib/api';
import {
  useCompanySettings,
  useCreatePurchaseInvoice,
  useCreateSalesInvoice,
  useInventory,
  useParties,
  useProductSearch,
} from '../lib/queries';

interface Line {
  product: Product;
  quantity: number;
  /** Sale: selling price per unit. Purchase: unit cost. Minor units. */
  price: number;
}

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

export function InvoiceBuilderPage({ mode }: { mode: 'sale' | 'purchase' }) {
  const isSale = mode === 'sale';
  const { t, locale } = useT();
  const navigate = useNavigate();

  const settings = useCompanySettings();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const canOverride = permissions.includes('sales:override_floor');

  const parties = useParties({ page: 1, type: isSale ? 'CUSTOMER' : 'SUPPLIER' });
  const [partyId, setPartyId] = useState('');

  // Goods leave from (sale) or arrive into (purchase) this warehouse; defaults to the branch's.
  const defaultWarehouse = useDefaultWarehouseId();
  const [pickedWarehouse, setPickedWarehouse] = useState('');
  const warehouseId = pickedWarehouse || defaultWarehouse;
  const warehouseStock = useInventory({ warehouseId: warehouseId || undefined });
  const stockHere = useMemo(() => {
    if (!warehouseId || !warehouseStock.data) return null;
    return new Map(warehouseStock.data.items.map((i) => [i.id, { qty: i.stockOnHand, cost: i.avgCost }]));
  }, [warehouseId, warehouseStock.data]);
  /** Units of `p` in the chosen warehouse (company total until that list has loaded). */
  const available = (p: Product) => (stockHere ? (stockHere.get(p.id)?.qty ?? 0) : p.stockOnHand);
  /** Cost is per branch: the average cost where the goods leave from / arrive into. */
  const costOf = (p: Product) => stockHere?.get(p.id)?.cost ?? p.costPrice;

  const [search, setSearch] = useState('');
  const productList = useProductSearch(search);

  const [lines, setLines] = useState<Line[]>([]);
  const [taxPercent, setTaxPercent] = useState('');
  const [paidNow, setPaidNow] = useState('');
  const [overrideFloor, setOverrideFloor] = useState(false);
  const [notes, setNotes] = useState('');

  const createSale = useCreateSalesInvoice();
  const createPurchase = useCreatePurchaseInvoice();
  const pending = createSale.isPending || createPurchase.isPending;
  const serverError = (createSale.error ?? createPurchase.error) as ApiError | null;

  const currency = settings.data?.currency ?? 'EGP';
  const minMarkup = settings.data?.minMarkupPercent ?? 0;
  const defaultMarkup = settings.data?.defaultMarkupPercent ?? 10;
  const effTax = taxPercent === '' ? (settings.data?.defaultTaxPercent ?? 0) : Number(taxPercent);

  function addProduct(p: Product) {
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === p.id);
      if (existing)
        return prev.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      const cost = costOf(p);
      const price = isSale ? Math.round(cost * (1 + defaultMarkup / 100)) : cost;
      return [...prev, { product: p, quantity: 1, price }];
    });
    setSearch('');
  }

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));
  }
  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.product.id !== id));
  }

  // --- live computation ---
  const rows = lines.map((l) => {
    const cost = costOf(l.product); // weighted-average cost of the warehouse's branch
    const lineTotal = l.quantity * l.price;
    const lineCost = l.quantity * cost;
    const lineProfit = lineTotal - lineCost;
    const markupPct = cost > 0 ? ((l.price - cost) / cost) * 100 : 0;
    const belowCost = isSale && l.price < cost;
    const floor = Math.round(cost * (1 + Math.max(0, minMarkup) / 100));
    const belowFloor = isSale && !belowCost && l.price < floor;
    const overStock = isSale && l.quantity > available(l.product);
    return {
      line: l,
      cost,
      lineTotal,
      lineCost,
      lineProfit,
      markupPct,
      belowCost,
      belowFloor,
      overStock,
    };
  });

  const subtotal = rows.reduce((s, r) => s + r.lineTotal, 0);
  const costTotal = rows.reduce((s, r) => s + r.lineCost, 0);
  const tax = Math.round((subtotal * effTax) / 100);
  const grand = subtotal + tax;
  const profitTotal = subtotal - costTotal;
  const marginPct = subtotal > 0 ? (profitTotal / subtotal) * 100 : 0;

  const hasBelowCost = rows.some((r) => r.belowCost);
  const hasBlockedFloor = rows.some((r) => r.belowFloor) && !(overrideFloor && canOverride);
  const hasOverStock = rows.some((r) => r.overStock);
  const canSave =
    !!partyId && lines.length > 0 && !hasBelowCost && !hasBlockedFloor && !hasOverStock && !pending;

  async function save() {
    const payload = lines.map((l) => ({
      productId: l.product.id,
      quantity: l.quantity,
      price: l.price,
    }));
    const paidAmount = paidNow === '' ? 0 : toMinor(Number(paidNow));
    try {
      if (isSale) {
        await createSale.mutateAsync({
          partyId,
          lines: payload.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.price,
            discount: 0,
          })),
          taxPercent: effTax,
          paidAmount,
          overrideFloor,
          notes: notes || undefined,
          warehouseId: warehouseId || undefined,
        });
        navigate('/sales');
      } else {
        await createPurchase.mutateAsync({
          partyId,
          lines: payload.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCost: l.price,
          })),
          taxPercent: effTax,
          paidAmount,
          notes: notes || undefined,
          warehouseId: warehouseId || undefined,
        });
        navigate('/purchases');
      }
    } catch {
      /* surfaced via serverError */
    }
  }

  const partyRows = parties.data?.items ?? [];
  const products = productList.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(isSale ? 'invoice.newSale' : 'invoice.newPurchase')}
        action={
          <Button
            variant="ghost"
            size="sm"
            icon="close"
            onClick={() => navigate(isSale ? '/sales' : '/purchases')}
          >
            {t('invoice.back')}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(300px,360px)]">
        {/* Left: builder */}
        <div className="space-y-4">
          {/* Party + warehouse */}
          <Card className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">
                {t(isSale ? 'invoice.customer' : 'invoice.supplier')}
              </span>
              <select
                className={field}
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
              >
                <option value="">
                  {t(isSale ? 'invoice.selectCustomer' : 'invoice.selectSupplier')}
                </option>
                {partyRows.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <WarehouseSelect value={warehouseId} onChange={setPickedWarehouse} />
          </Card>

          {/* Product search */}
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
                placeholder={t('invoice.searchProduct')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-card)]">
                  {productList.isLoading ? (
                    <div className="grid place-items-center py-6 text-muted">
                      <Spinner size={18} />
                    </div>
                  ) : products.length === 0 ? (
                    <p className="p-3 text-sm text-muted">{t('common.empty')}</p>
                  ) : (
                    products.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="text-xs text-muted tnum">
                            {p.sku} · {formatNumber(available(p), locale)} {t('invoice.inStock')} ·{' '}
                            {t('invoice.cost')} {formatMoney(costOf(p), currency, locale)}
                          </span>
                        </span>
                        <Icon name="plus" size={16} className="text-brand" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Lines */}
            {rows.length === 0 ? (
              <p className="mt-4 rounded-[var(--radius-app)] bg-surface-2 p-4 text-center text-sm text-muted">
                {t('invoice.noItems')}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {rows.map((r) => (
                  <li
                    key={r.line.product.id}
                    className="rounded-[var(--radius-app)] border border-line p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.line.product.name}</p>
                        <p className="text-xs text-muted tnum">
                          {t('invoice.cost')} {formatMoney(r.cost, currency, locale)}
                          {isSale && (
                            <>
                              {' '}
                              · {t('inventory.stock')}:{' '}
                              {formatNumber(available(r.line.product), locale)}
                            </>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => removeLine(r.line.product.id)}
                        className="text-faint hover:text-destructive"
                        aria-label={t('invoice.remove')}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="block">
                        <span className="mb-0.5 block text-xs text-muted">{t('invoice.qty')}</span>
                        <input
                          type="number"
                          min={1}
                          className={`${field} tnum`}
                          value={r.line.quantity}
                          onChange={(e) =>
                            updateLine(r.line.product.id, {
                              quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                            })
                          }
                        />
                      </label>
                      <label className="block">
                        <span className="mb-0.5 block text-xs text-muted">
                          {isSale ? t('invoice.price') : t('invoice.receiveCost')}
                        </span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={`${field} tnum ${r.belowCost ? 'border-destructive' : r.belowFloor ? 'border-warning' : ''}`}
                          value={toMajor(r.line.price)}
                          onChange={(e) =>
                            updateLine(r.line.product.id, {
                              price: Math.max(0, toMinor(Number(e.target.value) || 0)),
                            })
                          }
                        />
                      </label>
                      {isSale && (
                        <div className="block">
                          <span className="mb-0.5 block text-xs text-muted">
                            {t('invoice.markup')}
                          </span>
                          <div
                            className={`${field} grid items-center tnum ${r.markupPct < 0 ? 'text-destructive' : ''}`}
                          >
                            {r.markupPct.toFixed(1)}%
                          </div>
                        </div>
                      )}
                      <div className="block">
                        <span className="mb-0.5 block text-xs text-muted">
                          {isSale ? t('invoice.lineProfit') : t('common.total')}
                        </span>
                        <div
                          className={`${field} grid items-center tnum ${isSale ? (r.lineProfit < 0 ? 'text-destructive' : 'text-positive') : ''}`}
                        >
                          {formatMoney(isSale ? r.lineProfit : r.lineTotal, currency, locale)}
                        </div>
                      </div>
                    </div>

                    {(r.belowCost || r.belowFloor || r.overStock) && (
                      <p
                        className={`mt-2 text-xs ${r.belowCost || r.overStock ? 'text-destructive' : 'text-warning'}`}
                      >
                        {r.overStock
                          ? `${t('inventory.stock')}: ${formatNumber(available(r.line.product), locale)}`
                          : r.belowCost
                            ? t('invoice.belowCost')
                            : t('invoice.belowFloor')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
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
              <Row label={t('invoice.subtotal')} value={formatMoney(subtotal, currency, locale)} />
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">{t('invoice.taxPercent')}</dt>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={`${field} tnum w-20 text-end`}
                  placeholder={String(settings.data?.defaultTaxPercent ?? 0)}
                  value={taxPercent}
                  onChange={(e) => setTaxPercent(e.target.value)}
                />
              </div>
              <Row label={t('invoice.tax')} value={formatMoney(tax, currency, locale)} />
              <div className="my-1 border-t border-line" />
              <Row
                label={t('invoice.grandTotal')}
                value={formatMoney(grand, currency, locale)}
                strong
              />
              {isSale && (
                <>
                  <div className="my-1 border-t border-line" />
                  <Row
                    label={t('invoice.totalCost')}
                    value={formatMoney(costTotal, currency, locale)}
                  />
                  <div className="flex items-center justify-between">
                    <dt className="text-muted">{t('invoice.totalProfit')}</dt>
                    <dd
                      className={`font-semibold tnum ${profitTotal < 0 ? 'text-destructive' : 'text-positive'}`}
                    >
                      {formatMoney(profitTotal, currency, locale)}{' '}
                      <span className="text-xs font-normal">({marginPct.toFixed(1)}%)</span>
                    </dd>
                  </div>
                </>
              )}
            </dl>

            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('invoice.paidNow')}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={`${field} tnum`}
                  value={paidNow}
                  onChange={(e) => setPaidNow(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('invoice.notes')}</span>
                <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>

            {isSale && rows.some((r) => r.belowFloor) && canOverride && (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={overrideFloor}
                  onChange={(e) => setOverrideFloor(e.target.checked)}
                />
                {t('invoice.overrideFloor')}
              </label>
            )}

            {hasBelowCost && (
              <p className="mt-3 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
                {t('invoice.belowCost')}
              </p>
            )}
            {serverError && (
              <p className="mt-3 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
                {serverError.message}
              </p>
            )}

            <Button
              className="mt-4 w-full"
              icon="check"
              loading={pending}
              disabled={!canSave}
              onClick={save}
            >
              {pending ? t('invoice.saving') : t('invoice.save')}
            </Button>
            {isSale && (
              <p className="mt-2 text-center text-xs text-faint">{t('invoice.floorHint')}</p>
            )}
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
