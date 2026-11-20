import { confirm } from '../lib/confirm';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  applyCharges,
  lineAdjust,
  formatMoney,
  formatNumber,
  formatQuantity,
  toMajor,
  toMinor,
  type ChargeInput,
  type ChargeKind,
  chargeInputOf,
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
import { IncreaseDetails, IncreasesToggle, useIncreaseView } from '../components/Increases';
import { Icon } from '../components/Icon';
import { MoneyAccountPicker } from '../components/MoneyAccountPicker';
import { PartyPicker } from '../components/PartyPicker';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { useT } from '../lib/i18n';
import { useCan, useMayOverride } from '../lib/can';
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
  useCreateOrder,
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
  /** Sold at the selling price, the customer's last price or cost, chosen per item (owner, 2026-10-01). */
  basis: PriceBasis;
  /**
   * The discount the accountant gave this line, on an invoice being changed (owner, 2026-10-24): it
   * stays, following the quantity — so much for so many pieces of the item's smallest unit.
   */
  kept?: { discount: number; pieces: number };
  /**
   * The line's increase and discount as typed (owner, 2026-11-19), each box its own permission. With a
   * discount typed (even 0), it replaces the quantity discount and the kept one.
   */
  adj?: Adj;
}

/**
 * An increase and a discount as typed (owner, 2026-11-19): each as a percent, an amount, and on a
 * line an amount a piece too (the piece boxes are a line's only). Nothing compounds: on a line both
 * percents are of quantity × price, on the invoice of the lines' total, so they net out.
 */
interface Adj {
  iPct: string;
  iAmt: string;
  iPc: string;
  dPct: string;
  dAmt: string;
  dPc: string;
}
const NO_ADJ: Adj = { iPct: '', iAmt: '', iPc: '', dPct: '', dAmt: '', dPc: '' };
const ADJ_KEYS = ['iPct', 'iAmt', 'iPc', 'dPct', 'dAmt', 'dPc'] as const;
/** A percent typed, rounded to 2 decimals, as the server reads it (0 when empty). */
const pctOf = (v: string) => (v.trim() === '' ? 0 : Math.round(Number(v) * 100) / 100 || 0);
const amtOf = (v: string) => (v.trim() === '' ? 0 : Math.max(0, toMinor(Number(v) || 0)));
/** A line's increase (`i`) or discount (`d`) as typed, as `lineAdjust` takes it. */
const adjOf = (a: Adj, k: 'i' | 'd') => ({
  percent: pctOf(a[`${k}Pct`]),
  amount: amtOf(a[`${k}Amt`]),
  perPiece: amtOf(a[`${k}Pc`]),
});
/** Each box's name (a column, and the label of its input). */
const ADJ_LABEL = {
  iPct: 'col.increasePct',
  iAmt: 'col.increaseAmount',
  iPc: 'col.increasePiece',
  dPct: 'col.discountPct',
  dAmt: 'col.discountAmount',
  dPc: 'col.discountPiece',
} as const;
const typedDiscount = (a?: Adj) =>
  !!a && (a.dPct.trim() !== '' || a.dAmt.trim() !== '' || a.dPc.trim() !== '');
/** A saved percent or amount as typed again. */
const asText = (v: number | null | undefined, money = false) =>
  v == null || v === 0 ? '' : String(money ? toMajor(v) : v);

/** A line as kept in a draft. */
const keepLine = (l: Line) => ({
  productId: l.product.id,
  sku: l.product.sku,
  unitId: l.unitId,
  quantity: l.quantity,
  price: l.price,
  touched: l.touched,
  bonus: l.bonus,
  basis: l.basis,
  kept: l.kept,
  adj: l.adj,
});

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:bg-surface-2';

let nextKey = 0;

/**
 * The sales invoice screen (making, changing and viewing one). Each line is in one of the item's
 * units (piece, carton…); the server prices it (POST /pricing): the customer's price list or an
 * offer, else their price level (else the default) — not shown — and, for an item without a price,
 * cost × (1 + default markup); a quantity discount then comes off. Discounts are the accountant's,
 * given from the customer's invoices (owner, 2026-10-24): the ones a changed invoice has stay.
 * A seller may add to a piece's price on this invoice only (sales:raise_price); lowering it or
 * picking another level needs its own permission; the server checks the same.
 * Live cost, markup and profit use the cost of the chosen warehouse's branch. What's typed is kept
 * through an app update (useWorkDraft).
 */
