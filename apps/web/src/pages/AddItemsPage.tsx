import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  companyToday,
  formatMoney,
  formatNumber,
  readItemName,
  toMinor,
  type Paginated,
  type Party,
  type Product,
  type PurchaseScan,
} from '@skb/shared';
import { Button, Card, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { PartyPicker } from '../components/PartyPicker';
import { PartySheet } from './PartiesPage';
import { DocumentDateField, dayToSend } from '../components/DocumentDate';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { useAuth } from '../stores/auth';
import { useWorkDraft } from '../lib/workDraft';
import { ItemFinderSheet, type FinderPick } from '../components/ItemFinderSheet';
import { GroupPicker, groupLabel } from '../components/GroupTree';
import { ScanButton } from '../components/ScanButton';
import { api } from '../lib/api';
import { onlyChoice } from '../lib/onlyChoice';
import {
  useCompanySettings,
  useCreateProduct,
  useCreatePurchaseInvoice,
  useDepartments,
  useGroups,
  useNextCode,
  usePriceLevels,
  useSeasons,
  useUnits,
  useUpdateProduct,
  useVariantOptions,
  useWarehouses,
} from '../lib/queries';

/**
 * A place box that shows what state it is in (owner, 2026-10-19: a box not yet chosen looked
 * chosen): chosen = normal, waiting to be chosen = warning edge and faint text, not open yet =
 * faded.
 */
const pickClass = (chosen: boolean, open: boolean) =>
  chosen ? 'border-brand/60' : open ? 'border-warning text-muted' : 'text-faint';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:cursor-not-allowed disabled:border-dashed disabled:bg-transparent disabled:opacity-60';

/** A factory's short name from how it is written: "مصنع JK" → "JK". */
function factoryName(name: string): string {
  return name
    .replace(/^\s*(مصنع|مصانع|شركة|شركه|معرض|مؤسسة|مؤسسه|محل|محلات|factory|company)\s+/i, '')
    .trim();
}

/**
 * A discount or margin, as a percent or an amount (owner, 2026-10-19: each is a button that asks
 * which, and a second one can be added). Percents add up, amounts add up.
 */
interface Adj {
  kind: 'pct' | 'amt';
  value: string;
}

/** One item on the supplier's invoice, as typed; prices are per piece. */
interface NewLine {
  key: string;
  name: string;
  unitId: string;
  sizeId: string;
  colorId: string;
  qty: string;
  costBefore: string;
  /**
   * The supplier's discount, a percent and an amount together (owner, 2026-10-17: "10% and 5
   * pounds more"), and the margin the same way ("10% + 10 pounds"), worked out on the price before
   * the discount and added to the cost after it.
   */
  discounts: Adj[];
  margins: Adj[];
  /** Typed sale price; '' = worked out from the margin. */
  salePrice: string;
  reorder: string;
  /** Size and color are shown only when asked for (owner, 2026-10-17). */
  withVariant?: boolean;
  /**
   * Its department and group of the department's tree (owner, 2026-10-06): read from the name as
   * it is typed, unless chosen by hand (`picked`). '' department = the invoice's.
   */
  departmentId?: string;
  groupId?: string;
  /** Fields the person chose themselves, which the name no longer changes. */
  picked?: ('place' | 'size' | 'color')[];
  /** Set once the item exists, so saving again doesn't make it twice. */
  productId?: string;
  /** The factory's model number read from its invoice, kept as the supplier's code for the item. */
  supplierCode?: string;
  /**
   * An item already in the catalog, bought again (owner, 2026-10-06: one purchase screen): only
   * its quantity, cost and discount are typed; its unit holds `perUnit` pieces and it keeps its
   * own sale price (`existingSale`, per piece).
   */
  existing?: boolean;
  perUnit?: number;
  existingSale?: number;
  /**
   * What it had before (owner, 2026-10-19: bought again, its supplier price, margin, sale price
   * and reorder level can change): its base unit, supplier price per piece and reorder level, so
   * only what was changed is saved back to the item.
   */
  baseUnitId?: string;
  existingCost?: number;
  existingReorder?: number;
  detail?: string;
  /** Bought again from an earlier season: moved to the invoice's season (owner, 2026-10-17). */
  oldSeasonId?: string;
  oldSeasonName?: string;
  moveSeason?: boolean;
}

interface AddItemsDraft {
  supplier: Party | null;
  branch: string;
  warehouse: string;
  department: string;
  season: string;
  lines: NewLine[];
  entry: NewLine;
  invDiscounts: Adj[];
  invMargins: Adj[];
}

const blank = (unitId = ''): NewLine => ({
  key: '',
  name: '',
  unitId,
  sizeId: '',
  colorId: '',
  qty: '1',
  costBefore: '',
  discounts: [],
  margins: [],
  salePrice: '',
  reorder: '',
});

/** Minor units of a typed amount ('' = 0). */
const minor = (v: string) => Math.max(0, toMinor(Number(v) || 0));
/** The percents of a discount or margin added up, and its amounts (minor units). */
const pctOf = (a: Adj[]) =>
  a.filter((x) => x.kind === 'pct').reduce((sum, x) => sum + Math.max(0, Number(x.value) || 0), 0);
const amtOf = (a: Adj[]) =>
  a.filter((x) => x.kind === 'amt').reduce((sum, x) => sum + minor(x.value), 0);

/**
 * Adding items is a purchase invoice (owner decision 2026-10-01): the supplier, where the goods are
 * stored (branch, warehouse, department) and the season, then each item with its cost before the
 * supplier's discount (per piece: a percent and an amount), the margin (a percent and an amount,
 * worked out on the price before the discount and added to the cost after it) and the sale price. Add puts it in the list; Save creates every item
 * and one purchase invoice that puts them in stock at the net cost, less any discount on the whole
 * invoice. A photo can go with each new item and with the invoice itself.
 */
export function AddItemsPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const canDiscount = can('purchases:discount');
  const me = useAuth((s) => s.user);
  const settings = useCompanySettings();
  const currency = settings.data?.currency ?? 'EGP';
  const money = (v: number) => formatMoney(v, currency, locale);

  const units = useUnits();
  const options = useVariantOptions();
  const levels = usePriceLevels();
  const seasons = useSeasons();
  const sizes = (options.data ?? []).filter((o) => o.kind === 'SIZE' && o.isActive);
  const colors = (options.data ?? []).filter((o) => o.kind === 'COLOR' && o.isActive);
  const activeUnits = (units.data ?? []).filter((u) => u.isActive);
  // The unit of one piece, whatever it is called.
  const pieceUnit = activeUnits.find((u) => (u.pieces ?? 1) === 1);
  const saleLevel = (levels.data ?? []).find((l) => l.side === 'SALE' && l.isDefault);
  const purchaseLevel = (levels.data ?? []).find((l) => l.side === 'PURCHASE' && l.isDefault);

  const [supplier, setSupplier] = useState<Party | null>(null);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const myBranches = me?.branches ?? [];
  const [branch, setBranch] = useState(myBranches.length === 1 ? (myBranches[0]?.id ?? '') : '');
  const [warehouse, setWarehouse] = useState('');
  const [department, setDepartment] = useState('');
  const [season, setSeason] = useState('');
  // A supplier's invoice entered late carries its own day (owner, 2026-10-02).
  const [docDate, setDocDate] = useState(companyToday);
  const allWarehouses = useWarehouses(true);
  const branchWarehouses = (allWarehouses.data ?? []).filter(
    (w) => w.kind === 'STORE' && w.isActive && w.branchId === branch,
  );
  const warehouseId = branchWarehouses.some((w) => w.id === warehouse)
    ? warehouse
    : onlyChoice(branchWarehouses);
  const onWarehouse = branchWarehouses.find((w) => w.id === warehouseId)?.departmentIds;
  const departments = (useDepartments().data ?? []).filter(
    (d) => d.isActive && (!onWarehouse?.length || onWarehouse.includes(d.id)),
  );
  // Chosen after the warehouse, not before (it showed chosen while still closed).
  const departmentId = !warehouseId
    ? ''
    : departments.some((d) => d.id === department)
      ? department
      : onlyChoice(departments);
  const allGroups = useGroups().data ?? [];
  const groups = allGroups.filter((g) => departments.some((d) => d.id === g.departmentId));
  const activeSeasons = (seasons.data ?? []).filter((s) => s.isActive);
  const currentSeason = activeSeasons.find((s) => s.isCurrent)?.id ?? '';
  const seasonName = activeSeasons.find((s) => s.id === season)?.name ?? '';
  useEffect(() => {
    if (!season && currentSeason) setSeason(currentSeason);
  }, [season, currentSeason]);

  const [lines, setLines] = useState<NewLine[]>([]);
  const [entry, setEntry] = useState<NewLine>(blank());
  const [editing, setEditing] = useState<string | null>(null);
  // A discount on the whole invoice instead of (or as well as) on each piece (owner, 2026-10-17).
  const [invDiscounts, setInvDiscounts] = useState<Adj[]>([]);
  // A margin for the whole invoice: every new item without its own (owner, 2026-10-19).
  const [invMargins, setInvMargins] = useState<Adj[]>([]);
  // Photos stay on this device until saved: one per line, and the supplier's invoice.
  const [photos, setPhotos] = useState<Record<string, File>>({});
  const [entryPhoto, setEntryPhoto] = useState<File | null>(null);
  // The supplier's invoice, a photo per page (owner, 2026-10-19: one invoice can be several pages).
  const [invoicePhotos, setInvoicePhotos] = useState<File[]>([]);
  useEffect(() => {
    if (!entry.unitId && pieceUnit) setEntry((e) => ({ ...e, unitId: pieceUnit.id }));
  }, [entry.unitId, pieceUnit]);

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const createInvoice = useCreatePurchaseInvoice();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const work = useWorkDraft<AddItemsDraft>(
    3,
    () =>
      lines.length === 0 && !entry.name
        ? null
        : {
            supplier,
            branch,
            warehouse,
            department,
            season,
            lines,
            entry,
            invDiscounts,
            invMargins,
          },
    (d) => {
      if (d.supplier && typeof d.supplier.id === 'string') setSupplier(d.supplier);
      if (typeof d.branch === 'string') setBranch(d.branch);
      if (typeof d.warehouse === 'string') setWarehouse(d.warehouse);
      if (typeof d.department === 'string') setDepartment(d.department);
      if (typeof d.season === 'string') setSeason(d.season);
      if (Array.isArray(d.lines)) setLines(d.lines.filter((l) => l && typeof l.name === 'string'));
      if (d.entry && typeof d.entry.name === 'string') setEntry({ ...blank(), ...d.entry });
      if (Array.isArray(d.invDiscounts)) setInvDiscounts(d.invDiscounts);
      if (Array.isArray(d.invMargins)) setInvMargins(d.invMargins);
    },
  );

  /** A line's per-piece figures (minor units) and its pieces. */
  function figures(l: NewLine) {
    const before = minor(l.costBefore);
    const rawDiscount = canDiscount
      ? Math.round((before * pctOf(l.discounts)) / 100) + amtOf(l.discounts)
      : 0;
    const discount = Math.min(before, rawDiscount);
    const after = before - discount;
    // The margin is worked out on the supplier's price before the discount, and the discount
    // counts as part of it (owner, 2026-10-18): 505 less 10% with a 13% margin sells at
    // 454.50 + 65.65 = 520.15 (3% over the list price); an 8% margin sells at 494.90 (2% under).
    // …rounded up to a whole pound (owner, 2026-10-18): 520.15 sells at 521.
    // A new item without its own margin takes the invoice's.
    const margins = l.margins.length || l.existing ? l.margins : invMargins;
    const marginSale =
      Math.ceil((after + Math.round((before * pctOf(margins)) / 100) + amtOf(margins)) / 100) * 100;
    // Bought again: its own sale price stays unless a new price or margin is typed.
    const sale =
      l.salePrice !== ''
        ? minor(l.salePrice)
        : l.existing && !l.margins.length
          ? (l.existingSale ?? 0)
          : marginSale;
    const perUnit = l.existing
      ? (l.perUnit ?? 1)
      : (activeUnits.find((u) => u.id === l.unitId)?.pieces ?? 1);
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
    return { before, discount, after, sale, perUnit, qty, pieces: qty * perUnit };
  }
  const f = figures(entry);
  const entryOk = !!entry.name.trim() && f.qty > 0 && f.before > 0 && !!entry.unitId;
  // New items need their own permissions; buying items already in the catalog does not.
  const canNewItems = can('products:create') && can('prices:edit');
  const canMoveSeason = can('products:edit');
  const canPrices = can('prices:edit');
  const canEditItems = can('products:edit');
  // Sale totals and profit on a purchase are profit figures (owner, 2026-10-19).
  const seeProfit = can('profit:view');
  /** "10% + 5 ج.م" — a discount or margin as typed. */
  const adjText = (a: Adj[]) =>
    [pctOf(a) > 0 ? `${formatNumber(pctOf(a), locale)}%` : '', amtOf(a) > 0 ? money(amtOf(a)) : '']
      .filter(Boolean)
      .join(' + ');
  const [finding, setFinding] = useState(false);

  /** A line for an item already in the catalog. */
  function existingLine(p: Product, unitId: string, quantity: number, key: string): NewLine {
    const unit = p.units.find((u) => u.unitId === unitId) ?? p.units[0];
    const perUnit = unit?.factor ?? 1;
    const fromOldSeason = !!season && p.seasonId !== season;
    return {
      ...blank(unit?.unitId ?? unitId),
      key,
      name: p.name,
      qty: String(quantity || 1),
      costBefore: p.costPrice > 0 ? String(p.costPrice / 100) : '',
      productId: p.id,
      existing: true,
      perUnit,
      existingSale: p.salePrice,
      baseUnitId: p.units[0]?.unitId,
      existingCost: p.costPrice,
      existingReorder: p.reorderLevel,
      reorder: String(p.reorderLevel ?? ''),
      detail: [p.sku, p.sizeName, p.colorName, unit?.name].filter(Boolean).join(' · '),
      oldSeasonId: p.seasonId ?? '',
      oldSeasonName: p.seasonName ?? '',
      moveSeason: fromOldSeason && canMoveSeason,
    };
  }
  function addExisting(items: FinderPick[]) {
    setLines((prev) => [
      ...prev,
      ...items.map((i, n) =>
        existingLine(i.product, i.unitId, i.quantity, `${Date.now()}-${prev.length + n}`),
      ),
    ]);
  }

  // Opened from an item ("add stock", owner 2026-10-18): that item is ready to be bought again.
  const [params] = useSearchParams();
  const asked = params.get('item');
  const took = useRef(false);
  useEffect(() => {
    if (!asked || took.current || seasons.isLoading || (currentSeason && !season)) return;
    took.current = true;
    void (async () => {
      const detail = await api.get<{ sku: string }>(`/products/${asked}`).catch(() => null);
      if (!detail) return;
      const hits = await api
        .get<Product[]>(`/products?limit=10&search=${encodeURIComponent(detail.sku)}`)
        .catch(() => [] as Product[]);
      const p = hits.find((h) => h.id === asked);
      if (p) setEntry(existingLine(p, p.units[0]?.unitId ?? '', 1, ''));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, seasons.isLoading, season]);

  /**
   * A supplier invoice read from a photo (owner, 2026-10-06): the supplier when found, each line as
   * the item it names when the search finds one, else as a new item read like a typed name. The
   * person checks every line before saving.
   */
  const [scanNote, setScanNote] = useState<string | null>(null);
  /**
   * An item already bought: by the factory's model number (its supplier code) from this supplier,
   * else by exactly the same name. A near match isn't taken: it could be another model.
   */
  async function findBought(model: string | null, name: string, supplierId?: string) {
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const search = (text: string) =>
      api.get<Product[]>(`/products?limit=10&search=${encodeURIComponent(text)}`);
    if (model) {
      const hit = (await search(model)).find(
        (p) =>
          !!p.supplierCode &&
          same(p.supplierCode, model) &&
          (!supplierId || !p.supplierId || p.supplierId === supplierId),
      );
      if (hit) return hit;
    }
    return (await search(name)).find((p) => same(p.name, name));
  }

  async function fromScan(scan: PurchaseScan) {
    let from = supplier;
    if (!from && scan.supplierName) {
      const found = await api.get<Paginated<Party>>(
        `/parties?page=1&pageSize=5&search=${encodeURIComponent(scan.supplierName)}`,
      );
      const match = found.items.find((p) => p.types.includes('SUPPLIER'));
      if (match) {
        setSupplier(match);
        from = match;
      }
    }
    // A handwritten invoice often leaves the item blank and gives the model number (owner,
    // 2026-10-19): the item is named from the factory and the model, e.g. "JK موديل 255".
    const brand = factoryName(from?.name ?? scan.supplierName ?? '');
    const picks: FinderPick[] = [];
    const fresh: NewLine[] = [];
    for (const [n, l] of scan.lines.entries()) {
      const name =
        l.name.trim() ||
        [brand, l.model ? `${t('additems.modelWord')} ${l.model}` : ''].filter(Boolean).join(' ');
      if (!name) continue;
      const hit = await findBought(l.model, name, from?.id);
      const qty = Math.max(1, Math.round(l.quantity));
      if (hit) {
        picks.push({
          product: { ...hit, costPrice: toMinor(l.unitPrice) },
          unitId: hit.units[0]?.unitId ?? '',
          quantity: qty,
        });
      } else if (canNewItems && pieceUnit) {
        const read = readItemName(name, { departments, groups, sizes, colors });
        fresh.push({
          ...blank(pieceUnit.id),
          key: `${Date.now()}-scan-${n}`,
          name,
          supplierCode: l.model ?? undefined,
          qty: String(qty),
          costBefore: l.unitPrice ? String(l.unitPrice) : '',
          discounts: l.discount ? [{ kind: 'amt', value: String(l.discount) }] : [],
          departmentId: read.departmentId ?? '',
          groupId: read.groupId ?? '',
        });
      }
    }
    if (picks.length) addExisting(picks);
    if (fresh.length) setLines((prev) => [...prev, ...fresh]);
    // The discount written under the total goes on the whole invoice.
    if (canDiscount && scan.discount > 0 && !amtOf(invDiscounts))
      setInvDiscounts((cur) =>
        [...cur, { kind: 'amt' as const, value: String(scan.discount) }].slice(0, 2),
      );
    setScanNote(t('assistant.scanned').replace('{n}', String(picks.length + fresh.length)));
  }

  function addEntry() {
    if (!entryOk) return;
    const key = editing ?? `${Date.now()}-${lines.length}`;
    if (editing) {
      setLines((prev) => prev.map((l) => (l.key === editing ? { ...entry, key } : l)));
      setEditing(null);
    } else setLines((prev) => [...prev, { ...entry, key }]);
    if (entryPhoto) setPhotos((p) => ({ ...p, [key]: entryPhoto }));
    setEntryPhoto(null);
    // The next item keeps the unit and the margin.
    setEntry({
      ...blank(entry.unitId),
      margins: entry.existing ? [] : entry.margins,
    });
  }

  const rows = lines.map((l) => ({ l, ...figures(l) }));
  const subtotal = rows.reduce((s, r) => s + r.pieces * r.after, 0);
  const invDiscount = canDiscount
    ? Math.min(subtotal, Math.round((subtotal * pctOf(invDiscounts)) / 100) + amtOf(invDiscounts))
    : 0;
  const total = subtotal - invDiscount;
  const pieces = rows.reduce((s, r) => s + r.pieces, 0);
  // What it all sells for and what is made on it (owner, 2026-10-19), for whoever may see profit.
  const saleTotal = rows.reduce((s, r) => s + r.pieces * r.sale, 0);
  const profit = saleTotal - total;
  // Department, season and the price lists matter only for items made here.
  const hasNew = rows.some((r) => !r.l.existing);
  const ready =
    !!supplier &&
    !!warehouseId &&
    rows.length > 0 &&
    (!hasNew ||
      (rows.every((r) => r.l.existing || !!(r.l.departmentId || departmentId)) &&
        !!season &&
        !!pieceUnit &&
        !!saleLevel &&
        !!purchaseLevel));

  async function saveAll() {
    if (!ready || !supplier) return;
    setSaving(true);
    setError(null);
    try {
      // 1. The items (each once, even when Save is pressed again after a failure).
      const ids: string[] = [];
      for (const r of rows) {
        if (r.l.productId) {
          ids.push(r.l.productId);
          continue;
        }
        if (r.l.existing || !pieceUnit || !saleLevel || !purchaseLevel)
          throw new Error('item without id');
        const big = r.perUnit > 1 && r.l.unitId !== pieceUnit.id;
        const created = await createProduct.mutateAsync({
          name: r.l.name.trim(),
          departmentId: r.l.departmentId || departmentId,
          groupId: r.l.departmentId ? r.l.groupId || undefined : undefined,
          seasonId: season,
          sizeId: (r.l.withVariant && r.l.sizeId) || undefined,
          colorId: (r.l.withVariant && r.l.colorId) || undefined,
          warehouseId,
          supplierId: supplier.id,
          supplierCode: r.l.supplierCode || undefined,
          reorderLevel: Math.max(0, Math.floor(Number(r.l.reorder) || 0)),
          // The barcode is made by the server (owner, 2026-10-17: "automatic, no box for it").
          autoBarcode: true,
          units: [
            { unitId: pieceUnit.id, factor: 1 },
            ...(big ? [{ unitId: r.l.unitId, factor: r.perUnit }] : []),
          ],
          prices: [
            { unitId: pieceUnit.id, priceLevelId: saleLevel.id, price: r.sale },
            { unitId: pieceUnit.id, priceLevelId: purchaseLevel.id, price: r.before },
            ...(big
              ? [
                  { unitId: r.l.unitId, priceLevelId: saleLevel.id, price: r.sale * r.perUnit },
                  {
                    unitId: r.l.unitId,
                    priceLevelId: purchaseLevel.id,
                    price: r.before * r.perUnit,
                  },
                ]
              : []),
          ],
        });
        ids.push(created.id);
        setLines((prev) =>
          prev.map((l) => (l.key === r.l.key ? { ...l, productId: created.id } : l)),
        );
      }
      // 2. One purchase invoice for all of them, at the cost before the discount less the discount,
      // with the discount on the whole invoice as the invoice's own.
      const invoice = await createInvoice.mutateAsync({
        partyId: supplier.id,
        warehouseId,
        paidAmount: 0,
        documentDate: dayToSend(docDate),
        lines: rows.map((r, i) => {
          const big = r.l.existing || !pieceUnit || (r.perUnit > 1 && r.l.unitId !== pieceUnit.id);
          return {
            productId: ids[i]!,
            unitId: big || !pieceUnit ? r.l.unitId : pieceUnit.id,
            quantity: r.qty,
            unitCost: r.before * (big ? r.perUnit : 1),
            discount: r.discount > 0 ? r.discount * r.pieces : undefined,
          };
        }),
        charges:
          canDiscount && invDiscount > 0
            ? [
                ...(pctOf(invDiscounts) > 0
                  ? [{ kind: 'DISCOUNT' as const, percent: pctOf(invDiscounts) }]
                  : []),
                ...(amtOf(invDiscounts) > 0
                  ? [{ kind: 'EXTRA_DISCOUNT' as const, amount: amtOf(invDiscounts) }]
                  : []),
              ]
            : undefined,
      });
      // 3. Afterwards, nothing here can undo the stock: photos, and items moved to this season.
      for (const [i, r] of rows.entries()) {
        const photo = photos[r.l.key];
        if (photo) await api.upload(`/products/${ids[i]}/image`, photo).catch(() => undefined);
        if (!r.l.existing) continue;
        // Bought again: the new season, reorder level and prices go back on the item.
        const reorder = Math.max(0, Math.floor(Number(r.l.reorder) || 0));
        const moved = r.l.moveSeason && season && r.l.oldSeasonId !== season;
        const reordered = canEditItems && r.l.reorder !== '' && reorder !== r.l.existingReorder;
        if (moved || reordered)
          await updateProduct
            .mutateAsync({
              id: ids[i]!,
              input: {
                ...(moved ? { seasonId: season } : {}),
                ...(reordered ? { reorderLevel: reorder } : {}),
              },
            })
            .catch(() => undefined);
        const unitId = r.l.baseUnitId;
        if (canPrices && unitId && saleLevel && purchaseLevel) {
          const prices = [
            ...(r.sale > 0 && r.sale !== r.l.existingSale
              ? [{ unitId, priceLevelId: saleLevel.id, price: r.sale }]
              : []),
            ...(r.before > 0 && r.before !== r.l.existingCost
              ? [{ unitId, priceLevelId: purchaseLevel.id, price: r.before }]
              : []),
          ];
          if (prices.length)
            await api.put(`/products/${ids[i]}/prices`, { prices }).catch(() => undefined);
        }
      }
      for (const [page, photo] of invoicePhotos.slice(0, 10).entries())
        await api
          .upload(`/purchases/invoices/${invoice.id}/image?page=${page}`, photo)
          .catch(() => undefined);
      work.finished();
      navigate('/purchases');
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setSaving(false);
    }
  }

  // New items already made by a save that failed half way: the place and supplier stay.
  const someSaved = lines.some((l) => l.productId && !l.existing);
  const label = (text: string, child: ReactNode, className = '') => (
    <label className={`block ${className}`}>
      <span className="mb-0.5 block text-xs text-muted">{text}</span>
      {child}
    </label>
  );
  const number = (value: string, onChange: (v: string) => void, placeholder?: string) => (
    <input
      type="number"
      min={0}
      step="0.01"
      inputMode="decimal"
      className={`${field} tnum`}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  const set = (patch: Partial<NewLine>) => setEntry((e) => ({ ...e, ...patch }));
  /** A typed name fills the department and group it names (unless chosen by hand). */
  const setName = (name: string) =>
    setEntry((e) => {
      const read = readItemName(name, { departments, groups, sizes, colors });
      const picked = e.picked ?? [];
      return {
        ...e,
        name,
        ...(picked.includes('place')
          ? {}
          : { departmentId: read.departmentId ?? '', groupId: read.groupId ?? '' }),
        ...(!e.withVariant || picked.includes('size') || !read.sizeId
          ? {}
          : { sizeId: read.sizeId }),
        ...(!e.withVariant || picked.includes('color') || !read.colorId
          ? {}
          : { colorId: read.colorId }),
      };
    });
  const pick = (field: 'place' | 'size' | 'color', patch: Partial<NewLine>) =>
    setEntry((e) => ({ ...e, ...patch, picked: [...new Set([...(e.picked ?? []), field])] }));
  const entryDepartment = entry.departmentId || departmentId;
  const nextCode = useNextCode(
    entryDepartment,
    entry.departmentId ? (entry.groupId ?? '') : '',
    supplier?.id ?? '',
    !entry.existing && !!entry.name.trim() && canNewItems,
  );

  // Items already in the catalog with a name like the one typed, so it isn't made twice (owner,
  // 2026-10-17), each with its season.
  const typed = useDeferredValue(entry.existing || editing ? '' : entry.name.trim());
  const [hideSimilar, setHideSimilar] = useState('');
  const similar = useQuery({
    queryKey: ['products', 'similar', typed],
    queryFn: () => api.get<Product[]>(`/products?limit=6&search=${encodeURIComponent(typed)}`),
    enabled: typed.length >= 2,
    staleTime: 30_000,
  });
  const matches = typed.length >= 2 && hideSimilar !== typed ? (similar.data ?? []) : [];
  function takeMatch(p: Product) {
    const line = existingLine(p, p.units[0]?.unitId ?? '', Number(entry.qty) || 1, '');
    setEntry({
      ...line,
      costBefore: entry.costBefore || line.costBefore,
      discounts: entry.discounts,
    });
  }

  return (
    <div className="space-y-4 pb-4">
      <PageHeader
        title={t('qa.purchaseInvoice')}
        action={
          <Button size="sm" variant="ghost" icon="close" onClick={() => navigate('/purchases')}>
            {t('invoice.back')}
          </Button>
        }
      />

      {/* Who it comes from and where it is stored. */}
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2">
          {/* A supplier not in the list yet is added right here (owner, 2026-10-19). */}
          {can('parties:create_supplier') && !someSaved && (
            <button
              type="button"
              className="absolute end-0 top-0 z-[1] inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
              onClick={() => setAddingSupplier(true)}
            >
              <Icon name="plus" size={13} />
              {t('additems.newSupplier')}
            </button>
          )}
          <PartyPicker
            type="SUPPLIER"
            withCode
            value={supplier}
            onChange={setSupplier}
            disabled={someSaved}
            label={t('invoice.supplier')}
            placeholder={t('invoice.selectSupplier')}
          />
        </div>
        <DocumentDateField value={docDate} onChange={setDocDate} />
        {label(
          t('list.branch'),
          <select
            className={`${field} ${pickClass(!!branch, true)}`}
            value={branch}
            disabled={someSaved}
            onChange={(e) => {
              setBranch(e.target.value);
              setWarehouse('');
              setDepartment('');
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
          </select>,
        )}
        {label(
          t('list.warehouse'),
          <select
            className={`${field} ${pickClass(!!warehouseId, !!branch)}`}
            value={warehouseId}
            disabled={!branch || someSaved}
            onChange={(e) => {
              setWarehouse(e.target.value);
              setDepartment('');
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
          </select>,
        )}
        {label(
          t('invoice.department'),
          <select
            className={`${field} ${pickClass(!!departmentId, !!warehouseId)}`}
            value={departmentId}
            disabled={!warehouseId || someSaved}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="" disabled>
              {t('invoice.chooseDepartment')}
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>,
        )}
        {label(
          t('item.season'),
          <select
            className={`${field} ${!season ? 'border-warning' : ''}`}
            value={season}
            disabled={someSaved}
            onChange={(e) => setSeason(e.target.value)}
          >
            <option value="" disabled>
              {t('item.season')}
            </option>
            {activeSeasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>,
        )}
      </Card>

      {/* Items already in the catalog, bought again, or read from the invoice's photo. */}
      <Card className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{t('additems.existing')}</span>
        <span className="flex flex-wrap items-start gap-2">
          <ScanButton<PurchaseScan>
            kind="purchase"
            disabled={!warehouseId}
            onResult={fromScan}
            onPhoto={(photo) => setInvoicePhotos((cur) => [...cur, photo].slice(0, 10))}
          />
          <Button
            variant="secondary"
            icon="search"
            disabled={!warehouseId}
            onClick={() => setFinding(true)}
          >
            {t('additems.findExisting')}
          </Button>
        </span>
        {scanNote && <p className="w-full text-xs text-brand">{scanNote}</p>}
      </Card>
      {addingSupplier && (
        <PartySheet
          party={null}
          startTypes={['SUPPLIER']}
          onCreated={setSupplier}
          onClose={() => setAddingSupplier(false)}
        />
      )}
      {finding && (
        <ItemFinderSheet
          departmentId={departmentId || undefined}
          warehouseId={warehouseId || undefined}
          branchId={branch || undefined}
          onClose={() => setFinding(false)}
          onAdd={(items, close) => {
            addExisting(items);
            if (close) setFinding(false);
          }}
        />
      )}

      {/* The item being typed (a new one, or a bought-again one being changed). */}
      {(canNewItems || entry.existing) && (
        <Card className="space-y-3">
          {entry.existing ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-sm font-semibold">
                {entry.name} <span className="text-xs font-normal text-muted">{entry.detail}</span>
              </p>
              {entry.oldSeasonId !== season && season && canMoveSeason && (
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={!!entry.moveSeason}
                    onChange={(e) => set({ moveSeason: e.target.checked })}
                  />
                  <span className="text-muted">
                    {t('additems.fromSeason').replace(
                      '{s}',
                      entry.oldSeasonName || t('additems.noSeason'),
                    )}{' '}
                    ←{' '}
                  </span>
                  {t('additems.moveSeason').replace('{s}', seasonName)}
                </label>
              )}
              {!editing && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ms-auto"
                  onClick={() => setEntry(blank(pieceUnit?.id ?? ''))}
                >
                  {t('common.cancel')}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm font-semibold">{t('additems.newItem')}</p>
          )}
          {!entry.existing && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-app)] bg-surface-2 p-2">
              <span className="text-xs text-muted">{t('groups.path')}</span>
              <GroupPicker
                departments={departments}
                groups={groups}
                departmentId={entryDepartment}
                groupId={entry.departmentId ? (entry.groupId ?? '') : ''}
                onChange={(d, g) => pick('place', { departmentId: d, groupId: g })}
              />
              {entry.name.trim() &&
                !(entry.picked ?? []).includes('place') &&
                entry.departmentId && (
                  <span className="inline-flex items-center gap-1 text-xs text-brand">
                    <Icon name="bolt" size={12} />
                    {t('groups.read')}
                  </span>
                )}
            </div>
          )}
          {!entry.existing && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_10rem]">
              <div className="relative">
                {label(
                  t('item.name'),
                  <input
                    className={field}
                    value={entry.name}
                    autoComplete="off"
                    onChange={(e) => setName(e.target.value)}
                  />,
                )}
                {matches.length > 0 && (
                  <div className="absolute inset-x-0 z-20 mt-1 overflow-hidden rounded-[var(--radius-app)] border border-warning bg-surface shadow-[var(--shadow-card)]">
                    <div className="flex items-center justify-between gap-2 bg-warning-soft px-3 py-1.5 text-xs text-warning">
                      {t('additems.alreadyHave')}
                      <button
                        type="button"
                        className="grid h-6 w-6 place-items-center rounded hover:bg-surface"
                        aria-label={t('common.close')}
                        onClick={() => setHideSimilar(typed)}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                    {matches.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => takeMatch(p)}
                        className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-start text-sm hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block text-xs text-muted tnum" dir="auto">
                            {p.sku} · {formatNumber(p.stockOnHand, locale)} {p.units[0]?.name}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                            p.seasonId && p.seasonId === season
                              ? 'bg-brand-soft text-brand'
                              : 'bg-warning-soft text-warning'
                          }`}
                        >
                          {p.seasonName || t('additems.noSeason')}
                        </span>
                        <span className="shrink-0 text-xs font-medium text-brand">
                          {t('additems.useThis')}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {label(
                t('additems.code'),
                <div
                  className={`${field} grid items-center bg-surface-2 font-mono text-xs`}
                  dir="ltr"
                >
                  {nextCode.data?.code ?? '—'}
                </div>,
              )}
              {label(
                t('invoice.unit'),
                <select
                  className={field}
                  value={entry.unitId}
                  onChange={(e) => set({ unitId: e.target.value })}
                >
                  {activeUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {(u.pieces ?? 1) > 1 ? ` (${u.pieces})` : ''}
                    </option>
                  ))}
                </select>,
              )}
            </div>
          )}
          {!entry.existing &&
            (entry.withVariant ? (
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                {label(
                  t('setup.sizeName'),
                  <select
                    className={field}
                    value={entry.sizeId}
                    onChange={(e) => pick('size', { sizeId: e.target.value })}
                  >
                    <option value="">—</option>
                    {sizes.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>,
                )}
                {label(
                  t('setup.colorName'),
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-6 w-6 shrink-0 rounded-full border border-line"
                      style={{
                        background:
                          colors.find((c) => c.id === entry.colorId)?.hex ?? 'transparent',
                      }}
                    />
                    <select
                      className={field}
                      value={entry.colorId}
                      onChange={(e) => pick('color', { colorId: e.target.value })}
                    >
                      <option value="">—</option>
                      {colors.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </span>,
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => set({ withVariant: false, sizeId: '', colorId: '' })}
                >
                  {t('additems.hideVariant')}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                onClick={() => set({ withVariant: true })}
              >
                <Icon name="plus" size={13} />
                {t('additems.addVariant')}
              </button>
            ))}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {label(
              t('invoice.qty'),
              <input
                type="number"
                min={1}
                className={`${field} tnum`}
                value={entry.qty}
                onChange={(e) => set({ qty: e.target.value })}
              />,
            )}
            {label(
              t('additems.costBefore'),
              number(entry.costBefore, (v) => set({ costBefore: v })),
            )}
            {canDiscount && (
              <AdjButtons
                label={t('additems.supplierDiscount')}
                items={entry.discounts}
                onChange={(discounts) => set({ discounts })}
              />
            )}
            {label(
              t('additems.costAfter'),
              <div className={`${field} grid items-center bg-surface-2 tnum`}>
                {money(f.after)}
              </div>,
            )}
            {/* What this item comes to: pieces × the supplier's price after the discount. */}
            {label(
              t('additems.lineTotal'),
              <div className={`${field} grid items-center bg-surface-2 font-semibold tnum`}>
                {money(f.pieces * f.after)}
              </div>,
            )}
            {(!entry.existing || canPrices) && (
              <AdjButtons
                label={t('additems.margin')}
                items={entry.margins}
                onChange={(margins) => set({ margins, salePrice: '' })}
              />
            )}
            {(!entry.existing || canPrices) &&
              label(
                t('item.salePrice'),
                number(entry.salePrice, (v) => set({ salePrice: v }), String(f.sale / 100)),
              )}
            {(!entry.existing || canEditItems) &&
              label(
                t('item.reorder'),
                <input
                  type="number"
                  min={0}
                  className={`${field} tnum`}
                  value={entry.reorder}
                  onChange={(e) => set({ reorder: e.target.value })}
                />,
              )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PhotoPick
              label={t('additems.photo')}
              file={entryPhoto ?? (editing ? (photos[editing] ?? null) : null)}
              onFile={(file) => {
                setEntryPhoto(file);
                if (editing && !file)
                  setPhotos((p) => {
                    const next = { ...p };
                    delete next[editing];
                    return next;
                  });
              }}
            />
            <span className="flex gap-2">
              {editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setEntryPhoto(null);
                    setEntry(blank(entry.unitId));
                  }}
                >
                  {t('common.cancel')}
                </Button>
              )}
              <Button icon={editing ? 'check' : 'plus'} disabled={!entryOk} onClick={addEntry}>
                {editing ? t('additems.update') : t('additems.add')}
              </Button>
            </span>
          </div>
        </Card>
      )}

      {/* What is on the invoice so far. */}
      <Card className="space-y-3">
        {rows.length === 0 ? (
          <p className="rounded-[var(--radius-app)] bg-surface-2 p-4 text-center text-sm text-muted">
            {t('additems.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-app)] border border-line">
            <table className="w-full whitespace-nowrap text-[13px]">
              <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-2 py-2 text-start font-medium">#</th>
                  <th className="px-2 py-2 text-start font-medium">{t('invoice.item')}</th>
                  <th className="px-2 py-2 text-end font-medium">{t('invoice.qty')}</th>
                  <th className="px-2 py-2 text-end font-medium">{t('additems.costBefore')}</th>
                  {canDiscount && (
                    <th className="px-2 py-2 text-end font-medium">
                      {t('additems.supplierDiscount')}
                    </th>
                  )}
                  <th className="px-2 py-2 text-end font-medium">{t('additems.costAfter')}</th>
                  <th className="px-2 py-2 text-end font-medium">{t('item.salePrice')}</th>
                  <th className="px-2 py-2 text-end font-medium">{t('invoice.lineTotal')}</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {rows.map((r, i) => {
                  const size = r.l.withVariant
                    ? sizes.find((o) => o.id === r.l.sizeId)?.name
                    : undefined;
                  const color = r.l.withVariant
                    ? colors.find((o) => o.id === r.l.colorId)
                    : undefined;
                  const unit = activeUnits.find((u) => u.id === r.l.unitId);
                  return (
                    <tr key={r.l.key} className={editing === r.l.key ? 'bg-brand-soft/40' : ''}>
                      <td className="px-2 py-2 text-muted tnum">{i + 1}</td>
                      <td className="px-2 py-2">
                        <span className="flex items-center gap-1.5 font-medium">
                          {color?.hex && (
                            <span
                              className="h-3 w-3 rounded-full border border-line"
                              style={{ background: color.hex }}
                            />
                          )}
                          {r.l.name}
                          {photos[r.l.key] && (
                            <Icon name="camera" size={13} className="text-muted" />
                          )}
                          {r.l.productId && !r.l.existing && (
                            <Icon name="check" size={14} className="text-positive" />
                          )}
                        </span>
                        {r.l.existing && (
                          <span className="block text-xs text-muted">
                            {t('additems.existingTag')}
                            {r.l.detail ? ` · ${r.l.detail}` : ''}
                            {r.l.moveSeason &&
                              ` · ${t('additems.moveSeason').replace('{s}', seasonName)}`}
                          </span>
                        )}
                        {(size || color || r.l.groupId) && (
                          <span className="block text-xs text-muted">
                            {[
                              r.l.departmentId &&
                                [
                                  departments.find((d) => d.id === r.l.departmentId)?.name,
                                  groupLabel(groups, r.l.groupId),
                                ]
                                  .filter(Boolean)
                                  .join(' / '),
                              size,
                              color?.name,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-end tnum">
                        {r.qty} {r.l.existing ? '' : unit?.name}
                        {r.perUnit > 1 && (
                          <span className="block text-xs text-muted">
                            {r.pieces} {t('additems.pieces')}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-end tnum">{money(r.before)}</td>
                      {canDiscount && (
                        <td className="px-2 py-2 text-end text-muted tnum">
                          {r.discount ? money(r.discount) : ''}
                        </td>
                      )}
                      <td className="px-2 py-2 text-end tnum">{money(r.after)}</td>
                      <td className="px-2 py-2 text-end font-medium tnum">{money(r.sale)}</td>
                      <td className="px-2 py-2 text-end font-semibold tnum">
                        {money(r.pieces * r.after)}
                      </td>
                      <td className="px-1 py-1">
                        {(!r.l.productId || r.l.existing) && (
                          <span className="flex justify-end gap-0.5">
                            <button
                              type="button"
                              className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
                              aria-label={t('common.edit')}
                              title={t('common.edit')}
                              onClick={() => {
                                setEditing(r.l.key);
                                setEntryPhoto(null);
                                setEntry({ ...blank(), ...r.l });
                              }}
                            >
                              <Icon name="notes" size={15} />
                            </button>
                            <button
                              type="button"
                              className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-destructive-soft hover:text-destructive"
                              aria-label={t('invoice.remove')}
                              title={t('invoice.remove')}
                              onClick={() =>
                                setLines((prev) => prev.filter((x) => x.key !== r.l.key))
                              }
                            >
                              <Icon name="close" size={15} />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid w-full gap-3 sm:grid-cols-2">
            {canDiscount && (
              <AdjButtons
                label={t('additems.invoiceDiscount')}
                items={invDiscounts}
                onChange={setInvDiscounts}
              />
            )}
            {canPrices && (
              <AdjButtons
                label={t('additems.invoiceMargin')}
                items={invMargins}
                onChange={setInvMargins}
              />
            )}
          </div>
          <InvoicePhotos files={invoicePhotos} onChange={setInvoicePhotos} />
        </div>
      </Card>

      {/* Above the phone's bottom bar, in view while scrolling (owner, 2026-10-19). */}
      <div className="sticky bottom-[var(--bottom-bar,0px)] z-10 rounded-t-2xl border border-line bg-surface px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(15,23,42,.35)] pb-safe">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-6">
          <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-0.5 whitespace-nowrap text-sm sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-6">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-muted">{t('additems.pieces')}</dt>
              <dd className="font-semibold tnum">{pieces}</dd>
            </div>
            {invDiscount > 0 && (
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted">{t('additems.subtotal')}</dt>
                <dd className="tnum">{money(subtotal)}</dd>
              </div>
            )}
            {invDiscount > 0 && (
              <div className="col-span-2 flex flex-wrap items-baseline gap-1.5">
                <dt className="text-muted">{t('additems.invoiceDiscount')}</dt>
                <dd className="tnum text-positive">
                  − {money(invDiscount)}
                  <span className="ms-1 text-xs text-muted">({adjText(invDiscounts)})</span>
                </dd>
              </div>
            )}
            {invMargins.length > 0 && canPrices && (
              <div className="col-span-2 flex flex-wrap items-baseline gap-1.5">
                <dt className="text-muted">{t('additems.invoiceMargin')}</dt>
                <dd className="tnum">{adjText(invMargins)}</dd>
              </div>
            )}
            {seeProfit && rows.length > 0 && (
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted">{t('additems.saleTotal')}</dt>
                <dd className="tnum">{money(saleTotal)}</dd>
              </div>
            )}
            {seeProfit && rows.length > 0 && (
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted">{t('additems.profit')}</dt>
                <dd
                  className={`font-semibold tnum ${profit < 0 ? 'text-destructive' : 'text-positive'}`}
                >
                  {money(profit)}
                  {total > 0 && (
                    <span className="ms-1 text-xs text-muted">
                      ({formatNumber(Math.round((profit / total) * 1000) / 10, locale)}%)
                    </span>
                  )}
                </dd>
              </div>
            )}
            <div className="col-span-2 flex items-baseline gap-2">
              <dt className="text-muted">{t('additems.owed')}</dt>
              <dd className="text-xl font-bold tnum">{money(total)}</dd>
            </div>
          </dl>
          {someSaved && <p className="w-full text-xs text-warning">{t('additems.partial')}</p>}
          <Button
            className="w-full sm:ms-auto sm:w-auto"
            icon="check"
            loading={saving}
            disabled={!ready || saving}
            onClick={saveAll}
          >
            {saving ? t('item.saving') : t('additems.saveAll')}
          </Button>
        </div>
        {error && (
          <p className="mt-2 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Take a photo with the camera or pick one already on the device; shows a small preview. */
function PhotoPick({
  label,
  file,
  onFile,
}: {
  label: string;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  const { t } = useT();
  const picker = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  const take = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (picked) onFile(picked);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={take}
      />
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title={label}>
          <img src={url} alt="" className="h-16 w-16 rounded-md border border-line object-cover" />
        </a>
      ) : (
        <span className="grid h-10 w-10 place-items-center rounded-md border border-dashed border-line text-faint">
          <Icon name="camera" size={16} />
        </span>
      )}
      <span className="text-xs text-muted">{label}</span>
      <Button size="sm" variant="ghost" icon="upload" onClick={() => picker.current?.click()}>
        {t('additems.uploadPhoto')}
      </Button>
      {file && (
        <Button size="sm" variant="dangerGhost" onClick={() => onFile(null)}>
          {t('additems.removePhoto')}
        </Button>
      )}
    </div>
  );
}

/**
 * A discount or margin as buttons (owner, 2026-10-19): pressing one adds a box with % or the
 * currency to pick; a second can be added the same way; × takes one away.
 */
function AdjButtons({
  label,
  items,
  onChange,
  max = 2,
}: {
  label: string;
  items: Adj[];
  onChange: (items: Adj[]) => void;
  max?: number;
}) {
  const { t } = useT();
  const set = (i: number, patch: Partial<Adj>) =>
    onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <span className="block text-xs text-muted">{label}</span>
      {items.map((x, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            autoFocus={!x.value}
            className="h-9 w-full min-w-0 flex-1 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none tnum focus:border-brand"
            value={x.value}
            aria-label={label}
            onChange={(e) => set(i, { value: e.target.value })}
          />
          <span className="flex shrink-0 overflow-hidden rounded-[var(--radius-app)] border border-line text-sm">
            {(['pct', 'amt'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={x.kind === k}
                className={`h-9 px-3 ${x.kind === k ? 'bg-brand text-white' : 'bg-surface text-muted hover:bg-surface-2'}`}
                onClick={() => set(i, { kind: k })}
              >
                {k === 'pct' ? '%' : t('additems.pounds')}
              </button>
            ))}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon="close"
            aria-label={t('common.remove')}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      {items.length < max && (
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1 rounded-[var(--radius-app)] border border-dashed border-line px-3 text-sm text-brand hover:bg-surface-2"
          onClick={() => onChange([...items, { kind: 'pct', value: '' }])}
        >
          <Icon name="plus" size={14} />
          {items.length ? t('additems.addAnother').replace('{x}', label) : label}
        </button>
      )}
    </div>
  );
}

/**
 * The supplier invoice's photos, a page each (owner, 2026-10-19: an invoice can run to several
 * pages): add pages, see them, take one away. Kept on this device until the invoice is saved.
 */
function InvoicePhotos({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const { t } = useT();
  const picker = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const made = files.map((f) => URL.createObjectURL(f));
    setUrls(made);
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={picker}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          e.target.value = '';
          if (picked.length) onChange([...files, ...picked].slice(0, 10));
        }}
      />
      <span className="text-xs text-muted">{t('additems.invoicePhoto')}</span>
      {urls.map((u, i) => (
        <span key={u} className="relative">
          <a href={u} target="_blank" rel="noreferrer" title={`${t('additems.page')} ${i + 1}`}>
            <img src={u} alt="" className="h-16 w-16 rounded-md border border-line object-cover" />
          </a>
          <span className="absolute bottom-0.5 start-0.5 rounded bg-black/60 px-1 text-[10px] text-white tnum">
            {i + 1}
          </span>
          <button
            type="button"
            aria-label={t('additems.removePhoto')}
            className="absolute -end-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-destructive text-white"
            onClick={() => onChange(files.filter((_, j) => j !== i))}
          >
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}
      {files.length < 10 && (
        <Button size="sm" variant="ghost" icon="upload" onClick={() => picker.current?.click()}>
          {files.length ? t('additems.addPage') : t('additems.uploadPhoto')}
        </Button>
      )}
    </div>
  );
}
