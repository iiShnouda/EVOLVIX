import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  applyCharges,
  formatMoney,
  formatNumber,
  formatQuantity,
  toMajor,
  toMinor,
  type ChargeInput,
  type ChargeKind,
  type DeliveryMethod,
  type Party,
  type Product,
  type RepOption,
  addDays,
  companyToday,
} from '@skb/shared';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { WarehouseSelect, useDefaultWarehouseId } from '../components/WarehouseSelect';
import { MoneyAccountPicker } from '../components/MoneyAccountPicker';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { api, ApiError } from '../lib/api';
import { errorText } from '../lib/errors';
import {
  useCompanySettings,
  useCreatePurchaseInvoice,
  useCreateQuotation,
  useCreateSalesInvoice,
  useInventory,
  useParties,
  usePriceLevels,
  usePricing,
  useProductSearch,
  useReps,
} from '../lib/queries';

interface Line {
  /** Local id: the same item may be on two lines (e.g. cartons and pieces). */
  key: string;
  product: Product;
  unitId: string;
  /** Quantity in the line's unit. */
  quantity: number;
  /** Price of one line unit typed by hand (minor units); used only when `touched`. */
  price: number;
  /** The price was typed; otherwise it follows the price level. */
  touched: boolean;
  /** Free goods (بونص): no price, but the cost counts. */
  bonus: boolean;
}

/** An invoice discount as typed: a percent or an amount. */
interface DiscountInput {
  mode: 'percent' | 'amount';
  value: string;
}

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:bg-surface-2';

let nextKey = 0;

/**
 * Sales / purchase invoice builder, and (mode "quote") the price quotation builder: a quotation is
 * priced the same way but has no payment or delivery, may promise more than is in stock, and holds
 * its prices until its date. Each line is in one of the item's units (piece, carton…); the server
 * prices it (POST /pricing): the party's price list or an offer, else the invoice's price level —
 * the party's own, else the default — and, for an item without a price, cost × (1 + default markup)
 * (sales) or the average cost (purchases); on a sale, a quantity discount then comes off. Typing
 * another price or picking another level needs its own permission; the server checks the same.
 * Live cost, markup and profit use the cost of the chosen warehouse's branch.
 */
