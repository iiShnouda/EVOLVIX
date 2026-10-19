import { confirm } from '../lib/confirm';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  type PriceBasis,
  type Product,
  type SalesDocument,
  companyToday,
} from '@skb/shared';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { PrintSetupSheet } from '../components/DocumentPreview';
import { DocumentActivity } from '../components/DocumentActivity';
import { Icon } from '../components/Icon';
import { WarehouseSelect, useDefaultWarehouseId } from '../components/WarehouseSelect';
import { MoneyAccountPicker } from '../components/MoneyAccountPicker';
import { PartyPicker } from '../components/PartyPicker';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { api, ApiError } from '../lib/api';
import { errorText } from '../lib/errors';
import { useAuth } from '../stores/auth';
import { useWorkDraft } from '../lib/workDraft';
import { useDeviceInfo } from '../lib/device';
import { useWorkPlace } from '../lib/workPlace';
import { onlyChoice } from '../lib/onlyChoice';
import { ItemLifeSheet } from '../components/ItemLifeSheet';
import { DocumentDateField, dayToSend } from '../components/DocumentDate';
import { ItemFinderSheet } from '../components/ItemFinderSheet';
import {
  useCompanySettings,
  useDepartments,
  useCreatePurchaseInvoice,
  useCreateOrder,
  useCreateQuotation,
  useCreateSalesInvoice,
  useHiddenColumns,
  useUpdateSalesInvoice,
  useWarehouses,
  useInventory,
  useParties,
  usePriceLevels,
  usePricing,
  useProductSearch,
  useReps,
} from '../lib/queries';
import { TableColumns } from '../components/TableColumns';
import { codeName } from '../components/CodeName';

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
  /**
   * A discount on this line only: a percent of it, so much per piece (the item's smallest unit,
   * «على الحتة»), or a fixed amount. Sales and quotations; needs the discount permission.
   */
  discMode: LineDiscountMode;
  discValue: string;
  /** A second discount on the same line, taken after the first (owner, 2026-10-02: "two discounts a piece"). */
  disc2Mode: LineDiscountMode;
  disc2Value: string;
  /** Sold at the selling price, the customer's last price or cost, chosen per item (owner, 2026-10-01). */
  basis: PriceBasis;
}

type LineDiscountMode = 'percent' | 'piece' | 'amount';

/** A line discount in minor units, never more than the line (`gross`) is worth. */
function lineDiscount(mode: LineDiscountMode, value: string, gross: number, basePieces: number) {
  const v = Number(value);
  if (!value.trim() || !Number.isFinite(v) || v <= 0 || gross <= 0) return 0;
  const d =
    mode === 'percent'
      ? Math.round((gross * Math.min(v, 100)) / 100)
      : mode === 'piece'
        ? toMinor(v) * basePieces
        : toMinor(v);
  return Math.min(gross, Math.max(0, d));
}

/** Both of a line's own discounts: the second on what is left after the first. */
function lineDiscounts(l: Line, gross: number, basePieces: number) {
  const first = lineDiscount(l.discMode, l.discValue, gross, basePieces);
  return first + lineDiscount(l.disc2Mode, l.disc2Value, gross - first, basePieces);
}

/** A line as kept in a draft. */
const keepLine = (l: Line) => ({
  productId: l.product.id,
  sku: l.product.sku,
  unitId: l.unitId,
  quantity: l.quantity,
  price: l.price,
  touched: l.touched,
  bonus: l.bonus,
  discMode: l.discMode,
  discValue: l.discValue,
  disc2Mode: l.disc2Mode,
  disc2Value: l.disc2Value,
  basis: l.basis,
});

/** An invoice discount as typed: a percent or an amount. */
interface DiscountInput {
  mode: 'percent' | 'amount';
  value: string;
}

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:bg-surface-2';

/** A filter above the item search: as wide as its text, not the whole row. */
const filterSelect =
  'h-9 min-w-40 max-w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

let nextKey = 0;

/**
 * Sales / purchase invoice builder, and (mode "quote") the price quotation builder: a quotation is
 * priced the same way but has no payment or delivery, may promise more than is in stock, and moves
 * nothing until it becomes an invoice. Each line is in one of the item's units (piece, carton…); the
 * server prices it (POST /pricing): the party's price list or an offer, else the party's price level
 * (else the default) — not shown on a sale — and, for an item without a price, cost × (1 + default
 * markup) (sales) or the average cost (purchases); on a sale a quantity discount then comes off.
 * A seller may add to a piece's price on this invoice only (sales:raise_price); lowering it or
 * picking another level needs its own permission; the server checks the same.
 * Live cost, markup and profit use the cost of the chosen warehouse's branch. What's typed is kept
 * through an app update (useWorkDraft).
 */