export function InvoiceBuilderPage({
  editId,
  readOnly = false,
}: {
  /** A saved sales invoice being changed (sales:edit); it is posted again under its number. */
  editId?: string;
  /**
   * The saved invoice `editId` shown on this screen with every line, nothing changeable until
   * "Edit invoice" (owner, 2026-10-19); with its activity log.
   */
  readOnly?: boolean;
}) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const owner = useMayOverride();
  // Profit has its own permission and the show/hide switch (owner, 2026-10-17).
  const seeProfit = can('profit:view');
  /**
   * What the goods cost shows on an invoice only to whoever sees its profit (owner, 2026-11-10:
   * "nobody sees the total cost without the profit permission"); the server sends 0 without costs:view.
   */
  const seeCosts = can('costs:view') && seeProfit;
  // Selling at the supply price is still for whoever may see supply prices.
  const mayCostBasis = can('costs:view');

  const settings = useCompanySettings();
  const canOverride = can('sales:override_floor');
  const canChangePrice = can('sales:change_price');
  // Adding to a price, on this invoice only (owner decision 2026-09-30).
  const canRaisePrice = can('sales:raise_price');
  const priceEditable = canChangePrice || canRaisePrice;
  const canChooseLevel = can('sales:choose_price_level');
  // Sold at the selling price, the customer's last price, or the supply price (owner, 2026-10-01).
  const canPriceBasis = can('sales:price_basis');
  // The customer's shipping company and address are theirs unless this person may change them.
  const canChangeShipping = can('sales:change_shipping');
  // A discount or an increase, on an item or the whole invoice, as a percent or an amount (on an
  // item, a piece's too): each box shows for whoever holds its permission, on a new invoice too
  // (owner, 2026-11-19). An amount a piece is an amount.
  const may = {
    line: {
      iPct: can('sales:increase_line_pct'),
      iAmt: can('sales:increase_line_amount'),
      iPc: can('sales:increase_line_amount'),
      dPct: can('sales:discount_line_pct'),
      dAmt: can('sales:discount_line_amount'),
      dPc: can('sales:discount_line_amount'),
    },
    invoice: {
      iPct: can('sales:increase_pct'),
      iAmt: can('sales:increase_amount'),
      iPc: can('sales:increase_amount'),
      dPct: can('sales:discount_pct'),
      dAmt: can('sales:discount_amount'),
      dPc: can('sales:discount_amount'),
    },
  };
  // An increase is discreet (owner, 2026-11-20: the customer may be looking at the screen): prices show
  // with it in, and its boxes and amounts only behind the eye — for whoever may give one (to type it)
  // or see them (with who gave each).
  const increaseView = useIncreaseView(
    !readOnly &&
      (Object.entries(may.line).some(([k, v]) => k[0] === 'i' && v) ||
        Object.entries(may.invoice).some(([k, v]) => k[0] === 'i' && v)),
  );
  const showUp = increaseView.shown;
  // Order of the line columns, kept per person.
  const [columnOrder, setColumnOrder] = useHiddenColumns('order.invoice.sale');
  const [cashAccountId, setCashAccountId] = useState('');
  const isPhone = useDeviceInfo().deviceClass === 'phone';
  const reps = useReps(can('sales:create') || can('sales:edit') || can('sales:order'));
  const me = useAuth((s) => s.user);
  // Every sale has a rep (المندوب): whoever makes it unless another is picked.
  const [pickedRep, setPickedRep] = useState('');
  /** The rep's code while it is being typed (null = show the chosen rep's). */
  const [repCode, setRepCode] = useState<string | null>(null);
  // An invoice has one date, its own (owner, 2026-11-10); one changed keeps the due date it had.
  const [dueDate, setDueDate] = useState('');
  // The day it happened, if it is written later (owner, 2026-10-02).
  const [docDate, setDocDate] = useState(companyToday);
  /** The saved invoice being changed or shown, as it was loaded. */
  const [viewed, setViewed] = useState<SalesDocument | null>(null);
  const repId = pickedRep || ((reps.data ?? []).some((r) => r.id === me?.id) ? (me?.id ?? '') : '');
  const repCodeMissing = !!repCode && !(reps.data ?? []).some((r) => String(r.code) === repCode);

  // Branch, then warehouse, then department (owner decision 2026-10-01): picked by the person, in
  // that order, with no "all"; the invoice can't be saved until all three are chosen.
  const myBranches = me?.branches ?? [];
  // They start at the branch, warehouse and department last picked (owner, 2026-10-02), and
  // picking another here changes it on every screen.
  const [place, setPlace] = useWorkPlace();
  const [pickedBranch, setPickedBranch] = useState(
    myBranches.length === 1 ? (myBranches[0]?.id ?? '') : '',
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
    if (placeApplied.current || editId) return;
    if (!place.branchId && !place.warehouseId && !place.departmentId) return;
    placeApplied.current = true;
    if (place.branchId && myBranches.some((b) => b.id === place.branchId))
      setPickedBranch((b) => b || place.branchId);
    if (place.warehouseId) setPickedWarehouse((w) => w || place.warehouseId);
    if (place.departmentId) setPickedDepartment((d) => d || place.departmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.branchId, place.warehouseId, place.departmentId]);
  // Every sale names its department while the company has any (Settings; owner 2026-10-01).
  const departmentRequired = departments.length > 0 && settings.data?.requireDepartment !== false;
  const departmentId =
    pickedDepartment && departments.some((d) => d.id === pickedDepartment)
      ? pickedDepartment
      : onlyChoice(departments);

  const carriers = useParties({
    page: 1,
    pageSize: 100,
    type: 'CARRIER',
    active: true,
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
  const cashCustomer = !!party?.isCashCustomer;

  // Price level: the customer's own, else the default sales level. Another needs permission.
  const levels = usePriceLevels();
  const sideLevels = (levels.data ?? []).filter((l) => l.side === 'SALE' && l.isActive);
  const partyLevelId = party?.salesPriceLevelId;
  const ownLevel =
    sideLevels.find((l) => l.id === partyLevelId) ??
    sideLevels.find((l) => l.isDefault) ??
    sideLevels[0];
  const [pickedLevel, setPickedLevel] = useState('');
  const levelId = (canChooseLevel && pickedLevel) || ownLevel?.id || '';

  // Goods leave from this warehouse: picked (no default), or the branch's only one.
  const [pickedWarehouse, setPickedWarehouse] = useState('');
  const warehouseId = branchWarehouses.some((w) => w.id === pickedWarehouse)
    ? pickedWarehouse
    : onlyChoice(branchWarehouses);
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
  // What the invoice being changed itself took from this warehouse, per item (base units).
  const tookHere = useMemo(() => {
    const m = new Map<string, number>();
    if (!viewed || viewed.status === 'CANCELLED' || viewed.type !== 'SALES_INVOICE') return m;
    for (const l of viewed.lines)
      if (!warehouseId || l.warehouseId === warehouseId)
        m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity);
    return m;
  }, [viewed, warehouseId]);
  /**
   * Base units of `p` in the chosen warehouse (company total until that list has loaded). An
   * invoice being changed already took its own goods (owner, 2026-11-10): they count as there.
   */
  const available = (p: Product) =>
    (stockHere ? (stockHere.get(p.id)?.qty ?? 0) : p.stockOnHand) + (tookHere.get(p.id) ?? 0);
  /** Cost is per branch: the average cost of one base unit where the goods leave / arrive. */
  const costOf = (p: Product) => stockHere?.get(p.id)?.cost ?? p.costPrice;

  const [search, setSearch] = useState('');
  /** Only this supplier's items ("" = every supplier). Picking one lists its items at once. */
  const [supplierFilter, setSupplierFilter] = useState('');
  // The supplier filter as a picker by code or name (owner, 2026-10-21: a code box before every search).
  const [supplierParty, setSupplierParty] = useState<Party | null>(null);
  // An item by its code alone, added on Enter (owner, 2026-10-21).
  const [itemCode, setItemCode] = useState('');
  const [codeNote, setCodeNote] = useState('');
  const [listOpen, setListOpen] = useState(false);
  /** Only this category's items, only items in stock. */
  const [categoryFilter, setCategoryFilter] = useState('');
  const [inStockOnly, setInStockOnly] = useState(true);
  const [scanning, setScanning] = useState(false);
  /** How many the next item comes in (كمية), as in the old program; empty = 1 (owner, 2026-11-10). */
  const [addQty, setAddQty] = useState('');
  const [finding, setFinding] = useState(false);
  // A supplier brought back with the draft shows in the picker too.
  useEffect(() => {
    if (!supplierFilter || supplierParty?.id === supplierFilter) return;
    void api
      .get<Party>(`/parties/${supplierFilter}`)
      .then(setSupplierParty)
      .catch(() => undefined);
  }, [supplierFilter, supplierParty?.id]);
  const productList = useProductSearch(
    search,
    inStockOnly,
    supplierFilter,
    departmentId,
    categoryFilter,
  );
  const searchBox = useRef<HTMLInputElement>(null);
  /**
   * The prepared item whose quantity takes the cursor next (owner, 2026-11-12: item, then its
   * quantity, then Enter puts it on the invoice and goes back to the search).
   */
  const qtyBoxes = useRef(new Map<string, HTMLInputElement>());
  const [qtyNext, setQtyNext] = useState<{ productId: string; unitId: string } | null>(null);

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
  // The item whose card is open (clicking its name while making the invoice).
  const [cardOf, setCardOf] = useState<string | null>(null);
  // An item's life opens for whoever may see any part of it.
  const seesLife = (
    [
      'inventory:card',
      'products:card_purchases',
      'products:card_sales',
      'products:card_returns',
      'products:card_prices',
    ] as const
  ).some(can);
  // What each item already has on the invoice (base units), shown in the detailed search.
  const onInvoice = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) {
      const factor = l.product.units.find((u) => u.unitId === l.unitId)?.factor ?? 1;
      m.set(l.product.id, (m.get(l.product.id) ?? 0) + l.quantity * factor);
    }
    return m;
  }, [lines]);
  // The invoice's own increase and discount as typed; its second discount (the accountant's, or one
  // over several invoices) as a changed invoice has it.
  const [invoiceAdj, setInvoiceAdj] = useState<Adj>(NO_ADJ);
  const [overrideFloor, setOverrideFloor] = useState(false);
  const [notes, setNotes] = useState('');

  const createSale = useCreateSalesInvoice();
  const createOrder = useCreateOrder();
  const updateSale = useUpdateSalesInvoice();
  // A sale posts at once and the accountant is told, to take the payment (owner decision 2026-09-30).
  // Only someone who may just save pending invoices (sales:order without sales:create) saves one.
  const asOrder = !can('sales:create') && can('sales:order');
  const pending = createSale.isPending || createOrder.isPending || updateSale.isPending;
  const serverError = (createSale.error ??
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
    return Math.round((cost * (100 + Math.max(0, defaultMarkup))) / 100);
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
  const pricing = usePricing('sale', pricingInput);
  // The prepared items' prices: the selling, last and cost prices to compare before adding.
  const stagedPricing = usePricing('sale', {
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

  /**
   * `focus`: where the cursor goes next — the prepared item's quantity, back to the search box (a
   * scanned barcode, so the next scan lands there), or nowhere (the detailed search).
   */
  function addProduct(
    p: Product,
    unitId?: string | null,
    focus: 'qty' | 'search' | false = 'qty',
    quantity?: number,
  ) {
    const unit = unitId ?? p.matchedUnitId ?? p.units[0]?.unitId ?? '';
    const qty = Math.max(1, Math.floor(quantity ?? (Number(addQty) || 1)));
    if (quantity === undefined) setAddQty('');
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
          basis: 'LIST',
        },
      ];
    });
    setSearch('');
    setListOpen(false);
    if (focus === 'qty') setQtyNext({ productId: p.id, unitId: unit });
    else if (focus === 'search') searchBox.current?.focus();
  }

  /** Enter in the search box: a scanned barcode (or a single match) is added at once. */
  async function addFromSearch() {
    const term = search.trim();
    if (!term) return;
    try {
      await lookUp(term, true);
    } catch {
      /* the dropdown still shows the matches */
    }
  }

  /**
   * Find a barcode / code and add its item; says what was added (for the camera). Typed in the
   * search box, the cursor then goes to its quantity, unless a barcode was scanned there.
   */
  async function lookUp(term: string, typed = false): Promise<string | null> {
    const q = new URLSearchParams({ search: term });
    if (supplierFilter) q.set('supplierId', supplierFilter);
    if (departmentId) q.set('departmentId', departmentId);
    const found = await api.get<Product[]>(`/products?${q}`);
    const low = term.toLowerCase();
    // A barcode, else the item whose code was typed in full, else the only match.
    const hit =
      found.find((p) => p.matchedUnitId) ??
      found.find((p) => p.sku.toLowerCase() === low) ??
      (found.length === 1 ? found[0] : undefined);
    if (!hit) return null;
    addProduct(hit, hit.matchedUnitId, typed && !hit.matchedUnitId ? 'qty' : 'search');
    return `✓ ${hit.name}`;
  }

  /** Put the item with this code on the invoice (its own code, the supplier's code or a barcode). */
  async function addByCode() {
    const c = itemCode.trim();
    if (!c) return;
    const q = new URLSearchParams({ search: c });
    if (departmentId) q.set('departmentId', departmentId);
    const found = await api.get<Product[]>(`/products?${q}`).catch(() => [] as Product[]);
    const low = c.toLowerCase();
    const hit =
      found.find((p) => p.sku.toLowerCase() === low) ??
      found.find((p) => (p.supplierCode ?? '').toLowerCase() === low) ??
      found.find((p) => p.matchedUnitId);
    if (!hit) {
      setCodeNote(`${c}: ${t('invoice.codeNotFound')}`);
      return;
    }
    addProduct(hit, hit.matchedUnitId);
    setItemCode('');
    setCodeNote('');
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
    // The line's increase and discount (owner, 2026-11-19): both percents of quantity × price, so
    // they net out; amounts as typed, a piece's times its pieces (the item's smallest unit).
    const a = l.bonus ? undefined : l.adj;
    const pieces = l.quantity * factor;
    const increase = a ? lineAdjust(gross, pieces, adjOf(a, 'i')) : 0;
    const raised = gross + increase;
    // The discount the accountant gave the line stays, following the quantity; it replaces the
    // quantity discount.
    const kept =
      !l.bonus && l.kept
        ? Math.min(raised, Math.round((l.kept.discount * l.quantity * factor) / l.kept.pieces))
        : 0;
    // A discount typed on it: that instead.
    const discount =
      a && typedDiscount(a)
        ? Math.min(raised, lineAdjust(gross, pieces, adjOf(a, 'd')))
        : kept > 0
          ? kept
          : autoDiscountOf(l, i);
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
      increase,
      discount,
      lineTotal: raised - discount,
      lineCost: l.quantity * cost,
    };
  });

  // Invoice charges, in the same order and with the same rounding as the server.
  const round2 = (v: string) => Math.round(Number(v) * 100) / 100;
  const chargeInputs: ChargeInput[] = [];
  // The invoice's increase, then its discount, each a percent, an amount and an amount a piece (in
  // that order); a piece's is times the invoice's pieces (owner, 2026-11-20).
  if (pctOf(invoiceAdj.iPct) > 0)
    chargeInputs.push({ kind: 'INCREASE', percent: pctOf(invoiceAdj.iPct) });
  if (amtOf(invoiceAdj.iAmt) > 0)
    chargeInputs.push({ kind: 'INCREASE', amount: amtOf(invoiceAdj.iAmt) });
  if (amtOf(invoiceAdj.iPc) > 0)
    chargeInputs.push({ kind: 'INCREASE', perPiece: amtOf(invoiceAdj.iPc) });
  if (pctOf(invoiceAdj.dPct) > 0)
    chargeInputs.push({ kind: 'DISCOUNT', percent: pctOf(invoiceAdj.dPct) });
  if (amtOf(invoiceAdj.dAmt) > 0)
    chargeInputs.push({ kind: 'DISCOUNT', amount: amtOf(invoiceAdj.dAmt) });
  if (amtOf(invoiceAdj.dPc) > 0)
    chargeInputs.push({ kind: 'DISCOUNT', perPiece: amtOf(invoiceAdj.dPc) });
  if (effTax > 0) chargeInputs.push({ kind: 'TAX', percent: round2(String(effTax)) });
  // Each line's pieces (its item's smallest unit); free goods take no share.
  const linePieces = pre.map((p) => p.line.quantity * p.factor);
  const invoicePieces = pre.reduce((s, p, i) => s + (p.line.bonus ? 0 : linePieces[i]!), 0);
  const outcome = applyCharges(
    pre.map((p) => p.lineTotal),
    pre.map((p) => !p.line.bonus),
    chargeInputs,
    linePieces,
  );

  const rows = pre.map((p, i) => {
    const docDiscount = outcome.allocation[i] ?? 0;
    const docIncrease = outcome.increaseAllocation[i] ?? 0;
    const net = p.lineTotal + docIncrease - docDiscount; // what the line really brings in
    const lineProfit = net - p.lineCost;
    const netUnit = p.line.quantity > 0 ? net / p.line.quantity : 0;
    const markupPct = p.cost > 0 ? ((netUnit - p.cost) / p.cost) * 100 : 0;
    const floorUnit = Math.round((p.cost * (100 + Math.max(0, minMarkup))) / 100);
    const belowCost = !p.line.bonus && net < p.lineCost;
    const belowFloor = !p.line.bonus && !belowCost && net < p.line.quantity * floorUnit;
    const overStock = (baseWanted.get(p.line.product.id) ?? 0) > available(p.line.product);
    return {
      ...p,
      docDiscount,
      docIncrease,
      net,
      lineProfit,
      markupPct,
      belowCost,
      belowFloor,
      overStock,
    };
  });

  const subtotal = rows.reduce((s, r) => s + r.lineTotal, 0);
  const costTotal = rows.reduce((s, r) => s + r.lineCost, 0);
  const netTotal = subtotal + outcome.increase - outcome.discount;
  const tax = outcome.tax;
  const grand = netTotal + outcome.tax + outcome.addition;
  // Over the customer's purchase limit: unless the person may allow it, the invoice is saved to
  // wait for the accountant to accept or turn it down (owner decision 2026-10-01).
  const overCredit = !owner && party?.creditLeft != null && grand > party.creditLeft;
  const profitTotal = netTotal - costTotal;
  const marginPct = netTotal > 0 ? (profitTotal / netTotal) * 100 : 0;

  // The owner may sell below cost or the floor (owner, 2026-10-22: nothing stops the owner).
  const hasBelowCost = !owner && rows.some((r) => r.belowCost);
  const hasBlockedFloor =
    !owner && rows.some((r) => r.belowFloor) && !(overrideFloor && canOverride);
  const hasOverStock = rows.some((r) => r.overStock);
  const hasUnderList = lines.some((l, i) => underList(l, i));
  /** What still has to be done before it can be saved, in the order it is on the screen. */
  const missing: string[] = [
    ...(!partyId ? [t('invoice.selectCustomer')] : []),
    ...(!editId && !pickedBranch ? [t('invoice.chooseBranch')] : []),
    ...(!editId && pickedBranch && !warehouseId ? [t('invoice.chooseWarehouse')] : []),
    ...((departmentRequired && !departmentId) || !departmentOk
      ? [t('invoice.chooseDepartment')]
      : []),
    ...(!repId ? [t('invoice.chooseRep')] : []),
    ...(delivery.method === 'SHIPPING_COMPANY' && !delivery.carrierId
      ? [t('delivery.pickCarrier')]
      : []),
    ...(staged.length > 0 ? [t('stage.notAdded')] : []),
    ...(lines.length === 0 && staged.length === 0 ? [t('invoice.noItems')] : []),
    ...(hasBelowCost ? [t('invoice.belowCost')] : []),
    ...(hasBlockedFloor ? [t('invoice.belowFloor')] : []),
    ...(hasOverStock ? [t('invoice.overStock')] : []),
    ...(hasUnderList ? [t('invoice.raiseOnly')] : []),
    ...(outcome.error ? [t('charge.tooBig')] : []),
  ];
  const canSave =
    !!partyId &&
    lines.length > 0 &&
    !hasBelowCost &&
    !hasBlockedFloor &&
    !hasOverStock &&
    !outcome.error &&
    !(delivery.method === 'SHIPPING_COMPANY' && !delivery.carrierId) &&
    !!repId &&
    !(departmentRequired && !departmentId) &&
    departmentOk &&
    // A sale names its branch and warehouse (owner decision 2026-10-01).
    !(!editId && (!pickedBranch || !warehouseId)) &&
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
    const paidAmount = cashCustomer ? grand : editId ? Math.min(editPaid.amount, grand) : 0;
    const priceLevelId = canChooseLevel && pickedLevel ? pickedLevel : undefined;
    try {
      const input = {
        partyId,
        lines: rows.map((r) => ({
          productId: r.line.product.id,
          unitId: r.line.unitId || undefined,
          quantity: r.line.quantity,
          unitPrice: r.price,
          discount: r.discount,
          isBonus: r.line.bonus || undefined,
          ...(r.line.adj && !r.line.bonus
            ? {
                increasePercent: pctOf(r.line.adj.iPct) || undefined,
                increaseAmount: amtOf(r.line.adj.iAmt) || undefined,
                increasePerPiece: amtOf(r.line.adj.iPc) || undefined,
                ...(typedDiscount(r.line.adj)
                  ? {
                      discountPercent: pctOf(r.line.adj.dPct),
                      discountAmount: amtOf(r.line.adj.dAmt),
                      discountPerPiece: amtOf(r.line.adj.dPc) || undefined,
                    }
                  : {}),
              }
            : {}),
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
        dueDate: editId ? dueDate || undefined : undefined,
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
              basis: bases.includes(l.basis as PriceBasis) ? (l.basis as PriceBasis) : 'LIST',
              kept:
                l.kept && l.kept.discount > 0 && l.kept.pieces > 0
                  ? { discount: Math.round(l.kept.discount), pieces: Math.round(l.kept.pieces) }
                  : undefined,
              adj:
                l.adj && typeof l.adj === 'object'
                  ? (Object.fromEntries(
                      ADJ_KEYS.map((k) => [k, text(l.adj?.[k])]),
                    ) as unknown as Adj)
                  : undefined,
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
  const [printing, setPrinting] = useState(false);
  const [printPdf, setPrintPdf] = useState(false);
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
      // Its own increase and discount, each a percent, an amount and an amount a piece.
      const typed = (kind: ChargeKind, way: 'rate' | 'amount' | 'piece') => {
        const c = doc.charges
          .map(chargeInputOf)
          .find(
            (x) =>
              x.kind === kind &&
              (way === 'rate'
                ? x.percent !== undefined
                : way === 'piece'
                  ? x.perPiece !== undefined
                  : x.percent === undefined && x.perPiece === undefined),
          );
        return !c
          ? ''
          : way === 'rate'
            ? String(c.percent)
            : asText((way === 'piece' ? c.perPiece : c.amount) ?? 0, true);
      };
      setInvoiceAdj({
        ...NO_ADJ,
        iPct: typed('INCREASE', 'rate'),
        iAmt: typed('INCREASE', 'amount'),
        iPc: typed('INCREASE', 'piece'),
        dPct: typed('DISCOUNT', 'rate'),
        dAmt: typed('DISCOUNT', 'amount'),
        dPc: typed('DISCOUNT', 'piece'),
      });
      // Free goods it already has stay on it (owner, 2026-10-24), though none are added here.
      const loaded = doc.lines.flatMap((l) => {
        const product = byId.get(l.productId);
        if (!product) return [];
        return [
          {
            key: `l${nextKey++}`,
            product,
            unitId: l.unitId ?? product.units[0]?.unitId ?? '',
            quantity: l.unitQuantity || l.quantity,
            price: l.isBonus ? 0 : l.unitPrice,
            touched: true,
            bonus: l.isBonus,
            basis: 'LIST' as PriceBasis,
            ...(l.discountRate != null || l.discountFixed != null || l.discountPiece != null
              ? {}
              : {
                  kept:
                    !l.isBonus && l.discount > 0 && l.quantity > 0
                      ? { discount: l.discount, pieces: l.quantity }
                      : undefined,
                }),
            adj:
              l.isBonus ||
              (l.increaseRate == null &&
                l.increaseFixed == null &&
                l.increasePiece == null &&
                l.discountRate == null &&
                l.discountFixed == null &&
                l.discountPiece == null)
                ? undefined
                : {
                    iPct: asText(l.increaseRate),
                    iAmt: asText(l.increaseFixed, true),
                    iPc: asText(l.increasePiece, true),
                    dPct: asText(l.discountRate),
                    dAmt: asText(l.discountFixed, true),
                    dPc: asText(l.discountPiece, true),
                  },
          },
        ];
      });
      setLines(loaded);
      setLoadingEdit(false);
    })();
    return () => {
      gone = true;
    };
  }, [editId]);

  // The cursor to the quantity of the item just prepared, once it is shown.
  useEffect(() => {
    if (!qtyNext) return;
    const line = staged.find(
      (l) => l.product.id === qtyNext.productId && l.unitId === qtyNext.unitId,
    );
    const box = line && qtyBoxes.current.get(line.key);
    if (!box) return;
    setQtyNext(null);
    box.focus();
    box.select();
  }, [qtyNext, staged]);

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
    searchBox.current?.focus();
  }
  /** A prepared item asking for more than is left in the warehouse (a sale never goes over). */
  const stagedTooMany = (l: Line) =>
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
            const discount = priceEditable && l.touched ? 0 : (info?.discount ?? 0);
            const total = gross - discount;
            const changed = price !== list;
            const label = 'mb-0.5 block text-[0.6875rem] text-muted';
            const left = available(l.product) - (baseWanted.get(l.product.id) ?? 0);
            const tooMany = l.quantity * factor > left;
            return (
              <li
                key={l.key}
                className="rounded-[var(--radius-app)] border border-line bg-surface p-2"
              >
                {/* In the order it is prepared (owner, 2026-11-12): the item, its unit, how many
                    (the box that stands out), its price, then add; one line on a wide screen. */}
                <div className="flex flex-wrap items-end gap-2 lg:flex-nowrap">
                  <div className="min-w-0 basis-full lg:basis-0 lg:flex-1">
                    {seesLife ? (
                      <button
                        type="button"
                        className="block max-w-full truncate text-start text-sm font-medium hover:text-brand hover:underline"
                        title={t('itemCard.open')}
                        onClick={() => setCardOf(l.product.id)}
                      >
                        {l.product.name}
                      </button>
                    ) : (
                      <span className="block max-w-full truncate text-sm font-medium">
                        {l.product.name}
                      </span>
                    )}
                    <span className="text-xs text-faint tnum">{l.product.sku}</span>
                    {/* What is left in the warehouse after the lines already on the invoice. */}
                    <span
                      className={`ms-2 text-xs tnum ${tooMany ? 'font-semibold text-destructive' : 'text-muted'}`}
                    >
                      {t('invoice.balance')}:{' '}
                      {formatQuantity(Math.max(0, left), l.product.units, locale)}
                    </span>
                  </div>
                  <div className="grid min-w-0 basis-full grid-cols-3 items-end gap-2 sm:flex sm:basis-auto">
                    <label className="block min-w-0">
                      <span className={label}>{t('col.unit')}</span>
                      <select
                        className={`${cell} h-10 w-full sm:w-28`}
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
                    <label className="block min-w-0">
                      <span className="mb-0.5 block text-xs font-semibold text-brand">
                        {t('col.qty')}
                      </span>
                      <input
                        ref={(el) => {
                          if (el) qtyBoxes.current.set(l.key, el);
                          else qtyBoxes.current.delete(l.key);
                        }}
                        type="number"
                        min={1}
                        inputMode="numeric"
                        aria-invalid={tooMany}
                        className={`h-10 w-full rounded-[var(--radius-app)] border-2 bg-surface px-2 text-center text-lg font-bold tnum outline-none focus:ring-4 sm:w-24 ${
                          tooMany
                            ? 'border-destructive focus:ring-destructive/25'
                            : 'border-brand focus:ring-brand/25'
                        }`}
                        value={l.quantity}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) =>
                          updateStaged(l.key, {
                            quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addOneStaged(l.key);
                          }
                        }}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className={label}>{t('col.price')}</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        disabled={!priceEditable}
                        className={`${cell} h-10 w-full tnum sm:w-28 ${changed ? 'border-warning' : ''}`}
                        value={toMajor(price)}
                        onChange={(e) =>
                          updateStaged(l.key, {
                            price: toMinor(Number(e.target.value) || 0),
                            touched: true,
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addOneStaged(l.key);
                          }
                        }}
                      />
                    </label>
                  </div>
                  <Button
                    icon="plus"
                    className="h-10 flex-1 sm:flex-none"
                    disabled={tooMany}
                    title={tooMany ? t('finder.overStock') : undefined}
                    onClick={() => addOneStaged(l.key)}
                  >
                    {t('stage.addOne')}
                  </Button>
                  <button
                    type="button"
                    className="grid h-10 w-8 place-items-center rounded-md text-muted hover:text-destructive"
                    aria-label={`${t('col.delete')} ${l.product.name}`}
                    onClick={() => setStaged((prev) => prev.filter((x) => x.key !== l.key))}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
                {/* Its prices to compare, the basis it is priced on, its discount and what it comes to. */}
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
                  <span>
                    <span className={label}>{t('col.lastPrice')}</span>
                    <span className="tnum">{money(info?.lastPrice)}</span>
                  </span>
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
                        {(mayCostBasis
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
      <span className="block py-1.5 text-sm tnum">
        {plain.format(
          toMajor(
            showUp || r.line.bonus || r.line.quantity <= 0 || r.increase + r.docIncrease === 0
              ? r.price
              : Math.round((shownTotal(r) + r.discount) / r.line.quantity),
          ),
        )}
      </span>
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
      {isPhone && !r.line.bonus && r.price !== listPriceOf(r.line, r.index) && (
        <span className={underList(r.line, r.index) ? 'text-destructive' : ''}>
          {t('invoice.listPrice')}: {formatMoney(listPriceOf(r.line, r.index), currency, locale)}
        </span>
      )}
      {showUp && isPhone && r.increase > 0 && (
        <span className="text-positive">
          {t('col.increase')}: +{formatMoney(r.increase, currency, locale)}
        </span>
      )}
      {showUp && r.docIncrease > 0 && (
        <span>
          {t('invoice.shareIncrease')}: +{formatMoney(r.docIncrease, currency, locale)}
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
            className={`${className} text-xs ${r.belowCost || r.overStock ? 'text-destructive' : 'text-warning'}`}
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

  /** What the line's discount comes to: typed, the accountant's, or a quantity discount. */
  const lineDiscountCell = (r: Row) =>
    !r.line.bonus && r.discount > 0 ? (
      <span className="whitespace-nowrap text-xs text-warning tnum">
        −{formatMoney(r.discount, currency, locale)}
      </span>
    ) : null;
  /**
   * One of the line's increase and discount boxes (owner, 2026-11-19): its input while the line is
   * open, for whoever holds its permission; else what it holds.
   */
  const adjBox = (r: Row, k: keyof Adj, className = `${cell} w-20 tnum`) => {
    if (r.line.bonus) return null;
    const a = r.line.adj ?? NO_ADJ;
    const pct = k === 'iPct' || k === 'dPct';
    if (may.line[k] && isOpen(r.line.key))
      return (
        <input
          type="number"
          min={0}
          max={pct ? 100 : undefined}
          step="0.01"
          inputMode="decimal"
          className={className}
          aria-label={t(ADJ_LABEL[k])}
          placeholder={pct ? '%' : '0'}
          value={a[k]}
          onChange={(e) => updateLine(r.line.key, { adj: { ...a, [k]: e.target.value } })}
        />
      );
    const v = pct ? pctOf(a[k]) : amtOf(a[k]);
    return v > 0 ? (
      <span className={k[0] === 'i' ? 'text-positive' : 'text-warning'}>
        {pct ? `${formatNumber(v, locale)}%` : plain.format(toMajor(v))}
      </span>
    ) : (
      ''
    );
  };
  /** A box shows for whoever may use it, and wherever a line has it. */
  const showsBox = (k: keyof Adj) =>
    (k[0] !== 'i' || showUp) &&
    ((may.line[k] && !readOnly) || lines.some((l) => !l.bonus && (l.adj?.[k] ?? '').trim() !== ''));
  /** What a line shows: with its increase and its share of the invoice's in it while they are hidden. */
  const shownTotal = (r: Row) => r.lineTotal + (showUp ? 0 : r.docIncrease);

  /**
   * The invoice's increase (`i`) or discount (`d`) in the totals: what it comes to, and its percent,
   * amount and amount-a-piece boxes for whoever holds each one's permission.
   */
  const invoiceAdjRow = (kind: 'i' | 'd') => {
    const pk = kind === 'i' ? 'iPct' : 'dPct';
    const ak = kind === 'i' ? 'iAmt' : 'dAmt';
    const ck = kind === 'i' ? 'iPc' : 'dPc';
    const amount =
      kind === 'i'
        ? outcome.increase
        : outcome.rows.filter((c) => c.kind === 'DISCOUNT').reduce((sum, c) => sum + c.amount, 0);
    const boxes = readOnly ? [] : [pk, ak, ck].filter((k) => may.invoice[k as keyof Adj]);
    if (boxes.length === 0 && amount === 0) return null;
    const rate = pctOf(invoiceAdj[pk]);
    const each = amtOf(invoiceAdj[ck]);
    // "20.00 × 48 pieces": what an amount a piece comes to.
    const perPiece =
      each > 0
        ? t('charge.perPieceOf')
            .replace('{amount}', formatMoney(each, currency, locale))
            .replace('{pieces}', formatNumber(invoicePieces, locale))
        : '';
    return (
      <div>
        <div className="flex items-center justify-between gap-2">
          <dt className="min-w-0 text-muted">
            {t(kind === 'i' ? 'charge.INCREASE' : 'charge.DISCOUNT')}
            {boxes.length === 0 && rate > 0 ? ` (${formatNumber(rate, locale)}%)` : ''}
            {perPiece && ` (${perPiece})`}
          </dt>
          <dd
            className={`tnum ${amount > 0 ? (kind === 'i' ? 'text-positive' : 'text-warning') : 'text-faint'}`}
          >
            {kind === 'i' ? '+' : '−'}
            {formatMoney(amount, currency, locale)}
          </dd>
        </div>
        {boxes.length > 0 && (
          <div className="mt-1 grid grid-cols-3 gap-2">
            {boxes.map((k) => (
              <label key={k} className="flex min-w-0 items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={k === pk ? 100 : undefined}
                  step="0.01"
                  inputMode="decimal"
                  className={`${field} !h-8 min-w-0 tnum`}
                  aria-label={t(ADJ_LABEL[k as keyof Adj])}
                  placeholder="0"
                  title={t(ADJ_LABEL[k as keyof Adj])}
                  value={invoiceAdj[k as keyof Adj]}
                  onChange={(e) => setInvoiceAdj((v) => ({ ...v, [k]: e.target.value }))}
                />
                <span className="shrink-0 text-xs text-muted">
                  {k === pk ? '%' : k === ck ? `${currency}/${t('invoice.perPiece')}` : currency}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
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
    | 'increasePct'
    | 'increaseAmount'
    | 'increasePiece'
    | 'beforeDiscount'
    | 'discountPct'
    | 'discountAmount'
    | 'discountPiece'
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
          {seesLife ? (
            <button
              type="button"
              className="block text-start font-medium hover:text-brand hover:underline"
              title={t('itemCard.open')}
              onClick={() => setCardOf(r.line.product.id)}
            >
              {r.line.product.name}
            </button>
          ) : (
            <span className="block font-medium">{r.line.product.name}</span>
          )}
          {r.line.bonus && <span className="block text-xs text-muted">{t('invoice.bonus')}</span>}
          <span className="flex flex-wrap gap-x-2 text-xs text-muted tnum">{lineNotes(r)}</span>
          {lineWarning(r, 'mt-1')}
        </>
      ),
    },
    { key: 'unit', label: t('col.unit'), cell: (r) => unitSelect(r, `${cell} w-24`) },
    {
      key: 'balance',
      label: t('col.balance'),
      end: true,
      cell: (r) => (
        <span className={r.overStock ? 'text-destructive' : 'text-muted'}>
          {formatQuantity(available(r.line.product), r.line.product.units, locale)}
        </span>
      ),
    },
    { key: 'qty', label: t('col.qty'), cell: (r) => qtyInput(r, `${cell} w-16 tnum`) },
    {
      key: 'listPrice',
      label: t('col.listPrice'),
      end: true,
      cell: (r) => plain.format(toMajor(sellingPrice(r))),
    },
    ...when(seeCosts, {
      key: 'cost',
      label: t('col.cost'),
      end: true,
      cell: (r) => plain.format(toMajor(r.cost)),
    }),
    ...when(!!partyId, {
      key: 'lastPrice',
      label: t('col.lastPrice'),
      end: true,
      cell: (r) => (lastPrice(r) != null ? plain.format(toMajor(lastPrice(r)!)) : ''),
    }),
    {
      key: 'price',
      label: t('col.price'),
      cell: (r) => priceInput(r, `${cell} w-24`),
    },
    {
      key: 'raise',
      label: t('col.raise'),
      end: true,
      cell: (r) => {
        const up = r.price - sellingPrice(r);
        return up > 0 ? <span className="text-positive">+{plain.format(toMajor(up))}</span> : '';
      },
    },
    ...when(showsBox('iPct'), {
      key: 'increasePct',
      label: t('col.increasePct'),
      end: true,
      cell: (r) => adjBox(r, 'iPct', `${cell} w-16 tnum`),
    }),
    ...when(showsBox('iAmt'), {
      key: 'increaseAmount',
      label: t('col.increaseAmount'),
      end: true,
      cell: (r) => adjBox(r, 'iAmt'),
    }),
    ...when(showsBox('iPc'), {
      key: 'increasePiece',
      label: t('col.increasePiece'),
      end: true,
      cell: (r) => adjBox(r, 'iPc'),
    }),
    {
      key: 'beforeDiscount',
      label: t('col.beforeDiscount'),
      end: true,
      cell: (r) => plain.format(toMajor(shownTotal(r) + r.discount)),
    },
    ...when(showsBox('dPct'), {
      key: 'discountPct',
      label: t('col.discountPct'),
      end: true,
      cell: (r) => adjBox(r, 'dPct', `${cell} w-16 tnum`),
    }),
    ...when(showsBox('dAmt'), {
      key: 'discountAmount',
      label: t('col.discountAmount'),
      end: true,
      cell: (r) => adjBox(r, 'dAmt'),
    }),
    ...when(showsBox('dPc'), {
      key: 'discountPiece',
      label: t('col.discountPiece'),
      end: true,
      cell: (r) => adjBox(r, 'dPc'),
    }),
    {
      key: 'discount',
      label: t('col.discount'),
      cell: (r) => lineDiscountCell(r),
    },
    {
      key: 'afterDiscount',
      label: t('col.afterDiscount'),
      end: true,
      cell: (r) => <span className="font-semibold">{plain.format(toMajor(shownTotal(r)))}</span>,
    },
    ...when(seeProfit, {
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
              : t('invoice.newSale')
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {readOnly && viewed && can('sales:print') && (
              <Button variant="secondary" size="sm" icon="print" onClick={() => setPrinting(true)}>
                {t('common.print')}
              </Button>
            )}
            {readOnly && viewed && can('sales:pdf') && (
              <Button
                variant="secondary"
                size="sm"
                icon="download"
                onClick={() => {
                  setPrintPdf(true);
                  setPrinting(true);
                }}
              >
                {t('common.pdf')}
              </Button>
            )}
            {readOnly && viewed?.status !== 'CANCELLED' && can('sales:edit') && (
              <Button size="sm" onClick={() => navigate(`/sales/invoices/${editId}/edit`)}>
                {t('invoice.edit')}
              </Button>
            )}
            <Button variant="ghost" size="sm" icon="close" onClick={() => navigate('/sales')}>
              {t('invoice.back')}
            </Button>
          </div>
        }
      />
      {printing && viewed && (
        <PrintSetupSheet
          doc={viewed}
          record
          pdf={printPdf}
          onClose={() => {
            setPrinting(false);
            setPrintPdf(false);
          }}
        />
      )}

      <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
          {/* Left: builder */}
          <div className="min-w-0 space-y-4">
            {/* The customer (by code or name), then branch, warehouse and department */}
            <Card className="grid gap-4 sm:grid-cols-2">
              <PartyPicker
                type="CUSTOMER"
                withCode
                value={party}
                onChange={(p) => {
                  setParty(p);
                  setPickedLevel('');
                }}
                label={t('invoice.customer')}
                placeholder={t('invoice.selectCustomer')}
              />
              {/* Branch, then its warehouses, then that warehouse's departments (owner, 2026-10-01). */}
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
              {/* The rep by code or by name, like the customer (owner, 2026-10-01). */}
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
                    {/* The invoice's own rep, when not on the list (no longer active, or the
                          list isn't this person's to see). */}
                    {repId &&
                      viewed?.repId === repId &&
                      !(reps.data ?? []).some((r) => r.id === repId) && (
                        <option value={repId}>{viewed.repName ?? ''}</option>
                      )}
                    {(reps.data ?? []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {codeName(r.code, r.name)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {!editId && <DocumentDateField value={docDate} onChange={setDocDate} />}
            </Card>

            <DeliveryCard
              value={delivery}
              onChange={setDelivery}
              party={party ?? undefined}
              carriers={carriers.data?.items ?? []}
              lockCarrier={!canChangeShipping && !!fileCarrier}
              lockAddress={!canChangeShipping && !!fileAddress}
            />

            {/* Product search */}
            <Card>
              {!readOnly && (
                <>
                  <label className="mb-1.5 block text-sm font-medium text-muted">
                    {t('invoice.addItems')}
                  </label>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1 basis-72">
                      <PartyPicker
                        type="SUPPLIER"
                        withCode
                        value={supplierParty}
                        onChange={(sp) => {
                          setSupplierParty(sp);
                          setSupplierFilter(sp?.id ?? '');
                          searchBox.current?.focus();
                        }}
                        label={t('catalog.supplier')}
                        placeholder={t('invoice.filterSupplier')}
                      />
                    </div>

                    <label className="flex items-center gap-1.5 text-sm text-muted">
                      <input
                        type="checkbox"
                        checked={inStockOnly}
                        onChange={(e) => setInStockOnly(e.target.checked)}
                      />
                      {t('invoice.inStockOnly')}
                    </label>
                  </div>
                  {/* On a phone the item search takes its own line, above the code and quantity. */}
                  <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
                    <label className="block w-28 shrink-0 sm:w-36">
                      <span className="mb-0.5 block text-xs text-muted">
                        {t('invoice.itemCode')}
                      </span>
                      <input
                        className={`${field} tnum`}
                        dir="ltr"
                        value={itemCode}
                        onChange={(e) => {
                          setItemCode(e.target.value);
                          setCodeNote('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void addByCode();
                          }
                        }}
                      />
                    </label>
                    <div className="order-first min-w-0 flex-1 basis-full sm:order-none sm:basis-0">
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
                    <label className="block w-24 shrink-0">
                      <span className="mb-0.5 block text-xs font-semibold text-brand">
                        {t('col.qty')}
                      </span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        placeholder="1"
                        className="h-9 w-full rounded-[var(--radius-app)] border-2 border-brand bg-surface px-2 text-center text-base font-bold tnum outline-none focus:ring-4 focus:ring-brand/25"
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
                  {codeNote && <p className="mt-1 text-xs text-destructive">{codeNote}</p>}
                  {scanning && (
                    <BarcodeScanner onScan={lookUp} onClose={() => setScanning(false)} />
                  )}
                  {finding && (
                    <ItemFinderSheet
                      departmentId={departmentId || undefined}
                      warehouseId={warehouseId || undefined}
                      branchId={pickedBranch || undefined}
                      lockPlace={!!warehouseId}
                      inStockFirst
                      checkStock
                      onInvoice={onInvoice}
                      tookBefore={tookHere}
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
                  <TableColumns id="invoice.sale" onMove={moveColumn} onDrop={dropColumn}>
                    <table className="w-full text-[0.8125rem]">
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
                          <p className="truncate text-sm font-medium">
                            {r.line.product.name}
                            {r.line.bonus && (
                              <span className="ms-1 text-xs font-normal text-muted">
                                ({t('invoice.bonus')})
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted tnum">
                            {seeCosts && (
                              <>
                                {t('invoice.cost')} {formatMoney(r.cost, currency, locale)}
                                {r.unit && ` / ${r.unit.name}`}
                              </>
                            )}
                            {seeCosts && ' · '}
                            {t('inventory.stock')}:{' '}
                            {formatQuantity(
                              available(r.line.product),
                              r.line.product.units,
                              locale,
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
                            {t('invoice.price')}
                          </span>
                          {priceInput(r)}
                        </label>
                        {seeCosts && (
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
                            {seeProfit ? t('invoice.lineProfit') : t('common.total')}
                          </span>
                          <div
                            className={`${field} grid items-center tnum ${seeProfit ? (r.lineProfit < 0 ? 'text-destructive' : 'text-positive') : ''}`}
                          >
                            {formatMoney(
                              seeProfit ? r.lineProfit : shownTotal(r),
                              currency,
                              locale,
                            )}
                          </div>
                        </div>
                      </div>
                      {!r.line.bonus &&
                        isOpen(r.line.key) &&
                        ADJ_KEYS.some((k) => may.line[k] && (k[0] !== 'i' || showUp)) && (
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {ADJ_KEYS.filter((k) => may.line[k] && (k[0] !== 'i' || showUp)).map(
                              (k) => (
                                <label key={k} className="flex flex-col justify-end">
                                  <span className="mb-0.5 block text-xs text-muted">
                                    {t(ADJ_LABEL[k])}
                                  </span>
                                  {adjBox(r, k, `${field} tnum`)}
                                </label>
                              ),
                            )}
                          </div>
                        )}
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
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                  {t('common.total')}
                </h2>
                {increaseView.available && (
                  <IncreasesToggle on={showUp} onChange={increaseView.setShown} />
                )}
              </div>
              {showUp && increaseView.may && viewed && (
                <div className="mb-3">
                  <IncreaseDetails doc={viewed} />
                </div>
              )}
              <dl className="space-y-1.5 text-sm">
                <Row
                  label={t('invoice.subtotal')}
                  value={formatMoney(subtotal + (showUp ? 0 : outcome.increase), currency, locale)}
                />
                {/* The invoice's increase, then its discount (owner, 2026-11-19); the increase
                    only behind the eye (owner, 2026-11-20). */}
                {showUp && invoiceAdjRow('i')}
                {invoiceAdjRow('d')}
                {(outcome.discount > 0 || (showUp && outcome.increase > 0)) && (
                  <Row label={t('charge.net')} value={formatMoney(netTotal, currency, locale)} />
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
                {(seeCosts || seeProfit) && (
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
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">{t('invoice.notes')}</span>
                  <input
                    className={field}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
              </div>

              {rows.some((r) => r.belowFloor) && canOverride && (
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
                      : editId
                        ? t('invoice.saveChanges')
                        : t('invoice.save')}
                  </Button>
                  {!asOrder && can('sales:print') && (
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
    basis?: PriceBasis;
    kept?: { discount: number; pieces: number };
    adj?: Partial<Adj>;
  }[];
  /** Items being prepared, not on the invoice yet. */
  staged?: InvoiceDraft['lines'];
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