export function InvoiceBuilderPage({ mode }: { mode: 'sale' | 'purchase' | 'quote' }) {
  const isQuote = mode === 'quote';
  const isSale = mode !== 'purchase';
  const backTo = isQuote ? '/sales?tab=quotations' : isSale ? '/sales' : '/purchases';
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();

  const settings = useCompanySettings();
  const canOverride = can('sales:override_floor');
  const canChangePrice = can(isSale ? 'sales:change_price' : 'purchases:change_price');
  const canChooseLevel = can(isSale ? 'sales:choose_price_level' : 'purchases:choose_price_level');
  const canDiscount = can(isSale ? 'sales:discount' : 'purchases:discount');
  const canBonus = can(isSale ? 'sales:bonus' : 'purchases:bonus');
  const canChangeTax = can(isSale ? 'sales:change_tax' : 'purchases:change_tax');
  const canAdditions = can(isSale ? 'sales:additions' : 'purchases:additions');
  const reps = useReps(isSale);
  const [repId, setRepId] = useState('');

  const parties = useParties({
    page: 1,
    pageSize: 100,
    type: isSale ? 'CUSTOMER' : 'SUPPLIER',
    active: true,
  });
  const carriers = useParties({
    page: 1,
    pageSize: 100,
    type: 'CARRIER',
    active: true,
    enabled: isSale,
  });
  const [delivery, setDelivery] = useState<DeliveryValue>({
    method: 'PICKUP',
    address: '',
    driverId: '',
    carrierId: '',
  });
  const [partyId, setPartyId] = useState('');
  const party = parties.data?.items.find((p) => p.id === partyId);

  // Price level: the party's own, else the default of this side. Another needs permission.
  const levels = usePriceLevels();
  const sideLevels = (levels.data ?? []).filter(
    (l) => l.side === (isSale ? 'SALE' : 'PURCHASE') && l.isActive,
  );
  const partyLevelId = isSale ? party?.salesPriceLevelId : party?.purchasePriceLevelId;
  const ownLevel =
    sideLevels.find((l) => l.id === partyLevelId) ??
    sideLevels.find((l) => l.isDefault) ??
    sideLevels[0];
  const [pickedLevel, setPickedLevel] = useState('');
  const levelId = (canChooseLevel && pickedLevel) || ownLevel?.id || '';

  // Goods leave from (sale) or arrive into (purchase) this warehouse; defaults to the branch's.
  const defaultWarehouse = useDefaultWarehouseId();
  const [pickedWarehouse, setPickedWarehouse] = useState('');
  const warehouseId = pickedWarehouse || defaultWarehouse;
  const warehouseStock = useInventory({ warehouseId: warehouseId || undefined });
  const stockHere = useMemo(() => {
    if (!warehouseId || !warehouseStock.data) return null;
    return new Map(
      warehouseStock.data.items.map((i) => [i.id, { qty: i.stockOnHand, cost: i.avgCost }]),
    );
  }, [warehouseId, warehouseStock.data]);
  /** Base units of `p` in the chosen warehouse (company total until that list has loaded). */
  const available = (p: Product) => (stockHere ? (stockHere.get(p.id)?.qty ?? 0) : p.stockOnHand);
  /** Cost is per branch: the average cost of one base unit where the goods leave / arrive. */
  const costOf = (p: Product) => stockHere?.get(p.id)?.cost ?? p.costPrice;

  const [search, setSearch] = useState('');
  const productList = useProductSearch(search);
  const searchBox = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<Line[]>([]);
  const [taxPercent, setTaxPercent] = useState('');
  const [discount1, setDiscount1] = useState<DiscountInput>({ mode: 'percent', value: '' });
  const [discount2, setDiscount2] = useState<DiscountInput>({ mode: 'amount', value: '' });
  const [otherTax, setOtherTax] = useState('');
  const [addition, setAddition] = useState('');
  const [additionLabel, setAdditionLabel] = useState('');
  const [paidNow, setPaidNow] = useState('');
  const [paidAccountId, setPaidAccountId] = useState('');
  const [overrideFloor, setOverrideFloor] = useState(false);
  const [notes, setNotes] = useState('');
  const [validUntil, setValidUntil] = useState(() => addDays(companyToday(), 14));

  const createSale = useCreateSalesInvoice();
  const createPurchase = useCreatePurchaseInvoice();
  const createQuote = useCreateQuotation();
  const pending = createSale.isPending || createPurchase.isPending || createQuote.isPending;
  const serverError = (createSale.error ??
    createPurchase.error ??
    createQuote.error) as ApiError | null;

  const currency = settings.data?.currency ?? 'EGP';
  const minMarkup = settings.data?.minMarkupPercent ?? 0;
  const defaultMarkup = settings.data?.defaultMarkupPercent ?? 10;
  const effTax = taxPercent === '' ? (settings.data?.defaultTaxPercent ?? 0) : Number(taxPercent);

  const unitOf = (l: Pick<Line, 'product' | 'unitId'>) =>
    l.product.units.find((u) => u.unitId === l.unitId) ?? l.product.units[0];

  /** The level's price of one line unit; for an unpriced item, from cost (same rule as the server). */
  function suggested(l: Pick<Line, 'product' | 'unitId'>): number {
    const unit = unitOf(l);
    const factor = unit?.factor ?? 1;
    const levelPrice = unit?.prices.find((p) => p.priceLevelId === levelId)?.price;
    if (levelPrice !== undefined) return levelPrice;
    const cost = costOf(l.product) * factor;
    return isSale ? Math.round((cost * (100 + Math.max(0, defaultMarkup))) / 100) : cost;
  }

  // The server's prices for the lines (price list, level, quantity discount). While they load the
  // level's price shows, and saving waits.
  const pricingInput = {
    partyId: partyId || undefined,
    priceLevelId: canChooseLevel && pickedLevel ? pickedLevel : undefined,
    warehouseId: warehouseId || undefined,
    lines: lines.map((l) => ({
      productId: l.product.id,
      unitId: l.unitId || undefined,
      quantity: l.quantity,
      isBonus: l.bonus || undefined,
    })),
  };
  const pricing = usePricing(isSale ? 'sale' : 'purchase', pricingInput);
  const priced = pricing.data && !pricing.isPlaceholderData ? pricing.data.lines : null;
  // (If pricing fails, saving isn't held up: the server checks prices again anyway.)
  const pricingBusy = lines.length > 0 && !pricing.isError && (pricing.isFetching || !priced);
  const typed = (l: Line) => canChangePrice && l.touched && !l.bonus;
  const priceOf = (l: Line, i: number) =>
    l.bonus ? 0 : typed(l) ? l.price : (priced?.[i]?.unitPrice ?? suggested(l));
  /** A quantity discount on a line nobody re-priced by hand. */
  const lineDiscountOf = (l: Line, i: number) => (l.bonus || typed(l) ? 0 : (priced?.[i]?.discount ?? 0));

  function addProduct(p: Product, unitId?: string | null) {
    const unit = unitId ?? p.matchedUnitId ?? p.units[0]?.unitId ?? '';
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === p.id && l.unitId === unit);
      if (existing)
        return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      return [
        ...prev,
        {
          key: `l${nextKey++}`,
          product: p,
          unitId: unit,
          quantity: 1,
          price: 0,
          touched: false,
          bonus: false,
        },
      ];
    });
    setSearch('');
    searchBox.current?.focus();
  }

  /** Enter in the search box: a scanned barcode (or a single match) is added at once. */
  async function addFromSearch() {
    const term = search.trim();
    if (!term) return;
    try {
      const found = await api.get<Product[]>(`/products?search=${encodeURIComponent(term)}`);
      const hit = found.find((p) => p.matchedUnitId) ?? (found.length === 1 ? found[0] : undefined);
      if (hit) addProduct(hit, hit.matchedUnitId);
    } catch {
      /* the dropdown still shows the matches */
    }
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  // --- live computation ---
  const baseWanted = new Map<string, number>();
  for (const l of lines) {
    baseWanted.set(
      l.product.id,
      (baseWanted.get(l.product.id) ?? 0) + l.quantity * (unitOf(l)?.factor ?? 1),
    );
  }
  const pre = lines.map((l, i) => {
    const unit = unitOf(l);
    const factor = unit?.factor ?? 1;
    const price = priceOf(l, i);
    const lineDiscount = lineDiscountOf(l, i);
    const cost = costOf(l.product) * factor; // cost of one line unit at the warehouse's branch
    const info = typed(l) || l.bonus ? null : (priced?.[i] ?? null);
    return {
      line: l,
      unit,
      factor,
      price,
      lineDiscount,
      listName: info?.source === 'LIST' ? info.listName : null,
      breakBp: info?.breakBp ?? 0,
      cost,
      lineTotal: l.quantity * price - lineDiscount,
      lineCost: l.quantity * cost,
    };
  });

  // Invoice charges, in the same order and with the same rounding as the server.
  const round2 = (v: string) => Math.round(Number(v) * 100) / 100;
  const chargeInputs: ChargeInput[] = [];
  const pushDiscount = (kind: ChargeKind, d: DiscountInput) => {
    if (d.value.trim() === '' || !(Number(d.value) > 0)) return;
    chargeInputs.push(
      d.mode === 'percent'
        ? { kind, percent: round2(d.value) }
        : { kind, amount: toMinor(Number(d.value)) },
    );
  };
  pushDiscount('DISCOUNT', discount1);
  pushDiscount('EXTRA_DISCOUNT', discount2);
  if (effTax > 0) chargeInputs.push({ kind: 'TAX', percent: round2(String(effTax)) });
  if (Number(otherTax) > 0) chargeInputs.push({ kind: 'OTHER_TAX', percent: round2(otherTax) });
  if (Number(addition) > 0)
    chargeInputs.push({
      kind: 'ADDITION',
      amount: toMinor(Number(addition)),
      label: additionLabel.trim() || undefined,
    });
  const outcome = applyCharges(
    pre.map((p) => p.lineTotal),
    pre.map((p) => !p.line.bonus),
    chargeInputs,
  );

  const rows = pre.map((p, i) => {
    const docDiscount = outcome.allocation[i] ?? 0;
    const net = p.lineTotal - docDiscount; // what the line really brings in
    const lineProfit = net - p.lineCost;
    const netUnit = p.line.quantity > 0 ? net / p.line.quantity : 0;
    const markupPct = p.cost > 0 ? ((netUnit - p.cost) / p.cost) * 100 : 0;
    const floorUnit = Math.round((p.cost * (100 + Math.max(0, minMarkup))) / 100);
    const belowCost = isSale && !p.line.bonus && net < p.lineCost;
    const belowFloor = isSale && !p.line.bonus && !belowCost && net < p.line.quantity * floorUnit;
    const overStock =
      isSale && (baseWanted.get(p.line.product.id) ?? 0) > available(p.line.product);
    return { ...p, docDiscount, net, lineProfit, markupPct, belowCost, belowFloor, overStock };
  });

  const subtotal = rows.reduce((s, r) => s + r.lineTotal, 0);
  const costTotal = rows.reduce((s, r) => s + r.lineCost, 0);
  const netTotal = subtotal - outcome.discount;
  const tax = outcome.tax;
  const grand = netTotal + outcome.tax + outcome.addition;
  const profitTotal = netTotal - costTotal;
  const marginPct = netTotal > 0 ? (profitTotal / netTotal) * 100 : 0;

  const hasBelowCost = rows.some((r) => r.belowCost);
  const hasBlockedFloor = rows.some((r) => r.belowFloor) && !(overrideFloor && canOverride);
  const hasOverStock = rows.some((r) => r.overStock);
  const canSave =
    !!partyId &&
    lines.length > 0 &&
    !hasBelowCost &&
    !hasBlockedFloor &&
    (isQuote || !hasOverStock) &&
    !outcome.error &&
    !(isSale && !isQuote && delivery.method === 'SHIPPING_COMPANY' && !delivery.carrierId) &&
    !(isQuote && !validUntil) &&
    !pricingBusy &&
    !pending;

  async function save() {
    const paidAmount = paidNow === '' ? 0 : toMinor(Number(paidNow));
    const priceLevelId = canChooseLevel && pickedLevel ? pickedLevel : undefined;
    try {
      if (isQuote) {
        await createQuote.mutateAsync({
          partyId,
          lines: rows.map((r) => ({
            productId: r.line.product.id,
            unitId: r.line.unitId || undefined,
            quantity: r.line.quantity,
            unitPrice: r.price,
            discount: r.lineDiscount,
            isBonus: r.line.bonus || undefined,
          })),
          charges: chargeInputs,
          paidAmount: 0,
          overrideFloor,
          notes: notes || undefined,
          warehouseId: warehouseId || undefined,
          priceLevelId,
          repId: repId || undefined,
          dueDate: validUntil,
        });
        navigate(backTo);
      } else if (isSale) {
        await createSale.mutateAsync({
          partyId,
          lines: rows.map((r) => ({
            productId: r.line.product.id,
            unitId: r.line.unitId || undefined,
            quantity: r.line.quantity,
            unitPrice: r.price,
            discount: r.lineDiscount,
            isBonus: r.line.bonus || undefined,
          })),
          charges: chargeInputs,
          paidAmount,
          overrideFloor,
          notes: notes || undefined,
          warehouseId: warehouseId || undefined,
          priceLevelId,
          repId: repId || undefined,
          paidAccountId: paidAmount > 0 && paidAccountId ? paidAccountId : undefined,
          deliveryMethod: delivery.method,
          deliveryAddress:
            delivery.method !== 'PICKUP' && delivery.address.trim()
              ? delivery.address.trim()
              : undefined,
          driverId:
            delivery.method === 'OWN_DELIVERY' && delivery.driverId ? delivery.driverId : undefined,
          carrierId:
            delivery.method === 'SHIPPING_COMPANY' && delivery.carrierId
              ? delivery.carrierId
              : undefined,
        });
        navigate('/sales');
      } else {
        await createPurchase.mutateAsync({
          partyId,
          lines: rows.map((r) => ({
            productId: r.line.product.id,
            unitId: r.line.unitId || undefined,
            quantity: r.line.quantity,
            unitCost: r.price,
            isBonus: r.line.bonus || undefined,
          })),
          charges: chargeInputs,
          paidAmount,
          notes: notes || undefined,
          warehouseId: warehouseId || undefined,
          priceLevelId,
          paidAccountId: paidAmount > 0 && paidAccountId ? paidAccountId : undefined,
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
        title={t(isQuote ? 'quote.new' : isSale ? 'invoice.newSale' : 'invoice.newPurchase')}
        subtitle={isQuote ? t('quote.newHint') : undefined}
        action={
          <Button variant="ghost" size="sm" icon="close" onClick={() => navigate(backTo)}>
            {t('invoice.back')}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(300px,360px)]">
        {/* Left: builder */}
        <div className="min-w-0 space-y-4">
          {/* Party + warehouse + price level */}
          <Card
            className={`grid gap-3 ${isSale ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}
          >
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">
                {t(isSale ? 'invoice.customer' : 'invoice.supplier')}
              </span>
              <select
                className={field}
                value={partyId}
                onChange={(e) => {
                  setPartyId(e.target.value);
                  setPickedLevel('');
                }}
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
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('invoice.priceLevel')}</span>
              <select
                className={field}
                value={levelId}
                disabled={!canChooseLevel}
                onChange={(e) => setPickedLevel(e.target.value)}
              >
                {sideLevels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            {isSale && (
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('invoice.rep')}</span>
                <select className={field} value={repId} onChange={(e) => setRepId(e.target.value)}>
                  <option value="">{t('invoice.noRep')}</option>
                  {(reps.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </Card>

          {isSale && !isQuote && (
            <DeliveryCard
              value={delivery}
              onChange={setDelivery}
              party={party}
              drivers={reps.data ?? []}
              carriers={carriers.data?.items ?? []}
            />
          )}

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
                ref={searchBox}
                className={`${field} ps-8`}
                placeholder={t('invoice.searchProduct')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void addFromSearch();
                  }
                }}
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
                            {p.sku} · {formatQuantity(available(p), p.units, locale)}{' '}
                            {t('invoice.inStock')} · {t('invoice.cost')}{' '}
                            {formatMoney(costOf(p), currency, locale)}
                          </span>
                        </span>
                        <Icon name="plus" size={16} className="text-brand" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-faint">{t('invoice.scanHint')}</p>

            {/* Lines */}
            {rows.length === 0 ? (
              <p className="mt-4 rounded-[var(--radius-app)] bg-surface-2 p-4 text-center text-sm text-muted">
                {t('invoice.noItems')}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {rows.map((r) => (
                  <li
                    key={r.line.key}
                    className="rounded-[var(--radius-app)] border border-line p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.line.product.name}</p>
                        <p className="text-xs text-muted tnum">
                          {t('invoice.cost')} {formatMoney(r.cost, currency, locale)}
                          {r.unit && ` / ${r.unit.name}`}
                          {isSale && (
                            <>
                              {' '}
                              · {t('inventory.stock')}:{' '}
                              {formatQuantity(
                                available(r.line.product),
                                r.line.product.units,
                                locale,
                              )}
                            </>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => removeLine(r.line.key)}
                        className="text-faint hover:text-destructive"
                        aria-label={t('invoice.remove')}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <label className="block">
                        <span className="mb-0.5 block text-xs text-muted">{t('invoice.unit')}</span>
                        <select
                          className={field}
                          value={r.line.unitId}
                          disabled={r.line.product.units.length < 2}
                          onChange={(e) =>
                            updateLine(r.line.key, { unitId: e.target.value, touched: false })
                          }
                        >
                          {r.line.product.units.map((u) => (
                            <option key={u.unitId} value={u.unitId}>
                              {u.name}
                              {u.factor > 1 ? ` (${u.factor})` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-0.5 block text-xs text-muted">{t('invoice.qty')}</span>
                        <input
                          type="number"
                          min={1}
                          className={`${field} tnum`}
                          value={r.line.quantity}
                          onChange={(e) =>
                            updateLine(r.line.key, {
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
                          readOnly={!canChangePrice || r.line.bonus}
                          title={canChangePrice ? undefined : t('invoice.priceLocked')}
                          className={`${field} tnum ${canChangePrice && !r.line.bonus ? '' : 'bg-surface-2'} ${r.belowCost ? 'border-destructive' : r.belowFloor ? 'border-warning' : ''}`}
                          value={toMajor(r.price)}
                          onChange={(e) =>
                            updateLine(r.line.key, {
                              price: Math.max(0, toMinor(Number(e.target.value) || 0)),
                              touched: true,
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
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted tnum">
                      {r.factor > 1 && (
                        <span>
                          = {formatNumber(r.line.quantity * r.factor, locale)} {r.line.product.unit}
                        </span>
                      )}
                      {r.listName && (
                        <span className="text-brand">
                          {t('pl.fromList')} <bdi>{r.listName}</bdi>
                        </span>
                      )}
                      {r.lineDiscount > 0 && (
                        <span className="text-positive">
                          {t('pl.qtyDiscount')} {formatNumber(r.breakBp / 100, locale)}%: −
                          {formatMoney(r.lineDiscount, currency, locale)}
                        </span>
                      )}
                      {r.docDiscount > 0 && (
                        <span>
                          {t('charge.DISCOUNT')}: −{formatMoney(r.docDiscount, currency, locale)}
                        </span>
                      )}
                      {(canBonus || r.line.bonus) && (
                        <label
                          className="inline-flex items-center gap-1.5"
                          title={t('invoice.bonusHint')}
                        >
                          <input
                            type="checkbox"
                            checked={r.line.bonus}
                            disabled={!canBonus}
                            onChange={(e) => updateLine(r.line.key, { bonus: e.target.checked })}
                          />
                          {t('invoice.bonus')}
                        </label>
                      )}
                    </div>

                    {(r.belowCost || r.belowFloor || r.overStock) && (
                      <p
                        className={`mt-2 text-xs ${r.belowCost || (r.overStock && !isQuote) ? 'text-destructive' : 'text-warning'}`}
                      >
                        {r.overStock
                          ? `${t('inventory.stock')}: ${formatQuantity(available(r.line.product), r.line.product.units, locale)}`
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
        <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              {t('common.total')}
            </h2>
            <dl className="space-y-1.5 text-sm">
              <Row label={t('invoice.subtotal')} value={formatMoney(subtotal, currency, locale)} />
              {(canDiscount || discount1.value || discount2.value) && (
                <>
                  <DiscountField
                    label={t('charge.DISCOUNT')}
                    value={discount1}
                    onChange={setDiscount1}
                    disabled={!canDiscount}
                    amount={outcome.rows.find((c) => c.kind === 'DISCOUNT')?.amount ?? 0}
                    currency={currency}
                  />
                  <DiscountField
                    label={t('charge.EXTRA_DISCOUNT')}
                    value={discount2}
                    onChange={setDiscount2}
                    disabled={!canDiscount}
                    amount={outcome.rows.find((c) => c.kind === 'EXTRA_DISCOUNT')?.amount ?? 0}
                    currency={currency}
                  />
                  <Row label={t('charge.net')} value={formatMoney(netTotal, currency, locale)} />
                </>
              )}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">{t('invoice.taxPercent')}</dt>
                <input
                  type="number"
                  min={0}
                  max={100}
                  disabled={!canChangeTax}
                  className={`${field} tnum w-20 text-end`}
                  placeholder={String(settings.data?.defaultTaxPercent ?? 0)}
                  value={taxPercent}
                  onChange={(e) => setTaxPercent(e.target.value)}
                />
              </div>
              {canChangeTax && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">{t('charge.OTHER_TAX')} %</dt>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={`${field} tnum w-20 text-end`}
                    placeholder="0"
                    value={otherTax}
                    onChange={(e) => setOtherTax(e.target.value)}
                  />
                </div>
              )}
              <Row label={t('invoice.tax')} value={formatMoney(tax, currency, locale)} />
              {canAdditions && (
                <div className="grid grid-cols-[1fr_96px] items-end gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-xs text-muted">
                      {t('invoice.additions')}
                    </span>
                    <input
                      className={field}
                      placeholder={t('charge.labelPlaceholder')}
                      value={additionLabel}
                      onChange={(e) => setAdditionLabel(e.target.value)}
                    />
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={t('charge.amount')}
                    className={`${field} tnum text-end`}
                    placeholder="0"
                    value={addition}
                    onChange={(e) => setAddition(e.target.value)}
                  />
                </div>
              )}
              {outcome.addition > 0 && (
                <Row
                  label={t('invoice.additions')}
                  value={formatMoney(outcome.addition, currency, locale)}
                />
              )}
              {outcome.error && <p className="text-xs text-destructive">{t('charge.tooBig')}</p>}
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
              {isQuote ? (
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">{t('quote.validUntil')}</span>
                  <input
                    type="date"
                    className={`${field} tnum`}
                    min={companyToday()}
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                  />
                </label>
              ) : (
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
              )}
              {!isQuote && Number(paidNow) > 0 && (
                <MoneyAccountPicker
                  className={field}
                  label={t(isSale ? 'money.receivedInto' : 'money.paidInto')}
                  value={paidAccountId}
                  onChange={setPaidAccountId}
                />
              )}
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
                {errorText(t, serverError)}
              </p>
            )}

            <Button
              className="mt-4 w-full"
              icon="check"
              loading={pending}
              disabled={!canSave}
              onClick={save}
            >
              {pending ? t('invoice.saving') : isQuote ? t('quote.save') : t('invoice.save')}
            </Button>
            {isSale && (
              <p className="mt-2 text-center text-xs text-faint">{t('invoice.floorHint')}</p>
            )}
            {!canChangePrice && (
              <p className="mt-1 text-center text-xs text-faint">{t('invoice.priceLocked')}</p>
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

/** An invoice discount: a number and whether it is a percent or an amount. */
function DiscountField({
  label,
  value,
  onChange,
  disabled,
  amount,
  currency,
}: {
  label: string;
  value: DiscountInput;
  onChange: (v: DiscountInput) => void;
  disabled: boolean;
  amount: number;
  currency: string;
}) {
  const { t, locale } = useT();
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step="0.01"
          disabled={disabled}
          className={`${field} tnum w-20 text-end`}
          placeholder="0"
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
        />
        <select
          className={`${field} w-auto px-1.5`}
          disabled={disabled}
          aria-label={label}
          value={value.mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as DiscountInput['mode'] })}
        >
          <option value="percent">{t('charge.percent')}</option>
          <option value="amount">{t('charge.amount')}</option>
        </select>
        {amount > 0 && (
          <span className="w-24 text-end text-xs text-muted tnum">
            −{formatMoney(amount, currency, locale)}
          </span>
        )}
      </div>
    </div>
  );
}

interface DeliveryValue {
  method: DeliveryMethod;
  address: string;
  driverId: string;
  carrierId: string;
}

const METHODS: DeliveryMethod[] = ['PICKUP', 'OWN_DELIVERY', 'SHIPPING_COMPANY'];

/** How the goods reach the customer: picked up, our driver, or a shipping company. */
function DeliveryCard({
  value,
  onChange,
  party,
  drivers,
  carriers,
}: {
  value: DeliveryValue;
  onChange: (v: DeliveryValue) => void;
  party: Party | undefined;
  drivers: RepOption[];
  carriers: Party[];
}) {
  const { t } = useT();
  const set = (patch: Partial<DeliveryValue>) => onChange({ ...value, ...patch });

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-muted">
          <Icon name="delivery" size={16} /> {t('delivery.method')}
        </span>
        <div
          role="radiogroup"
          aria-label={t('delivery.method')}
          className="flex max-w-full flex-wrap gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1"
        >
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={value.method === m}
              onClick={() => set({ method: m })}
              className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
                value.method === m ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
              }`}
            >
              {t(`delivery.${m}`)}
            </button>
          ))}
        </div>
      </div>

      {value.method !== 'PICKUP' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('delivery.address')}</span>
            <input
              className={field}
              value={value.address}
              maxLength={300}
              placeholder={party?.address || t('delivery.addressPlaceholder')}
              onChange={(e) => set({ address: e.target.value })}
            />
          </label>
          {value.method === 'OWN_DELIVERY' ? (
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('delivery.driver')}</span>
              <select
                className={field}
                value={value.driverId}
                onChange={(e) => set({ driverId: e.target.value })}
              >
                <option value="">{t('delivery.noDriver')}</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('delivery.carrier')}</span>
              <select
                className={field}
                value={value.carrierId}
                onChange={(e) => set({ carrierId: e.target.value })}
                aria-invalid={!value.carrierId}
              >
                <option value="">{t('delivery.pickCarrier')}</option>
                {carriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {carriers.length === 0 && (
                <span className="mt-0.5 block text-xs text-faint">{t('delivery.noCarriers')}</span>
              )}
            </label>
          )}
        </div>
      )}
    </Card>
  );
}