export function InvoiceBuilderPage({
  mode,
  editId,
  readOnly = false,
}: {
  mode: 'sale' | 'purchase' | 'quote';
  /** A saved sales invoice being changed (sales:edit); it is posted again under its number. */
  editId?: string;
  /**
   * The saved invoice `editId` shown on this screen with every line, nothing changeable until
   * "Edit invoice" (owner, 2026-10-19); with its activity log.
   */
  readOnly?: boolean;
}) {
  const isQuote = mode === 'quote';
  const isSale = mode !== 'purchase';
  const backTo = isQuote ? '/sales?tab=quotations' : isSale ? '/sales' : '/purchases';
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();
  /** Cost, markup and profit are the owner's unless given (costs:view); the server sends 0 otherwise. */
  const seeCosts = can('costs:view');
  // Profit has its own permission and the show/hide switch (owner, 2026-10-17).
  const seeProfit = can('profit:view');

  const settings = useCompanySettings();
  const canOverride = can('sales:override_floor');
  const canChangePrice = can(isSale ? 'sales:change_price' : 'purchases:change_price');
  // Adding to a price, on this invoice only (owner decision 2026-09-30).
  const canRaisePrice = isSale && can('sales:raise_price');
  const priceEditable = canChangePrice || canRaisePrice;
  const canChooseLevel = can(isSale ? 'sales:choose_price_level' : 'purchases:choose_price_level');
  const canDiscount = can(isSale ? 'sales:discount' : 'purchases:discount');
  // Sold at the selling price, the customer's last price, or the supply price (owner, 2026-10-01).
  const canPriceBasis = isSale && can('sales:price_basis');
  // The customer's shipping company and address are theirs unless this person may change them.
  const canChangeShipping = can('sales:change_shipping');
  // Discounts appear only when asked for (owner, 2026-10-01).
  const [showDiscount1, setShowDiscount1] = useState(false);
  const [showDiscount2, setShowDiscount2] = useState(false);
  const [lineDiscountOpen, setLineDiscountOpen] = useState<Set<string>>(new Set());
  // Order of the line columns, kept per person.
  const [columnOrder, setColumnOrder] = useHiddenColumns(`order.invoice.${mode}`);
  const [cashAccountId, setCashAccountId] = useState('');
  const isPhone = useDeviceInfo().deviceClass === 'phone';
  const reps = useReps(isSale);
  const me = useAuth((s) => s.user);
  // Every sale has a rep (المندوب): whoever makes it unless another is picked.
  const [pickedRep, setPickedRep] = useState('');
  /** The rep's code while it is being typed (null = show the chosen rep's). */
  const [repCode, setRepCode] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState(companyToday);
  // The day it happened, if it is written later (owner, 2026-10-02).
  const [docDate, setDocDate] = useState(companyToday);
  const repId = pickedRep || ((reps.data ?? []).some((r) => r.id === me?.id) ? (me?.id ?? '') : '');
  const repCodeMissing = !!repCode && !(reps.data ?? []).some((r) => String(r.code) === repCode);
  /** Their discount limit (%); null = none. */
  const maxDiscount = me?.maxDiscountPercent ?? null;

  // Branch, then warehouse, then department (owner decision 2026-10-01): picked by the person, in
  // that order, with no "all"; the invoice can't be saved until all three are chosen.
  const myBranches = me?.branches ?? [];
  // They start at the branch, warehouse and department last picked (owner, 2026-10-02), and
  // picking another here changes it on every screen.
  const [place, setPlace] = useWorkPlace();
  const [pickedBranch, setPickedBranch] = useState(
    isSale && myBranches.length === 1 ? (myBranches[0]?.id ?? '') : '',
  );
  const allWarehouses = useWarehouses(true);
  const branchWarehouses = (allWarehouses.data ?? []).filter(
    (w) => w.kind === 'STORE' && w.isActive && w.branchId === pickedBranch,
  );

  // The sales department (قسم): only the person's own; one of them is picked for them.
  const departmentList = useDepartments();
  const myDepartments = me?.departmentIds ?? null;
  const departments = (departmentList.data ?? []).filter(
    (d) => d.isActive && (!myDepartments || myDepartments.includes(d.id)),
  );
  const [pickedDepartment, setPickedDepartment] = useState('');
  const placeApplied = useRef(false);
  useEffect(() => {
    if (placeApplied.current || editId || !isSale) return;
    if (!place.branchId && !place.warehouseId && !place.departmentId) return;
    placeApplied.current = true;
    if (place.branchId && myBranches.some((b) => b.id === place.branchId))
      setPickedBranch((b) => b || place.branchId);
    if (place.warehouseId) setPickedWarehouse((w) => w || place.warehouseId);
    if (place.departmentId) setPickedDepartment((d) => d || place.departmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.branchId, place.warehouseId, place.departmentId]);
  // Every sale names its department while the company has any (Settings; owner 2026-10-01).
  const departmentRequired =
    isSale && departments.length > 0 && settings.data?.requireDepartment !== false;
  const departmentId = !isSale
    ? ''
    : pickedDepartment && departments.some((d) => d.id === pickedDepartment)
      ? pickedDepartment
      : onlyChoice(departments);

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
    carrierId: '',
  });
  const [party, setParty] = useState<Party | null>(null);
  const partyId = party?.id ?? '';
  // Shipped by a company: the customer's own company and address fill in by themselves.
  const fileCarrier = party?.defaultCarrierId ?? '';
  const fileAddress = party?.shippingAddress || party?.address || '';
  useEffect(() => {
    if (delivery.method !== 'SHIPPING_COMPANY' || !party) return;
    setDelivery((d) => ({
      ...d,
      carrierId: fileCarrier && (!canChangeShipping || !d.carrierId) ? fileCarrier : d.carrierId,
      address: fileAddress && (!canChangeShipping || !d.address) ? fileAddress : d.address,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party?.id, delivery.method]);
  /** A cash customer (عميل نقدي) pays the whole invoice when it is made. */
  const cashCustomer = isSale && !isQuote && !!party?.isCashCustomer;

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
  // A sale's warehouse is picked (no default); a purchase still lands in the branch's by default.
  const warehouseId = isSale
    ? branchWarehouses.some((w) => w.id === pickedWarehouse)
      ? pickedWarehouse
      : onlyChoice(branchWarehouses)
    : pickedWarehouse || defaultWarehouse;
  /** The warehouse's departments (none picked on it = every department). */
  const warehouseDepartments = (allWarehouses.data ?? []).find(
    (w) => w.id === warehouseId,
  )?.departmentIds;
  const shownDepartments = departments.filter(
    (d) => !warehouseDepartments?.length || warehouseDepartments.includes(d.id),
  );
  const departmentOk = !departmentId || shownDepartments.some((d) => d.id === departmentId);
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
  /** Only this supplier's items ("" = every supplier). Picking one lists its items at once. */
  const [supplierFilter, setSupplierFilter] = useState('');
  const [listOpen, setListOpen] = useState(false);
  /** Only this category's items, only items in stock. */
  const [categoryFilter, setCategoryFilter] = useState('');
  const [inStockOnly, setInStockOnly] = useState(isSale && !isQuote);
  const [scanning, setScanning] = useState(false);
  /** How many the next item comes in (كمية), as in the old program; back to 1 after each. */
  const [addQty, setAddQty] = useState('1');
  const [finding, setFinding] = useState(false);
  const suppliers = useParties({ page: 1, pageSize: 100, type: 'SUPPLIER', active: true });
  const productList = useProductSearch(
    search,
    inStockOnly,
    supplierFilter,
    departmentId,
    categoryFilter,
  );
  const searchBox = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<Line[]>([]);
  // Once on the invoice a line is fixed; its pencil opens it to change (owner, 2026-10-02).
  const [openLines, setOpenLines] = useState<Set<string>>(new Set());
  const isOpen = (key: string) => openLines.has(key);
  const toggleLine = (key: string) =>
    setOpenLines((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // Pressing Save with something not done yet says what (owner, 2026-10-02).
  const [showMissing, setShowMissing] = useState(false);
  // What a saved invoice being changed had paid when it was made: it stays paid.
  const [editPaid, setEditPaid] = useState<{ amount: number; accountId: string }>({
    amount: 0,
    accountId: '',
  });
  // Items being prepared before they go on the invoice (owner, 2026-10-01): quantity, unit, price,
  // discount and basis are set here, with the prices to compare, then "Add" puts them all on it.
  const [staged, setStaged] = useState<Line[]>([]);
  // Lines whose second discount was asked for.
  const [second, setSecond] = useState<Set<string>>(new Set());
  // The item whose card is open (clicking its name while making the invoice).
  const [cardOf, setCardOf] = useState<string | null>(null);
  // What each item already has on the invoice (base units), shown in the detailed search.
  const onInvoice = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) {
      const factor = l.product.units.find((u) => u.unitId === l.unitId)?.factor ?? 1;
      m.set(l.product.id, (m.get(l.product.id) ?? 0) + l.quantity * factor);
    }
    return m;
  }, [lines]);
  const [discount1, setDiscount1] = useState<DiscountInput>({ mode: 'percent', value: '' });
  const [discount2, setDiscount2] = useState<DiscountInput>({ mode: 'amount', value: '' });
  // Purchases only: what we pay the supplier now, and the shipping we pay to bring the goods.
  const [paidNow, setPaidNow] = useState('');
  const [paidAccountId, setPaidAccountId] = useState('');
  const [shippingCost, setShippingCost] = useState('');
  const [shippingAccountId, setShippingAccountId] = useState('');
  const [overrideFloor, setOverrideFloor] = useState(false);
  const [notes, setNotes] = useState('');

  const createSale = useCreateSalesInvoice();
  const createPurchase = useCreatePurchaseInvoice();
  const createQuote = useCreateQuotation();
  const createOrder = useCreateOrder();
  const updateSale = useUpdateSalesInvoice();
  // A sale posts at once and the accountant is told, to take the payment (owner decision 2026-09-30).
  // Only someone who may just save pending invoices (sales:order without sales:create) saves one.
  const asOrder = isSale && !isQuote && !can('sales:create') && can('sales:order');
  const pending =
    createSale.isPending ||
    createPurchase.isPending ||
    createQuote.isPending ||
    createOrder.isPending ||
    updateSale.isPending;
  const serverError = (createSale.error ??
    createPurchase.error ??
    createQuote.error ??
    createOrder.error ??
    updateSale.error) as ApiError | null;

  const currency = settings.data?.currency ?? 'EGP';
  const minMarkup = settings.data?.minMarkupPercent ?? 0;
  const defaultMarkup = settings.data?.defaultMarkupPercent ?? 10;
  // Tax isn't typed on invoices (owner, 2026-09-30); the company's default, if any, still applies.
  const effTax = settings.data?.defaultTaxPercent ?? 0;

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
      priceBasis: canPriceBasis && l.basis !== 'LIST' ? l.basis : undefined,
    })),
  };
  const pricing = usePricing(isSale ? 'sale' : 'purchase', pricingInput);
  // The prepared items' prices: the selling, last and cost prices to compare before adding.
  const stagedPricing = usePricing(isSale ? 'sale' : 'purchase', {
    ...pricingInput,
    lines: staged.map((l) => ({
      productId: l.product.id,
      unitId: l.unitId || undefined,
      quantity: l.quantity,
      priceBasis: canPriceBasis && l.basis !== 'LIST' ? l.basis : undefined,
    })),
  });
  const stagedPriced = stagedPricing.data?.lines ?? null;
  const priced = pricing.data && !pricing.isPlaceholderData ? pricing.data.lines : null;
  // (If pricing fails, saving isn't held up: the server checks prices again anyway.)
  const pricingBusy = lines.length > 0 && !pricing.isError && (pricing.isFetching || !priced);
  /** The line's price by the rules (price list, level, else cost), as the server works it out. */
  const listPriceOf = (l: Line, i: number) => priced?.[i]?.unitPrice ?? suggested(l);
  const priceOf = (l: Line, i: number) =>
    l.bonus ? 0 : priceEditable && l.touched ? l.price : listPriceOf(l, i);
  /** A price typed under the list price by someone who may only add to it. */
  const underList = (l: Line, i: number) =>
    !canChangePrice && canRaisePrice && !l.bonus && l.touched && l.price < listPriceOf(l, i);
  /** The line's quantity discount, when its price wasn't typed by hand. */
  const autoDiscountOf = (l: Line, i: number) =>
    l.bonus || (priceEditable && l.touched) ? 0 : (priced?.[i]?.discount ?? 0);

  /** `focus`: back to the search box for the next one (not after the detailed search). */
  function addProduct(p: Product, unitId?: string | null, focus = true, quantity?: number) {
    const unit = unitId ?? p.matchedUnitId ?? p.units[0]?.unitId ?? '';
    const qty = Math.max(1, Math.floor(quantity ?? (Number(addQty) || 1)));
    if (quantity === undefined) setAddQty('1');
    setStaged((prev) => {
      const existing = prev.find((l) => l.product.id === p.id && l.unitId === unit);
      if (existing)
        return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + qty } : l));
      return [
        ...prev,
        {
          key: `l${nextKey++}`,
          product: p,
          unitId: unit,
          quantity: qty,
          price: 0,
          touched: false,
          bonus: false,
          discMode: 'percent',
          discValue: '',
          disc2Mode: 'percent',
          disc2Value: '',
          basis: 'LIST',
        },
      ];
    });
    setSearch('');
    setListOpen(false);
    if (focus) searchBox.current?.focus();
  }

  /** Enter in the search box: a scanned barcode (or a single match) is added at once. */
  async function addFromSearch() {
    const term = search.trim();
    if (!term) return;
    try {
      await lookUp(term);
    } catch {
      /* the dropdown still shows the matches */
    }
  }

  /** Find a barcode / code and add its item; says what was added (for the camera). */
  async function lookUp(term: string): Promise<string | null> {
    const q = new URLSearchParams({ search: term });
    if (supplierFilter) q.set('supplierId', supplierFilter);
    if (departmentId) q.set('departmentId', departmentId);
    const found = await api.get<Product[]>(`/products?${q}`);
    const hit = found.find((p) => p.matchedUnitId) ?? (found.length === 1 ? found[0] : undefined);
    if (!hit) return null;
    addProduct(hit, hit.matchedUnitId);
    return `✓ ${hit.name}`;
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
    const cost = costOf(l.product) * factor; // cost of one line unit at the warehouse's branch
    const gross = l.quantity * price;
    const manual = isSale && !l.bonus ? lineDiscounts(l, gross, l.quantity * factor) : 0;
    // A discount typed on the line replaces its quantity discount.
    const discount = manual > 0 ? manual : autoDiscountOf(l, i);
    const info = l.bonus || (priceEditable && l.touched) ? null : (priced?.[i] ?? null);
    return {
      line: l,
      unit,
      factor,
      price,
      index: i,
      listName: info?.source === 'LIST' ? info.listName : null,
      breakBp: info?.breakBp ?? 0,
      cost,
      gross,
      discount,
      lineTotal: gross - discount,
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
  // Over the customer's purchase limit: unless the person may allow it, the invoice is saved to
  // wait for the accountant to accept or turn it down (owner decision 2026-10-01).
  const overCredit =
    isSale && !isQuote && party?.creditLimit != null && party.balance + grand > party.creditLimit;
  const profitTotal = netTotal - costTotal;
  const marginPct = netTotal > 0 ? (profitTotal / netTotal) * 100 : 0;

  const hasBelowCost = rows.some((r) => r.belowCost);
  const hasBlockedFloor = rows.some((r) => r.belowFloor) && !(overrideFloor && canOverride);
  const hasOverStock = rows.some((r) => r.overStock);
  const hasUnderList = lines.some((l, i) => underList(l, i));
  /** What still has to be done before it can be saved, in the order it is on the screen. */
  const missing: string[] = [
    ...(!partyId ? [t(isSale ? 'invoice.selectCustomer' : 'invoice.selectSupplier')] : []),
    ...(isSale && !isQuote && !editId && !pickedBranch ? [t('invoice.chooseBranch')] : []),
    ...(isSale && !isQuote && !editId && pickedBranch && !warehouseId
      ? [t('invoice.chooseWarehouse')]
      : []),
    ...((departmentRequired && !departmentId) || !departmentOk
      ? [t('invoice.chooseDepartment')]
      : []),
    ...(isSale && !repId ? [t('invoice.chooseRep')] : []),
    ...(isSale && !isQuote && delivery.method === 'SHIPPING_COMPANY' && !delivery.carrierId
      ? [t('delivery.pickCarrier')]
      : []),
    ...(staged.length > 0 ? [t('stage.notAdded')] : []),
    ...(lines.length === 0 && staged.length === 0 ? [t('invoice.noItems')] : []),
    ...(hasBelowCost ? [t('invoice.belowCost')] : []),
    ...(hasBlockedFloor ? [t('invoice.belowFloor')] : []),
    ...(!isQuote && hasOverStock ? [t('invoice.overStock')] : []),
    ...(hasUnderList ? [t('invoice.raiseOnly')] : []),
    ...(outcome.error ? [t('charge.tooBig')] : []),
  ];
  const canSave =
    !!partyId &&
    lines.length > 0 &&
    !hasBelowCost &&
    !hasBlockedFloor &&
    (isQuote || !hasOverStock) &&
    !outcome.error &&
    !(isSale && !isQuote && delivery.method === 'SHIPPING_COMPANY' && !delivery.carrierId) &&
    !(isSale && !repId) &&
    !(departmentRequired && !departmentId) &&
    departmentOk &&
    // A sale names its branch and warehouse (owner decision 2026-10-01).
    !(isSale && !isQuote && !editId && (!pickedBranch || !warehouseId)) &&
    staged.length === 0 &&
    !hasUnderList &&
    !pricingBusy &&
    !pending;

  /** `print`: open the saved invoice and print it (حفظ وطباعة). */
  async function save(print = false) {
    if (!canSave) {
      setShowMissing(true);
      return;
    }
    setShowMissing(false);
    // A change keeps what was paid when the invoice was made (no more than it now comes to).
    const paidAmount = cashCustomer
      ? grand
      : isSale && editId
        ? Math.min(editPaid.amount, grand)
        : isSale || paidNow === ''
          ? 0
          : toMinor(Number(paidNow));
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
            discount: r.discount,
            isBonus: r.line.bonus || undefined,
          })),
          charges: chargeInputs,
          paidAmount: 0,
          overrideFloor,
          notes: notes || undefined,
          warehouseId: warehouseId || undefined,
          priceLevelId,
          repId: repId || undefined,
          departmentId: departmentId || undefined,
        });
        work.finished();
        navigate(backTo);
      } else if (isSale) {
        const input = {
          partyId,
          lines: rows.map((r) => ({
            productId: r.line.product.id,
            unitId: r.line.unitId || undefined,
            quantity: r.line.quantity,
            unitPrice: r.price,
            discount: r.discount,
            isBonus: r.line.bonus || undefined,
            priceBasis: canPriceBasis && r.line.basis !== 'LIST' ? r.line.basis : undefined,
          })),
          charges: chargeInputs,
          paidAmount,
          overrideFloor,
          notes: notes || undefined,
          warehouseId: warehouseId || undefined,
          branchId: editId ? undefined : pickedBranch || undefined,
          priceLevelId,
          repId: repId || undefined,
          departmentId: departmentId || undefined,
          dueDate: dueDate || undefined,
          documentDate: editId || asOrder ? undefined : dayToSend(docDate),
          deliveryMethod: delivery.method,
          deliveryAddress:
            delivery.method !== 'PICKUP' && delivery.address.trim()
              ? delivery.address.trim()
              : undefined,
          carrierId:
            delivery.method === 'SHIPPING_COMPANY' && delivery.carrierId
              ? delivery.carrierId
              : undefined,
          paidAccountId:
            cashCustomer && cashAccountId
              ? cashAccountId
              : editId && paidAmount > 0 && editPaid.accountId
                ? editPaid.accountId
                : undefined,
        };
        const saved = editId
          ? await updateSale.mutateAsync({ id: editId, input })
          : await (asOrder ? createOrder : createSale).mutateAsync(input);
        work.finished();
        // One that waits for the accountant isn't printed yet.
        const waits = asOrder || saved.type === 'SALES_ORDER';
        navigate(`/sales?doc=${saved.id}${print && !waits ? '&print=1' : ''}`);
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
          shippingCost: Number(shippingCost) > 0 ? toMinor(Number(shippingCost)) : undefined,
          shippingAccountId:
            Number(shippingCost) > 0 && shippingAccountId ? shippingAccountId : undefined,
          documentDate: dayToSend(docDate),
        });
        work.finished();
        navigate('/purchases');
      }
    } catch {
      /* surfaced via serverError */
    }
  }

  // What's typed is kept through an app update: the party, choices, lines and totals' inputs.
  // Items and the party are looked up again, so whatever is gone by then is left out.
  const work = useWorkDraft<InvoiceDraft>(
    2,
    () =>
      readOnly || (!party && lines.length === 0 && staged.length === 0 && !notes)
        ? null
        : {
            partyId: party?.id ?? null,
            branchId: pickedBranch,
            warehouseId: pickedWarehouse,
            repId: pickedRep,
            dueDate,
            departmentId: pickedDepartment,
            levelId: pickedLevel,
            delivery,
            lines: lines.map(keepLine),
            staged: staged.map(keepLine),
            discount1,
            discount2,
            paidNow,
            paidAccountId,
            shippingCost,
            shippingAccountId,
            overrideFloor,
            notes,
            supplierFilter,
            categoryFilter,
            inStockOnly,
          },
    async (d) => {
      const text = (v: unknown) => (typeof v === 'string' ? v : '');
      if (d.partyId) {
        const p = await api.get<Party>(`/parties/${d.partyId}`).catch(() => null);
        if (p?.isActive) setParty(p);
      }
      setPickedBranch(text(d.branchId));
      setPickedWarehouse(text(d.warehouseId));
      setPickedRep(text(d.repId));
      setDueDate(text(d.dueDate));
      setPickedDepartment(text(d.departmentId));
      setPickedLevel(text(d.levelId));
      if (d.delivery && METHODS.includes(d.delivery.method))
        setDelivery({
          method: d.delivery.method,
          address: text(d.delivery.address),
          carrierId: text(d.delivery.carrierId),
        });
      const discount = (v: DiscountInput | undefined, fallback: DiscountInput): DiscountInput =>
        v && (v.mode === 'percent' || v.mode === 'amount')
          ? { mode: v.mode, value: text(v.value) }
          : fallback;
      setDiscount1(discount(d.discount1, discount1));
      setDiscount2(discount(d.discount2, discount2));
      setPaidNow(text(d.paidNow));
      setPaidAccountId(text(d.paidAccountId));
      setShippingCost(text(d.shippingCost));
      setShippingAccountId(text(d.shippingAccountId));
      setOverrideFloor(d.overrideFloor === true);
      setNotes(text(d.notes));
      setSupplierFilter(text(d.supplierFilter));
      setCategoryFilter(text(d.categoryFilter));
      if (typeof d.inStockOnly === 'boolean') setInStockOnly(d.inStockOnly);
      const saved = [
        ...(Array.isArray(d.lines) ? d.lines : []),
        ...(Array.isArray(d.staged) ? d.staged : []),
      ];
      const found = new Map<string, Product>();
      await Promise.all(
        [...new Set(saved.map((l) => l.sku).filter(Boolean))].map(async (sku) => {
          const list = await api
            .get<Product[]>(`/products?search=${encodeURIComponent(sku)}`)
            .catch(() => []);
          for (const p of list) found.set(p.id, p);
        }),
      );
      const modes: LineDiscountMode[] = ['percent', 'piece', 'amount'];
      const bases: PriceBasis[] = ['LIST', 'LAST', 'COST'];
      const back = (list: InvoiceDraft['lines'] | undefined): Line[] =>
        (Array.isArray(list) ? list : []).flatMap((l) => {
          const product = found.get(l.productId);
          if (!product || !product.units.some((u) => u.unitId === l.unitId)) return [];
          return [
            {
              key: `l${nextKey++}`,
              product,
              unitId: l.unitId,
              quantity: Math.max(1, Math.floor(Number(l.quantity) || 1)),
              price: Math.max(0, Math.round(Number(l.price) || 0)),
              touched: l.touched === true,
              bonus: l.bonus === true,
              discMode: modes.includes(l.discMode) ? l.discMode : 'percent',
              discValue: text(l.discValue),
              disc2Mode: modes.includes(l.disc2Mode as LineDiscountMode)
                ? (l.disc2Mode as LineDiscountMode)
                : 'percent',
              disc2Value: text(l.disc2Value),
              basis: bases.includes(l.basis as PriceBasis) ? (l.basis as PriceBasis) : 'LIST',
            },
          ];
        });
      setLines(back(d.lines));
      setStaged(back(d.staged));
    },
  );

  // Changing a saved invoice: its customer, choices, lines and discounts fill the screen.
  const [loadingEdit, setLoadingEdit] = useState(!!editId);
  const [editedNumber, setEditedNumber] = useState('');
  const [viewed, setViewed] = useState<SalesDocument | null>(null);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!editId) return;
    let gone = false;
    void (async () => {
      const doc = await api.get<SalesDocument>(`/sales/invoices/${editId}`).catch(() => null);
      if (!doc || gone) {
        setLoadingEdit(false);
        return;
      }
      const [who, items] = await Promise.all([
        api.get<Party>(`/parties/${doc.partyId}`).catch(() => null),
        // The items as the invoice screen lists them (units with their prices), found by code.
        Promise.all(
          [...new Set(doc.lines.map((l) => l.productId))].map(async (id) => {
            const detail = await api.get<{ sku: string }>(`/products/${id}`).catch(() => null);
            if (!detail) return null;
            const found = await api
              .get<Product[]>(`/products?search=${encodeURIComponent(detail.sku)}&limit=20`)
              .catch(() => []);
            return found.find((p) => p.id === id) ?? null;
          }),
        ),
      ]);
      if (gone) return;
      const byId = new Map(items.filter((x): x is Product => !!x).map((x) => [x.id, x]));
      setEditedNumber(doc.number);
      setViewed(doc);
      setEditPaid({ amount: doc.paidAmount, accountId: doc.paidAccountId ?? '' });
      if (who) setParty(who);
      setPickedBranch(doc.branchId);
      setPickedWarehouse(doc.lines[0]?.warehouseId ?? '');
      setPickedRep(doc.repId ?? '');
      setDueDate(doc.dueDate ? doc.dueDate.slice(0, 10) : '');
      setPickedDepartment(doc.departmentId ?? '');
      setDelivery({
        method:
          doc.deliveryMethod && METHODS.includes(doc.deliveryMethod)
            ? doc.deliveryMethod
            : 'PICKUP',
        address: doc.deliveryAddress ?? '',
        carrierId: doc.carrierId ?? '',
      });
      setNotes(doc.notes ?? '');
      const asInput = (kind: ChargeKind): DiscountInput | null => {
        const c = doc.charges.find((x) => x.kind === kind);
        if (!c) return null;
        return c.rate != null
          ? { mode: 'percent', value: String(c.rate) }
          : { mode: 'amount', value: String(toMajor(c.amount)) };
      };
      const d1 = asInput('DISCOUNT');
      const d2 = asInput('EXTRA_DISCOUNT');
      if (d1) {
        setDiscount1(d1);
        setShowDiscount1(true);
      }
      if (d2) {
        setDiscount2(d2);
        setShowDiscount2(true);
      }
      const loaded = doc.lines.flatMap((l) => {
        const product = byId.get(l.productId);
        if (!product || l.isBonus) return [];
        return [
          {
            key: `l${nextKey++}`,
            product,
            unitId: l.unitId ?? product.units[0]?.unitId ?? '',
            quantity: l.unitQuantity || l.quantity,
            price: l.unitPrice,
            touched: true,
            bonus: false,
            discMode: 'amount' as LineDiscountMode,
            discValue: l.discount > 0 ? String(toMajor(l.discount)) : '',
            disc2Mode: 'percent' as LineDiscountMode,
            disc2Value: '',
            basis: 'LIST' as PriceBasis,
          },
        ];
      });
      setLines(loaded);
      setLineDiscountOpen(new Set(loaded.filter((l) => l.discValue).map((l) => l.key)));
      setLoadingEdit(false);
    })();
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  /** Put every prepared item on the invoice. */
  function addStaged() {
    if (staged.some(stagedTooMany)) return;
    setLines((prev) => [...prev, ...staged]);
    setStaged([]);
    searchBox.current?.focus();
  }
  /** Put one prepared item on the invoice; the others stay to be prepared. */
  function addOneStaged(key: string) {
    const one = staged.find((l) => l.key === key);
    if (!one || stagedTooMany(one)) return;
    setLines((prev) => [...prev, one]);
    setStaged((prev) => prev.filter((l) => l.key !== key));
  }
  /** A prepared item asking for more than is left in the warehouse (a sale never goes over). */
  const stagedTooMany = (l: Line) =>
    isSale &&
    !isQuote &&
    l.quantity * (unitOf(l)?.factor ?? 1) >
      available(l.product) - (baseWanted.get(l.product.id) ?? 0);
  const updateStaged = (key: string, patch: Partial<Line>) =>
    setStaged((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function renderStaging() {
    const cell =
      'h-8 rounded-[var(--radius-app)] border border-line bg-surface px-1.5 text-sm outline-none focus:border-brand';
    const money = (v: number | null | undefined) =>
      v == null ? '–' : formatMoney(v, currency, locale);
    return (
      <div className="mt-3 rounded-[var(--radius-app)] border border-brand/40 bg-brand-soft/30 p-2">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <h3 className="text-sm font-semibold">{t('stage.title')}</h3>
          <span className="text-xs text-muted tnum">
            {staged.length} {t('stage.items')}
          </span>
        </div>
        <ul className="space-y-2">
          {staged.map((l, i) => {
            const unit = unitOf(l);
            const factor = unit?.factor ?? 1;
            const info = stagedPriced?.[i];
            const list = info?.listPrice ?? info?.unitPrice ?? suggested(l);
            const ruled = info?.unitPrice ?? suggested(l);
            const price = priceEditable && l.touched ? l.price : ruled;
            const gross = l.quantity * price;
            const manual = isSale ? lineDiscounts(l, gross, l.quantity * factor) : 0;
            const discount =
              manual > 0 ? manual : priceEditable && l.touched ? 0 : (info?.discount ?? 0);
            const total = gross - discount;
            const changed = price !== list;
            const label = 'mb-0.5 block text-[11px] text-muted';
            const left = available(l.product) - (baseWanted.get(l.product.id) ?? 0);
            const tooMany = isSale && !isQuote && l.quantity * factor > left;
            return (
              <li
                key={l.key}
                className="rounded-[var(--radius-app)] border border-line bg-surface p-2"
              >
                {/* What it is, how many, and on which basis. */}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-40 flex-1">
                    <button
                      type="button"
                      className="block max-w-full truncate text-start text-sm font-medium hover:text-brand hover:underline"
                      title={t('itemCard.open')}
                      onClick={() => setCardOf(l.product.id)}
                    >
                      {l.product.name}
                    </button>
                    <span className="text-xs text-faint tnum">{l.product.sku}</span>
                    {/* What is left in the warehouse after the lines already on the invoice. */}
                    <span
                      className={`ms-2 text-xs tnum ${isSale && !isQuote && l.quantity * factor > left ? 'font-semibold text-destructive' : 'text-muted'}`}
                    >
                      {t('invoice.balance')}:{' '}
                      {formatQuantity(Math.max(0, left), l.product.units, locale)}
                    </span>
                  </div>
                  <label className="block">
                    <span className={label}>{t('col.unit')}</span>
                    <select
                      className={`${cell} w-28`}
                      value={l.unitId}
                      disabled={l.product.units.length < 2}
                      onChange={(e) =>
                        updateStaged(l.key, { unitId: e.target.value, touched: false })
                      }
                    >
                      {l.product.units.map((u) => (
                        <option key={u.unitId} value={u.unitId}>
                          {u.name}
                          {u.factor > 1 ? ` (${u.factor})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={label}>{t('col.qty')}</span>
                    <input
                      type="number"
                      min={1}
                      className={`${cell} w-16 tnum`}
                      value={l.quantity}
                      onChange={(e) =>
                        updateStaged(l.key, {
                          quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                        })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addStaged();
                        }
                      }}
                    />
                  </label>
                  {canPriceBasis && (
                    <label className="block">
                      <span className={label}>{t('invoice.priceBasis')}</span>
                      <select
                        className={`${cell} w-32`}
                        value={l.basis}
                        onChange={(e) =>
                          updateStaged(l.key, {
                            basis: e.target.value as PriceBasis,
                            touched: false,
                          })
                        }
                      >
                        {(seeCosts
                          ? (['LIST', 'LAST', 'COST'] as const)
                          : (['LIST', 'LAST'] as const)
                        ).map((b) => (
                          <option key={b} value={b}>
                            {t(`basis.${b}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <Button
                    icon="plus"
                    className="ms-auto"
                    disabled={tooMany}
                    title={tooMany ? t('finder.overStock') : undefined}
                    onClick={() => addOneStaged(l.key)}
                  >
                    {t('stage.addOne')}
                  </Button>
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-md text-muted hover:text-destructive"
                    aria-label={`${t('col.delete')} ${l.product.name}`}
                    onClick={() => setStaged((prev) => prev.filter((x) => x.key !== l.key))}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
                {/* Its prices to compare, the price it goes at, its discount and what it comes to. */}
                <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2 border-t border-line pt-2 text-sm">
                  <span>
                    <span className={label}>{t('col.listPrice')}</span>
                    <span className="tnum">{money(list)}</span>
                  </span>
                  {seeCosts && (
                    <span>
                      <span className={label}>{t('col.cost')}</span>
                      <span className="tnum">
                        {money(info?.unitCost ?? costOf(l.product) * factor)}
                      </span>
                    </span>
                  )}
                  {isSale && (
                    <span>
                      <span className={label}>{t('col.lastPrice')}</span>
                      <span className="tnum">{money(info?.lastPrice)}</span>
                    </span>
                  )}
                  <label className="block">
                    <span className={label}>{t('col.price')}</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      disabled={!priceEditable}
                      className={`${cell} w-24 tnum ${changed ? 'border-warning' : ''}`}
                      value={toMajor(price)}
                      onChange={(e) =>
                        updateStaged(l.key, {
                          price: toMinor(Number(e.target.value) || 0),
                          touched: true,
                        })
                      }
                    />
                  </label>
                  {canDiscount && isSale && (
                    <label className="block">
                      <span className={label}>{t('col.discount')}</span>
                      <span className="flex gap-1">
                        <select
                          className={`${cell} w-20`}
                          value={l.discMode}
                          aria-label={t('col.discount')}
                          onChange={(e) =>
                            updateStaged(l.key, { discMode: e.target.value as LineDiscountMode })
                          }
                        >
                          <option value="percent">%</option>
                          <option value="piece">{t('invoice.perPiece')}</option>
                          <option value="amount">{t('invoice.amountShort')}</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={`${cell} w-20 tnum`}
                          value={l.discValue}
                          onChange={(e) => updateStaged(l.key, { discValue: e.target.value })}
                        />
                      </span>
                    </label>
                  )}
                  {/* A second discount once the first has a value (owner, 2026-10-02). */}
                  {canDiscount &&
                    isSale &&
                    l.discValue &&
                    (l.disc2Value || second.has(l.key) ? (
                      <label className="block">
                        <span className={label}>{t('invoice.lineDiscount2')}</span>
                        <span className="flex gap-1">
                          <select
                            className={`${cell} w-20`}
                            value={l.disc2Mode}
                            aria-label={t('invoice.lineDiscount2')}
                            onChange={(e) =>
                              updateStaged(l.key, { disc2Mode: e.target.value as LineDiscountMode })
                            }
                          >
                            <option value="percent">%</option>
                            <option value="piece">{t('invoice.perPiece')}</option>
                            <option value="amount">{t('invoice.amountShort')}</option>
                          </select>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={`${cell} w-20 tnum`}
                            value={l.disc2Value}
                            onChange={(e) => updateStaged(l.key, { disc2Value: e.target.value })}
                          />
                        </span>
                      </label>
                    ) : (
                      <button
                        type="button"
                        className="h-8 whitespace-nowrap text-xs font-medium text-brand hover:underline"
                        onClick={() => setSecond((x) => new Set(x).add(l.key))}
                      >
                        + {t('invoice.addDiscount2')}
                      </button>
                    ))}
                  <span>
                    <span className={label}>{t('col.afterDiscount')}</span>
                    <span className="tnum">
                      {money(l.quantity > 0 ? Math.round(total / l.quantity) : 0)}
                    </span>
                  </span>
                  <span className="ms-auto text-end">
                    <span className={label}>{t('invoice.lineTotal')}</span>
                    <span className="font-semibold tnum">{money(total)}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setStaged([])}>
            {t('stage.clear')}
          </Button>
          <Button size="sm" icon="plus" disabled={staged.some(stagedTooMany)} onClick={addStaged}>
            {t('stage.addAll')}
          </Button>
        </div>
      </div>
    );
  }

  const products = productList.data ?? [];

  // A line's controls, shared by the table (wide screens) and the cards (phones).
  type Row = (typeof rows)[number];
  const cell =
    'h-8 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand disabled:bg-surface-2';
  /** Amounts in the table without the currency, as on the old grid (the totals show it). */
  const plain = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const unitSelect = (r: Row, className = field) =>
    !isOpen(r.line.key) ? (
      <span className="block py-1.5 text-sm">
        {r.unit?.name}
        {(r.unit?.factor ?? 1) > 1 ? ` (${r.unit?.factor})` : ''}
      </span>
    ) : (
      <select
        className={className}
        value={r.line.unitId}
        disabled={r.line.product.units.length < 2}
        onChange={(e) => updateLine(r.line.key, { unitId: e.target.value, touched: false })}
      >
        {r.line.product.units.map((u) => (
          <option key={u.unitId} value={u.unitId}>
            {u.name}
            {u.factor > 1 ? ` (${u.factor})` : ''}
          </option>
        ))}
      </select>
    );
  const qtyInput = (r: Row, className = `${field} tnum`) =>
    !isOpen(r.line.key) ? (
      <span className="block py-1.5 text-sm font-medium tnum">
        {formatNumber(r.line.quantity, locale)}
      </span>
    ) : (
      <input
        type="number"
        min={1}
        className={className}
        value={r.line.quantity}
        onChange={(e) =>
          updateLine(r.line.key, {
            quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)),
          })
        }
      />
    );
  const priceInput = (r: Row, base = field) =>
    !isOpen(r.line.key) ? (
      <span className="block py-1.5 text-sm tnum">{plain.format(toMajor(r.price))}</span>
    ) : (
      <input
        type="number"
        min={canChangePrice ? 0 : toMajor(suggested(r.line))}
        step="0.01"
        readOnly={!priceEditable || r.line.bonus}
        title={
          canChangePrice
            ? undefined
            : t(canRaisePrice ? 'invoice.raiseOnly' : 'invoice.priceLocked')
        }
        aria-invalid={underList(r.line, r.index)}
        className={`${base} tnum ${priceEditable && !r.line.bonus ? '' : 'bg-surface-2'} ${r.belowCost || underList(r.line, r.index) ? 'border-destructive' : r.belowFloor ? 'border-warning' : ''}`}
        value={toMajor(r.price)}
        onChange={(e) =>
          updateLine(r.line.key, {
            price: Math.max(0, toMinor(Number(e.target.value) || 0)),
            touched: true,
          })
        }
        // Only up: a lower price goes back to the list price.
        onBlur={() => {
          if (underList(r.line, r.index)) updateLine(r.line.key, { touched: false });
        }}
      />
    );
  /** A line's own discount: the value and whether it is a %, per piece or an amount. */
  const discountControls = (r: Row, withLabel: boolean) => (
    <>
      {isSale && !r.line.bonus && (canDiscount || r.line.discValue) && (
        <span className="inline-flex items-center gap-1">
          {withLabel && <span>{t('invoice.lineDiscount')}</span>}
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className="h-7 w-20 rounded-[var(--radius-app)] border border-line bg-surface px-1.5 text-xs text-fg tnum outline-none focus:border-brand disabled:opacity-60"
            aria-label={t('invoice.lineDiscount')}
            disabled={!canDiscount}
            value={r.line.discValue}
            onChange={(e) => updateLine(r.line.key, { discValue: e.target.value })}
          />
          <select
            className="h-7 rounded-[var(--radius-app)] border border-line bg-surface px-1 text-xs text-fg outline-none focus:border-brand disabled:opacity-60"
            aria-label={t('invoice.lineDiscountMode')}
            disabled={!canDiscount}
            value={r.line.discMode}
            onChange={(e) =>
              updateLine(r.line.key, {
                discMode: e.target.value as LineDiscountMode,
              })
            }
          >
            <option value="percent">%</option>
            <option value="piece">{t('invoice.perPiece')}</option>
            <option value="amount">{t('invoice.onLine')}</option>
          </select>
          {/* The second discount shows once the first has a value. */}
          {canDiscount && r.line.discValue && !r.line.disc2Value && !second.has(r.line.key) && (
            <button
              type="button"
              className="whitespace-nowrap text-xs font-medium text-brand hover:underline"
              onClick={() => setSecond((s) => new Set(s).add(r.line.key))}
            >
              + {t('invoice.addDiscount2')}
            </button>
          )}
          {(r.line.disc2Value || second.has(r.line.key)) && (
            <>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className="h-7 w-20 rounded-[var(--radius-app)] border border-line bg-surface px-1.5 text-xs text-fg tnum outline-none focus:border-brand disabled:opacity-60"
                aria-label={t('invoice.lineDiscount2')}
                title={t('invoice.lineDiscount2')}
                disabled={!canDiscount}
                value={r.line.disc2Value}
                onChange={(e) => updateLine(r.line.key, { disc2Value: e.target.value })}
              />
              <select
                className="h-7 rounded-[var(--radius-app)] border border-line bg-surface px-1 text-xs text-fg outline-none focus:border-brand disabled:opacity-60"
                aria-label={t('invoice.lineDiscount2')}
                disabled={!canDiscount}
                value={r.line.disc2Mode}
                onChange={(e) =>
                  updateLine(r.line.key, { disc2Mode: e.target.value as LineDiscountMode })
                }
              >
                <option value="percent">%</option>
                <option value="piece">{t('invoice.perPiece')}</option>
                <option value="amount">{t('invoice.onLine')}</option>
              </select>
            </>
          )}
          {r.discount > 0 && (
            <span className="text-warning">−{formatMoney(r.discount, currency, locale)}</span>
          )}
        </span>
      )}
    </>
  );
  /** Notes under a line: the units it makes, its price list, quantity discount, list price, share of the invoice discount. */
  const lineNotes = (r: Row) => (
    <>
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
      {r.breakBp > 0 && r.discount === autoDiscountOf(r.line, r.index) && r.discount > 0 && (
        <span className="text-positive">
          {t('pl.qtyDiscount')} {formatNumber(r.breakBp / 100, locale)}%: −
          {formatMoney(r.discount, currency, locale)}
        </span>
      )}
      {isPhone && isSale && !r.line.bonus && r.price !== listPriceOf(r.line, r.index) && (
        <span className={underList(r.line, r.index) ? 'text-destructive' : ''}>
          {t('invoice.listPrice')}: {formatMoney(listPriceOf(r.line, r.index), currency, locale)}
        </span>
      )}
      {r.docDiscount > 0 && (
        <span>
          {t('charge.DISCOUNT')}: −{formatMoney(r.docDiscount, currency, locale)}
        </span>
      )}
    </>
  );
  const lineWarning = (r: Row, className = 'mt-2') =>
    readOnly ? null : (
      <>
        {(r.belowCost || r.belowFloor || r.overStock) && (
          <p
            className={`${className} text-xs ${r.belowCost || (r.overStock && !isQuote) ? 'text-destructive' : 'text-warning'}`}
          >
            {r.overStock
              ? `${t('inventory.stock')}: ${formatQuantity(available(r.line.product), r.line.product.units, locale)}`
              : r.belowCost
                ? t('invoice.belowCost')
                : t('invoice.belowFloor')}
          </p>
        )}
      </>
    );

  /** A line's own discount: hidden behind "Add discount" until asked for (owner, 2026-10-01). */
  const lineDiscountCell = (r: Row) => {
    if (!isSale || r.line.bonus) return null;
    if (!isOpen(r.line.key))
      return r.discount > 0 ? (
        <span className="whitespace-nowrap text-xs text-warning tnum">
          −{formatMoney(r.discount, currency, locale)}
        </span>
      ) : null;
    const open = lineDiscountOpen.has(r.line.key) || !!r.line.discValue;
    if (!open)
      return canDiscount ? (
        <button
          type="button"
          className="whitespace-nowrap text-xs font-medium text-brand hover:underline"
          onClick={() => setLineDiscountOpen((s) => new Set(s).add(r.line.key))}
        >
          + {t('invoice.addDiscount')}
        </button>
      ) : null;
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs">
        {discountControls(r, false)}
        {canDiscount && (
          <button
            type="button"
            className="text-faint hover:text-destructive"
            aria-label={t('invoice.removeDiscount')}
            title={t('invoice.removeDiscount')}
            onClick={() => {
              updateLine(r.line.key, { discValue: '', disc2Value: '' });
              setSecond((s) => {
                const next = new Set(s);
                next.delete(r.line.key);
                return next;
              });
              setLineDiscountOpen((s) => {
                const next = new Set(s);
                next.delete(r.line.key);
                return next;
              });
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </span>
    );
  };

  // The lines table (owner, 2026-10-01): stock, selling and supply price, last price, the
  // increase, before and after discount; each column may be hidden and put in its own place.
  type ColumnKey =
    | 'no'
    | 'code'
    | 'item'
    | 'unit'
    | 'balance'
    | 'qty'
    | 'listPrice'
    | 'cost'
    | 'lastPrice'
    | 'price'
    | 'raise'
    | 'beforeDiscount'
    | 'discount'
    | 'afterDiscount'
    | 'profit';
  interface LineColumn {
    key: ColumnKey;
    label: string;
    end?: boolean;
    className?: string;
    cell: (r: Row, i: number) => ReactNode;
  }
  const when = (on: boolean, column: LineColumn): LineColumn[] => (on ? [column] : []);
  const sellingPrice = (r: Row) => priced?.[r.index]?.listPrice ?? listPriceOf(r.line, r.index);
  const lastPrice = (r: Row) => priced?.[r.index]?.lastPrice ?? null;
  const allColumns: LineColumn[] = [
    { key: 'no', label: '#', cell: (_r, i) => <span className="text-muted tnum">{i + 1}</span> },
    {
      key: 'code',
      label: t('col.code'),
      cell: (r) => <span className="whitespace-nowrap tnum">{r.line.product.sku}</span>,
    },
    {
      key: 'item',
      label: t('col.item'),
      className: 'min-w-40',
      cell: (r) => (
        <>
          <button
            type="button"
            className="block text-start font-medium hover:text-brand hover:underline"
            title={t('itemCard.open')}
            onClick={() => setCardOf(r.line.product.id)}
          >
            {r.line.product.name}
          </button>
          <span className="flex flex-wrap gap-x-2 text-xs text-muted tnum">{lineNotes(r)}</span>
          {lineWarning(r, 'mt-1')}
        </>
      ),
    },
    { key: 'unit', label: t('col.unit'), cell: (r) => unitSelect(r, `${cell} w-24`) },
    ...when(isSale, {
      key: 'balance',
      label: t('col.balance'),
      end: true,
      cell: (r) => (
        <span className={r.overStock ? 'text-destructive' : 'text-muted'}>
          {formatQuantity(available(r.line.product), r.line.product.units, locale)}
        </span>
      ),
    }),
    { key: 'qty', label: t('col.qty'), cell: (r) => qtyInput(r, `${cell} w-16 tnum`) },
    ...when(isSale, {
      key: 'listPrice',
      label: t('col.listPrice'),
      end: true,
      cell: (r) => plain.format(toMajor(sellingPrice(r))),
    }),
    ...when(seeCosts, {
      key: 'cost',
      label: t('col.cost'),
      end: true,
      cell: (r) => plain.format(toMajor(r.cost)),
    }),
    ...when(isSale && !!partyId, {
      key: 'lastPrice',
      label: t('col.lastPrice'),
      end: true,
      cell: (r) => (lastPrice(r) != null ? plain.format(toMajor(lastPrice(r)!)) : ''),
    }),
    {
      key: 'price',
      label: isSale ? t('col.price') : t('invoice.receiveCost'),
      cell: (r) => priceInput(r, `${cell} w-24`),
    },
    ...when(isSale, {
      key: 'raise',
      label: t('col.raise'),
      end: true,
      cell: (r) => {
        const up = r.price - sellingPrice(r);
        return up > 0 ? <span className="text-positive">+{plain.format(toMajor(up))}</span> : '';
      },
    }),
    {
      key: 'beforeDiscount',
      label: t('col.beforeDiscount'),
      end: true,
      cell: (r) => plain.format(toMajor(r.gross)),
    },
    ...when(isSale, {
      key: 'discount',
      label: t('col.discount'),
      cell: (r) => lineDiscountCell(r),
    }),
    {
      key: 'afterDiscount',
      label: t('col.afterDiscount'),
      end: true,
      cell: (r) => <span className="font-semibold">{plain.format(toMajor(r.lineTotal))}</span>,
    },
    ...when(isSale && seeProfit, {
      key: 'profit',
      label: t('col.profit'),
      end: true,
      cell: (r) => (
        <span className={r.lineProfit < 0 ? 'text-destructive' : 'text-positive'}>
          {plain.format(toMajor(r.lineProfit))}
        </span>
      ),
    }),
  ];
  const placeOf = (key: string) => {
    const i = columnOrder.indexOf(key);
    return i < 0 ? 1000 + allColumns.findIndex((c) => c.key === key) : i;
  };
  const columns = [...allColumns].sort((a, b) => placeOf(a.key) - placeOf(b.key));
  /** Move a column one place earlier or later; the order is kept per person. */
  function moveColumn(label: string, step: -1 | 1) {
    const keys = columns.map((c) => c.key);
    const at = columns.findIndex((c) => c.label === label);
    const to = at + step;
    if (at < 0 || to < 0 || to >= keys.length) return;
    [keys[at], keys[to]] = [keys[to]!, keys[at]!];
    setColumnOrder(keys);
  }
  /** Put a dragged column where another one is (owner, 2026-10-02: move columns by the mouse). */
  function dropColumn(label: string, target: string) {
    const keys = columns.map((c) => c.key);
    const from = columns.findIndex((c) => c.label === label);
    const to = columns.findIndex((c) => c.label === target);
    if (from < 0 || to < 0) return;
    const [key] = keys.splice(from, 1);
    keys.splice(to, 0, key!);
    setColumnOrder(keys);
  }

  if (loadingEdit)
    return (
      <div className="grid place-items-center py-24 text-muted">
        <Spinner size={26} />
      </div>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          readOnly
            ? `${t('invoice.view')} ${editedNumber}`
            : editId
              ? `${t('invoice.editTitle')} ${editedNumber}`
              : t(isQuote ? 'quote.new' : isSale ? 'invoice.newSale' : 'invoice.newPurchase')
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {readOnly && viewed && (
              <Button variant="secondary" size="sm" icon="print" onClick={() => setPrinting(true)}>
                {t('common.printPdf')}
              </Button>
            )}
            {readOnly && viewed?.status !== 'CANCELLED' && can('sales:edit') && (
              <Button size="sm" onClick={() => navigate(`/sales/invoices/${editId}/edit`)}>
                {t('invoice.edit')}
              </Button>
            )}
            <Button variant="ghost" size="sm" icon="close" onClick={() => navigate(backTo)}>
              {t('invoice.back')}
            </Button>
          </div>
        }
      />
      {printing && viewed && <PrintSetupSheet doc={viewed} onClose={() => setPrinting(false)} />}

      <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
          {/* Left: builder */}
          <div className="min-w-0 space-y-4">
            {/* Party (by code or name) + warehouse (+ a purchase's price level) */}
            <Card className="grid gap-4 sm:grid-cols-2">
              <PartyPicker
                type={isSale ? 'CUSTOMER' : 'SUPPLIER'}
                withCode
                value={party}
                onChange={(p) => {
                  setParty(p);
                  setPickedLevel('');
                }}
                label={t(isSale ? 'invoice.customer' : 'invoice.supplier')}
                placeholder={t(isSale ? 'invoice.selectCustomer' : 'invoice.selectSupplier')}
              />
              {isSale ? (
                // Branch, then its warehouses, then that warehouse's departments (owner, 2026-10-01).
                <>
                  <label className="block">
                    <span className="mb-0.5 block text-xs text-muted">{t('list.branch')}</span>
                    <select
                      className={`${field} ${!pickedBranch ? 'border-warning' : ''}`}
                      value={pickedBranch}
                      disabled={!!editId}
                      aria-invalid={!pickedBranch}
                      onChange={(e) => {
                        setPickedBranch(e.target.value);
                        setPickedWarehouse('');
                        setPickedDepartment('');
                        setPlace({ branchId: e.target.value, warehouseId: '', departmentId: '' });
                      }}
                    >
                      <option value="" disabled>
                        {t('invoice.chooseBranch')}
                      </option>
                      {myBranches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-xs text-muted">{t('list.warehouse')}</span>
                    <select
                      className={`${field} ${pickedBranch && !warehouseId ? 'border-warning' : ''}`}
                      value={warehouseId}
                      disabled={!pickedBranch}
                      aria-invalid={!warehouseId}
                      onChange={(e) => {
                        setPickedWarehouse(e.target.value);
                        setPickedDepartment('');
                        setPlace({
                          branchId: pickedBranch,
                          warehouseId: e.target.value,
                          departmentId: '',
                        });
                      }}
                    >
                      <option value="" disabled>
                        {t('invoice.chooseWarehouse')}
                      </option>
                      {branchWarehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {departments.length > 0 && (
                    <label className="block">
                      <span className="mb-0.5 block text-xs text-muted">
                        {t('invoice.department')}
                      </span>
                      <select
                        className={`${field} ${departmentRequired && warehouseId && !departmentId ? 'border-warning' : ''}`}
                        value={departmentOk ? departmentId : ''}
                        required={departmentRequired}
                        disabled={!warehouseId}
                        aria-invalid={departmentRequired && !departmentId}
                        onChange={(e) => {
                          setPickedDepartment(e.target.value);
                          setPlace({ departmentId: e.target.value });
                        }}
                      >
                        <option value="" disabled={departmentRequired}>
                          {departmentRequired
                            ? t('invoice.chooseDepartment')
                            : t('invoice.noDepartment')}
                        </option>
                        {shownDepartments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              ) : (
                <WarehouseSelect value={warehouseId} onChange={setPickedWarehouse} />
              )}
              {isSale && (
                // The rep by code or by name, like the customer (owner, 2026-10-01).
                <div className="flex items-start gap-2">
                  <label className="block w-24 shrink-0">
                    <span className="mb-0.5 block text-xs text-muted">{t('invoice.code')}</span>
                    <input
                      className={`${field} tnum ${repCodeMissing ? 'border-destructive' : ''}`}
                      inputMode="numeric"
                      aria-label={`${t('invoice.rep')} — ${t('invoice.code')}`}
                      aria-invalid={repCodeMissing}
                      value={repCode ?? String(reps.data?.find((r) => r.id === repId)?.code ?? '')}
                      onChange={(e) => {
                        const text = e.target.value.replace(/[^\d]/g, '');
                        setRepCode(text);
                        const hit = (reps.data ?? []).find((r) => String(r.code) === text);
                        if (hit) setPickedRep(hit.id);
                      }}
                      onBlur={() => setRepCode(null)}
                    />
                    {repCodeMissing && (
                      <span className="mt-0.5 block text-xs text-destructive">
                        {t('invoice.codeNotFound')}
                      </span>
                    )}
                  </label>
                  <label className="block min-w-0 flex-1">
                    <span className="mb-0.5 block text-xs text-muted">{t('invoice.rep')}</span>
                    <select
                      className={field}
                      value={repId}
                      aria-invalid={!repId}
                      onChange={(e) => setPickedRep(e.target.value)}
                    >
                      {!repId && <option value="">{t('invoice.chooseRep')}</option>}
                      {(reps.data ?? []).map((r) => (
                        <option key={r.id} value={r.id}>
                          {codeName(r.code, r.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {!isQuote && !editId && <DocumentDateField value={docDate} onChange={setDocDate} />}
              {isSale && !isQuote && (
                // When a sale on account should be paid (تاريخ الاستحقاق); empty = no date.
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">{t('invoice.dueDate')}</span>
                  <input
                    type="date"
                    className={`${field} tnum`}
                    min={editId ? undefined : companyToday()}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </label>
              )}
            </Card>

            {isSale && !isQuote && (
              <DeliveryCard
                value={delivery}
                onChange={setDelivery}
                party={party ?? undefined}
                carriers={carriers.data?.items ?? []}
                lockCarrier={!canChangeShipping && !!fileCarrier}
                lockAddress={!canChangeShipping && !!fileAddress}
              />
            )}

            {/* Product search */}
            <Card>
              {!readOnly && (
                <>
                  <label className="mb-1.5 block text-sm font-medium text-muted">
                    {t('invoice.addItems')}
                  </label>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <select
                      className={filterSelect}
                      aria-label={t('catalog.supplier')}
                      value={supplierFilter}
                      onChange={(e) => {
                        setSupplierFilter(e.target.value);
                        searchBox.current?.focus();
                      }}
                    >
                      <option value="">{t('invoice.filterSupplier')}</option>
                      {(suppliers.data?.items ?? []).map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {codeName(sp.code, sp.name)}
                        </option>
                      ))}
                    </select>

                    <label className="flex items-center gap-1.5 text-sm text-muted">
                      <input
                        type="checkbox"
                        checked={inStockOnly}
                        onChange={(e) => setInStockOnly(e.target.checked)}
                      />
                      {t('invoice.inStockOnly')}
                    </label>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="mb-0.5 block text-xs text-muted">{t('col.item')}</span>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 start-2.5 grid place-items-center text-faint">
                          <Icon name="search" size={16} />
                        </span>
                        <input
                          ref={searchBox}
                          className={`${field} ps-8`}
                          placeholder={t('invoice.searchHint')}
                          aria-label={t('invoice.searchProduct')}
                          value={search}
                          onChange={(e) => {
                            setSearch(e.target.value);
                            setListOpen(true);
                          }}
                          onClick={() => setListOpen(true)}
                          // Later than a click on a result, so the click still lands.
                          onBlur={() => setTimeout(() => setListOpen(false), 150)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void addFromSearch();
                            } else if (e.key === 'Escape') {
                              setSearch('');
                              setListOpen(false);
                            }
                          }}
                        />
                        {listOpen && (
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
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => addProduct(p)}
                                  className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2"
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium">{p.name}</span>
                                    <span className="text-xs text-muted tnum">
                                      {p.sku}
                                      {p.supplierCode && ` · ${p.supplierCode}`} ·{' '}
                                      {formatQuantity(available(p), p.units, locale)}{' '}
                                      {t('invoice.inStock')}
                                      {seeCosts &&
                                        ` · ${t('invoice.cost')} ${formatMoney(costOf(p), currency, locale)}`}
                                    </span>
                                  </span>
                                  <Icon name="plus" size={16} className="text-brand" />
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <label className="block w-20 shrink-0">
                      <span className="mb-0.5 block text-xs text-muted">{t('col.qty')}</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        className={`${field} text-center tnum`}
                        value={addQty}
                        onChange={(e) => setAddQty(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            searchBox.current?.focus();
                          }
                        }}
                      />
                    </label>
                    <Button
                      variant="secondary"
                      icon="scan"
                      aria-label={t('scan.title')}
                      onClick={() => setScanning(true)}
                    >
                      <span className="hidden sm:inline">{t('scan.button')}</span>
                    </Button>
                    <Button
                      variant="secondary"
                      icon="search"
                      aria-label={t('finder.button')}
                      onClick={() => setFinding(true)}
                    >
                      <span className="hidden lg:inline">{t('finder.button')}</span>
                    </Button>
                  </div>
                  {scanning && (
                    <BarcodeScanner onScan={lookUp} onClose={() => setScanning(false)} />
                  )}
                  {finding && (
                    <ItemFinderSheet
                      departmentId={departmentId || undefined}
                      warehouseId={warehouseId || undefined}
                      branchId={pickedBranch || undefined}
                      lockPlace={isSale && !!warehouseId}
                      inStockFirst={isSale && !isQuote}
                      checkStock={isSale && !isQuote}
                      onInvoice={onInvoice}
                      onClose={() => setFinding(false)}
                      onAdd={(items, close) => {
                        items.forEach((i) => addProduct(i.product, i.unitId, false, i.quantity));
                        if (close) setFinding(false);
                      }}
                    />
                  )}
                </>
              )}
              {cardOf && <ItemLifeSheet productId={cardOf} onClose={() => setCardOf(null)} />}

              {/* Items being prepared (owner, 2026-10-01): set them up, compare prices, then add. */}
              {staged.length > 0 && renderStaging()}

              {/* Clear every item at once (owner, 2026-10-02). */}
              {rows.length > 0 && (
                <div className="ro-hide mt-3 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="close"
                    onClick={async () => {
                      if (!(await confirm({ message: t('invoice.clearLinesAsk'), danger: true })))
                        return;
                      setLines([]);
                      setSecond(new Set());
                    }}
                  >
                    {t('invoice.clearLines')}
                  </Button>
                </div>
              )}

              {/* Lines */}
              {rows.length === 0 ? (
                <p className="mt-4 rounded-[var(--radius-app)] bg-surface-2 p-4 text-center text-sm text-muted">
                  {t('invoice.noItems')}
                </p>
              ) : !isPhone ? (
                // Wide screens: the lines as a table, like the old program's grid.
                <div className="mt-3 overflow-x-auto rounded-[var(--radius-app)] border border-line">
                  <TableColumns id={`invoice.${mode}`} onMove={moveColumn} onDrop={dropColumn}>
                    <table className="w-full text-[13px]">
                      <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                        <tr className="whitespace-nowrap">
                          <th className="w-8" aria-label={t('col.delete')} />
                          {columns.map((c) => (
                            <th
                              key={c.key}
                              className={`px-1.5 py-2 font-medium ${c.end ? 'text-end' : 'text-start'}`}
                            >
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--c-line)]">
                        {rows.map((r, i) => (
                          <tr key={r.line.key} className="align-top">
                            <td className="px-1 py-2">
                              <span className="ro-hide flex gap-0.5">
                                <button
                                  onClick={() => removeLine(r.line.key)}
                                  className="grid h-7 w-7 place-items-center rounded text-faint hover:bg-destructive-soft hover:text-destructive"
                                  aria-label={t('invoice.remove')}
                                  title={t('invoice.remove')}
                                >
                                  <Icon name="close" size={16} />
                                </button>
                                <button
                                  onClick={() => toggleLine(r.line.key)}
                                  className={`grid h-7 w-7 place-items-center rounded hover:bg-surface-2 ${isOpen(r.line.key) ? 'bg-brand-soft text-brand' : 'text-faint'}`}
                                  aria-label={t(
                                    isOpen(r.line.key) ? 'invoice.lineDone' : 'invoice.lineEdit',
                                  )}
                                  title={t(
                                    isOpen(r.line.key) ? 'invoice.lineDone' : 'invoice.lineEdit',
                                  )}
                                  aria-pressed={isOpen(r.line.key)}
                                >
                                  <Icon name={isOpen(r.line.key) ? 'check' : 'edit'} size={15} />
                                </button>
                              </span>
                            </td>
                            {columns.map((c) => (
                              <td
                                key={c.key}
                                className={`px-1.5 py-1.5 ${c.end ? 'whitespace-nowrap pt-2.5 text-end tnum' : ''} ${c.className ?? ''}`}
                              >
                                {c.cell(r, i)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableColumns>
                </div>
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
                            {seeCosts && (
                              <>
                                {t('invoice.cost')} {formatMoney(r.cost, currency, locale)}
                                {r.unit && ` / ${r.unit.name}`}
                              </>
                            )}
                            {isSale && (
                              <>
                                {seeCosts && ' · '}
                                {t('inventory.stock')}:{' '}
                                {formatQuantity(
                                  available(r.line.product),
                                  r.line.product.units,
                                  locale,
                                )}
                              </>
                            )}
                          </p>
                        </div>
                        <span className="ro-hide flex shrink-0 gap-2">
                          <button
                            onClick={() => toggleLine(r.line.key)}
                            className={
                              isOpen(r.line.key) ? 'text-brand' : 'text-faint hover:text-fg'
                            }
                            aria-label={t(
                              isOpen(r.line.key) ? 'invoice.lineDone' : 'invoice.lineEdit',
                            )}
                            aria-pressed={isOpen(r.line.key)}
                          >
                            <Icon name={isOpen(r.line.key) ? 'check' : 'edit'} size={16} />
                          </button>
                          <button
                            onClick={() => removeLine(r.line.key)}
                            className="text-faint hover:text-destructive"
                            aria-label={t('invoice.remove')}
                          >
                            <Icon name="close" size={16} />
                          </button>
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                        <label className="block">
                          <span className="mb-0.5 block text-xs text-muted">
                            {t('invoice.unit')}
                          </span>
                          {unitSelect(r)}
                        </label>
                        <label className="block">
                          <span className="mb-0.5 block text-xs text-muted">
                            {t('invoice.qty')}
                          </span>
                          {qtyInput(r)}
                        </label>
                        <label className="block">
                          <span className="mb-0.5 block text-xs text-muted">
                            {isSale ? t('invoice.price') : t('invoice.receiveCost')}
                          </span>
                          {priceInput(r)}
                        </label>
                        {isSale && seeCosts && (
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
                            {isSale && seeProfit ? t('invoice.lineProfit') : t('common.total')}
                          </span>
                          <div
                            className={`${field} grid items-center tnum ${isSale && seeProfit ? (r.lineProfit < 0 ? 'text-destructive' : 'text-positive') : ''}`}
                          >
                            {formatMoney(
                              isSale && seeProfit ? r.lineProfit : r.lineTotal,
                              currency,
                              locale,
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted tnum">
                        {lineNotes(r)}
                        {lineDiscountCell(r)}
                      </div>

                      {lineWarning(r)}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Right: summary */}
          <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:h-fit lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
            <Card>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                {t('common.total')}
              </h2>
              <dl className="space-y-1.5 text-sm">
                <Row
                  label={t('invoice.subtotal')}
                  value={formatMoney(subtotal, currency, locale)}
                />
                {/* Discounts only when asked for (owner, 2026-10-01). */}
                {(showDiscount1 || discount1.value) && (
                  <DiscountField
                    label={t('charge.DISCOUNT')}
                    value={discount1}
                    onChange={setDiscount1}
                    disabled={!canDiscount}
                    amount={outcome.rows.find((c) => c.kind === 'DISCOUNT')?.amount ?? 0}
                    currency={currency}
                    onRemove={
                      canDiscount
                        ? () => {
                            setDiscount1({ ...discount1, value: '' });
                            setShowDiscount1(false);
                          }
                        : undefined
                    }
                  />
                )}
                {(showDiscount2 || discount2.value) && (
                  <DiscountField
                    label={t('charge.EXTRA_DISCOUNT')}
                    value={discount2}
                    onChange={setDiscount2}
                    disabled={!canDiscount}
                    amount={outcome.rows.find((c) => c.kind === 'EXTRA_DISCOUNT')?.amount ?? 0}
                    currency={currency}
                    onRemove={
                      canDiscount
                        ? () => {
                            setDiscount2({ ...discount2, value: '' });
                            setShowDiscount2(false);
                          }
                        : undefined
                    }
                  />
                )}
                {canDiscount && (!showDiscount1 || !showDiscount2) && (
                  <div className="ro-hide flex flex-wrap gap-x-3 gap-y-1">
                    {!showDiscount1 && !discount1.value && (
                      <button
                        type="button"
                        className="text-xs font-medium text-brand hover:underline"
                        onClick={() => setShowDiscount1(true)}
                      >
                        + {t('invoice.addDiscount')}
                      </button>
                    )}
                    {/* Two discounts, each a percent or an amount; the second once the first has
                      a value (owner, 2026-10-02). */}
                    {!showDiscount2 && !discount2.value && !!discount1.value && (
                      <button
                        type="button"
                        className="text-xs font-medium text-brand hover:underline"
                        onClick={() => setShowDiscount2(true)}
                      >
                        + {t('invoice.addExtraDiscount')}
                      </button>
                    )}
                  </div>
                )}
                {outcome.discount > 0 && (
                  <Row label={t('charge.net')} value={formatMoney(netTotal, currency, locale)} />
                )}
                {isSale &&
                  canDiscount &&
                  maxDiscount !== null &&
                  (showDiscount1 || showDiscount2) && (
                    <p className="text-xs text-faint">
                      {t('invoice.discountLimit')}: <span className="tnum">{maxDiscount}%</span>
                    </p>
                  )}
                {tax > 0 && (
                  <Row label={t('invoice.tax')} value={formatMoney(tax, currency, locale)} />
                )}
                {outcome.error && <p className="text-xs text-destructive">{t('charge.tooBig')}</p>}
                <div className="my-1 border-t border-line" />
                <Row
                  label={t('invoice.grandTotal')}
                  value={formatMoney(grand, currency, locale)}
                  strong
                />
                {isSale && (seeCosts || seeProfit) && (
                  <>
                    <div className="my-1 border-t border-line" />
                    {seeCosts && (
                      <Row
                        label={t('invoice.totalCost')}
                        value={formatMoney(costTotal, currency, locale)}
                      />
                    )}
                    {seeProfit && (
                      <div className="flex items-center justify-between">
                        <dt className="text-muted">{t('invoice.totalProfit')}</dt>
                        <dd
                          className={`font-semibold tnum ${profitTotal < 0 ? 'text-destructive' : 'text-positive'}`}
                        >
                          {formatMoney(profitTotal, currency, locale)}{' '}
                          <span className="text-xs font-normal">({marginPct.toFixed(1)}%)</span>
                        </dd>
                      </div>
                    )}
                  </>
                )}
              </dl>

              <div className="mt-4 space-y-3">
                {cashCustomer && (
                  <div className="space-y-2 rounded-[var(--radius-app)] bg-positive-soft p-2.5">
                    <Row
                      label={`${t('parties.cashCustomer')} — ${t('invoice.paidNow')}`}
                      value={formatMoney(grand, currency, locale)}
                      strong
                    />
                    <MoneyAccountPicker
                      className={field}
                      label={t('money.paidInto')}
                      value={cashAccountId}
                      onChange={setCashAccountId}
                    />
                  </div>
                )}
                {isSale ? null : (
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
                {!isSale && Number(paidNow) > 0 && (
                  <MoneyAccountPicker
                    className={field}
                    label={t('money.paidInto')}
                    value={paidAccountId}
                    onChange={setPaidAccountId}
                  />
                )}
                {!isSale && (
                  <label className="block">
                    <span className="mb-0.5 block text-xs text-muted">
                      {t('invoice.shippingCost')}
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={`${field} tnum`}
                      value={shippingCost}
                      onChange={(e) => setShippingCost(e.target.value)}
                    />
                  </label>
                )}
                {!isSale && Number(shippingCost) > 0 && (
                  <MoneyAccountPicker
                    className={field}
                    label={t('money.paidInto')}
                    value={shippingAccountId}
                    onChange={setShippingAccountId}
                  />
                )}
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">{t('invoice.notes')}</span>
                  <input
                    className={field}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
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

              {overCredit && (
                <p className="mt-3 rounded-[var(--radius-app)] bg-warning-soft p-2 text-xs text-warning">
                  {t('invoice.overCredit')}
                </p>
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
              {showMissing && !canSave && missing.length > 0 && (
                <div
                  role="alert"
                  className="mt-3 rounded-[var(--radius-app)] bg-warning-soft p-2 text-xs text-warning"
                >
                  <p className="font-semibold">{t('invoice.notReady')}</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!readOnly && (
                <div className="mt-4 grid gap-2">
                  <Button
                    className="w-full"
                    icon="check"
                    loading={pending}
                    disabled={pending}
                    onClick={() => void save()}
                  >
                    {pending
                      ? t('invoice.saving')
                      : isQuote
                        ? t('quote.save')
                        : editId
                          ? t('invoice.saveChanges')
                          : t('invoice.save')}
                  </Button>
                  {isSale && !isQuote && !asOrder && (
                    <Button
                      className="w-full"
                      variant="secondary"
                      icon="print"
                      disabled={pending}
                      onClick={() => void save(true)}
                    >
                      {t('invoice.saveAndPrint')}
                    </Button>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      </fieldset>
      {readOnly && editId && (
        <Card>
          <DocumentActivity id={editId} />
        </Card>
      )}
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
  onRemove,
}: {
  label: string;
  value: DiscountInput;
  onChange: (v: DiscountInput) => void;
  disabled: boolean;
  amount: number;
  currency: string;
  onRemove?: () => void;
}) {
  const { t, locale } = useT();
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <dt className="text-muted">{label}</dt>
        <span className="flex items-center gap-2">
          {amount > 0 && (
            <span className="text-xs text-muted tnum">
              −{formatMoney(amount, currency, locale)}
            </span>
          )}
          {onRemove && (
            <button
              type="button"
              className="text-faint hover:text-destructive"
              aria-label={t('invoice.removeDiscount')}
              title={t('invoice.removeDiscount')}
              onClick={onRemove}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          type="number"
          min={0}
          step="0.01"
          disabled={disabled}
          className={`${field} tnum`}
          placeholder="0"
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
        />
        <select
          className={`${field} w-24 px-1.5`}
          disabled={disabled}
          aria-label={label}
          value={value.mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as DiscountInput['mode'] })}
        >
          <option value="percent">{t('charge.percent')}</option>
          <option value="amount">{t('charge.amount')}</option>
        </select>
      </div>
    </div>
  );
}

/** An invoice being written, as kept through an app update. */
interface InvoiceDraft {
  partyId: string | null;
  branchId?: string;
  warehouseId: string;
  repId: string;
  dueDate?: string;
  departmentId: string;
  levelId: string;
  delivery: DeliveryValue;
  lines: {
    productId: string;
    sku: string;
    unitId: string;
    quantity: number;
    price: number;
    touched: boolean;
    bonus: boolean;
    discMode: LineDiscountMode;
    discValue: string;
    disc2Mode?: LineDiscountMode;
    disc2Value?: string;
    basis?: PriceBasis;
  }[];
  /** Items being prepared, not on the invoice yet. */
  staged?: InvoiceDraft['lines'];
  discount1: DiscountInput;
  discount2: DiscountInput;
  paidNow: string;
  paidAccountId: string;
  shippingCost: string;
  shippingAccountId: string;
  overrideFloor: boolean;
  notes: string;
  supplierFilter: string;
  categoryFilter: string;
  inStockOnly: boolean;
}

interface DeliveryValue {
  method: DeliveryMethod;
  address: string;
  carrierId: string;
}

/** Picked up at the office, or sent by a shipping company (the customer pays it directly). */
const METHODS: DeliveryMethod[] = ['PICKUP', 'SHIPPING_COMPANY'];

/** How the goods reach the customer. */
function DeliveryCard({
  value,
  onChange,
  party,
  carriers,
  lockCarrier,
  lockAddress,
}: {
  value: DeliveryValue;
  onChange: (v: DeliveryValue) => void;
  party: Party | undefined;
  carriers: Party[];
  /** From the customer's file, and this person may not change it. */
  lockCarrier?: boolean;
  lockAddress?: boolean;
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
              className={`${field} ${lockAddress ? 'bg-surface-2' : ''}`}
              value={value.address}
              readOnly={lockAddress}
              maxLength={300}
              placeholder={
                party?.shippingAddress || party?.address || t('delivery.addressPlaceholder')
              }
              onChange={(e) => set({ address: e.target.value })}
            />
          </label>
          {
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('delivery.carrier')}</span>
              <select
                className={`${field} ${lockCarrier ? 'bg-surface-2' : ''}`}
                value={value.carrierId}
                disabled={lockCarrier}
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
          }
        </div>
      )}
    </Card>
  );
}
