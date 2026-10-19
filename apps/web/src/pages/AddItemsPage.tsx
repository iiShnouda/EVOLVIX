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

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:bg-surface-2';

/** A factory's short name from how it is written: "مصنع JK" → "JK". */
function factoryName(name: string): string {
  return name
    .replace(/^\s*(مصنع|مصانع|شركة|شركه|معرض|مؤسسة|مؤسسه|محل|محلات|factory|company)\s+/i, '')
    .trim();
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
  discountPct: string;
  discountAmt: string;
  marginPct: string;
  marginAmt: string;
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
  invPct: string;
  invAmt: string;
}

const blank = (unitId = ''): NewLine => ({
  key: '',
  name: '',
  unitId,
  sizeId: '',
  colorId: '',
  qty: '1',
  costBefore: '',
  discountPct: '',
  discountAmt: '',
  marginPct: '',
  marginAmt: '',
  salePrice: '',
  reorder: '',
});

/** Minor units of a typed amount ('' = 0). */
const minor = (v: string) => Math.max(0, toMinor(Number(v) || 0));
const pct = (v: string) => Math.min(100, Math.max(0, Number(v) || 0));

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
  const pieceUnit =
    activeUnits.find((u) => (u.pieces ?? 1) === 1 && ['قطعة', 'Piece'].includes(u.name)) ??
    activeUnits.find((u) => (u.pieces ?? 1) === 1);
  const saleLevel = (levels.data ?? []).find((l) => l.side === 'SALE' && l.isDefault);
  const purchaseLevel = (levels.data ?? []).find((l) => l.side === 'PURCHASE' && l.isDefault);

  const [supplier, setSupplier] = useState<Party | null>(null);
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
  const departmentId = departments.some((d) => d.id === department)
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
  const [invPct, setInvPct] = useState('');
  const [invAmt, setInvAmt] = useState('');
  // Photos stay on this device until saved: one per line, and the supplier's invoice.
  const [photos, setPhotos] = useState<Record<string, File>>({});
  const [entryPhoto, setEntryPhoto] = useState<File | null>(null);
  const [invoicePhoto, setInvoicePhoto] = useState<File | null>(null);
  useEffect(() => {
    if (!entry.unitId && pieceUnit) setEntry((e) => ({ ...e, unitId: pieceUnit.id }));
  }, [entry.unitId, pieceUnit]);

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const createInvoice = useCreatePurchaseInvoice();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const work = useWorkDraft<AddItemsDraft>(
    2,
    () =>
      lines.length === 0 && !entry.name
        ? null
        : { supplier, branch, warehouse, department, season, lines, entry, invPct, invAmt },
    (d) => {
      if (d.supplier && typeof d.supplier.id === 'string') setSupplier(d.supplier);
      if (typeof d.branch === 'string') setBranch(d.branch);
      if (typeof d.warehouse === 'string') setWarehouse(d.warehouse);
      if (typeof d.department === 'string') setDepartment(d.department);
      if (typeof d.season === 'string') setSeason(d.season);
      if (Array.isArray(d.lines)) setLines(d.lines.filter((l) => l && typeof l.name === 'string'));
      if (d.entry && typeof d.entry.name === 'string') setEntry({ ...blank(), ...d.entry });
      if (typeof d.invPct === 'string') setInvPct(d.invPct);
      if (typeof d.invAmt === 'string') setInvAmt(d.invAmt);
    },
  );

  /** A line's per-piece figures (minor units) and its pieces. */
  function figures(l: NewLine) {
    const before = minor(l.costBefore);
    const rawDiscount = canDiscount
      ? Math.round((before * pct(l.discountPct)) / 100) + minor(l.discountAmt)
      : 0;
    const discount = Math.min(before, rawDiscount);
    const after = before - discount;
    // The margin is worked out on the supplier's price before the discount, and the discount
    // counts as part of it (owner, 2026-10-18): 505 less 10% with a 13% margin sells at
    // 454.50 + 65.65 = 520.15 (3% over the list price); an 8% margin sells at 494.90 (2% under).
    // …rounded up to a whole pound (owner, 2026-10-18): 520.15 sells at 521.
    const marginSale =
      Math.ceil(
        (after + Math.round((before * (Number(l.marginPct) || 0)) / 100) + minor(l.marginAmt)) /
          100,
      ) * 100;
    const sale = l.existing
      ? (l.existingSale ?? 0)
      : l.salePrice !== ''
        ? minor(l.salePrice)
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
          discountAmt: l.discount ? String(l.discount) : '',
          departmentId: read.departmentId ?? '',
          groupId: read.groupId ?? '',
        });
      }
    }
    if (picks.length) addExisting(picks);
    if (fresh.length) setLines((prev) => [...prev, ...fresh]);
    // The discount written under the total goes on the whole invoice.
    if (canDiscount && scan.discount > 0 && !minor(invAmt)) setInvAmt(String(scan.discount));
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
      marginPct: entry.existing ? '' : entry.marginPct,
      marginAmt: entry.existing ? '' : entry.marginAmt,
    });
  }

  const rows = lines.map((l) => ({ l, ...figures(l) }));
  const subtotal = rows.reduce((s, r) => s + r.pieces * r.after, 0);
  const invDiscount = canDiscount
    ? Math.min(subtotal, Math.round((subtotal * pct(invPct)) / 100) + minor(invAmt))
    : 0;
  const total = subtotal - invDiscount;
  const pieces = rows.reduce((s, r) => s + r.pieces, 0);
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
          canDiscount && (pct(invPct) > 0 || minor(invAmt) > 0)
            ? [
                ...(pct(invPct) > 0 ? [{ kind: 'DISCOUNT' as const, percent: pct(invPct) }] : []),
                ...(minor(invAmt) > 0
                  ? [{ kind: 'EXTRA_DISCOUNT' as const, amount: minor(invAmt) }]
                  : []),
              ]
            : undefined,
      });
      // 3. Afterwards, nothing here can undo the stock: photos, and items moved to this season.
      for (const [i, r] of rows.entries()) {
        const photo = photos[r.l.key];
        if (photo) await api.upload(`/products/${ids[i]}/image`, photo).catch(() => undefined);
        if (r.l.existing && r.l.moveSeason && season && r.l.oldSeasonId !== season)
          await updateProduct
            .mutateAsync({ id: ids[i]!, input: { seasonId: season } })
            .catch(() => undefined);
      }
      if (invoicePhoto)
        await api
          .upload(`/purchases/invoices/${invoice.id}/image`, invoicePhoto)
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
    warehouseId,
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
      discountPct: entry.discountPct,
      discountAmt: entry.discountAmt,
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
        <div className="sm:col-span-2">
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
            className={`${field} ${!branch ? 'border-warning' : ''}`}
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
            className={`${field} ${branch && !warehouseId ? 'border-warning' : ''}`}
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
            className={`${field} ${
              warehouseId && !departmentId && rows.some((r) => !r.l.existing && !r.l.departmentId)
                ? 'border-warning'
                : ''
            }`}
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
            onPhoto={setInvoicePhoto}
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
            {canDiscount &&
              label(
                t('additems.discountPct'),
                number(entry.discountPct, (v) => set({ discountPct: v })),
              )}
            {canDiscount &&
              label(
                t('additems.discountAmt'),
                number(entry.discountAmt, (v) => set({ discountAmt: v })),
              )}
            {label(
              t('additems.costAfter'),
              <div className={`${field} grid items-center bg-surface-2 tnum`}>
                {money(f.after)}
              </div>,
            )}
            {!entry.existing &&
              label(
                t('additems.marginPct'),
                number(entry.marginPct, (v) => set({ marginPct: v, salePrice: '' })),
              )}
            {!entry.existing &&
              label(
                t('additems.marginAmt'),
                number(entry.marginAmt, (v) => set({ marginAmt: v, salePrice: '' })),
              )}
            {!entry.existing &&
              label(
                t('item.salePrice'),
                number(entry.salePrice, (v) => set({ salePrice: v }), String(f.sale / 100)),
              )}
            {!entry.existing &&
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
          {canDiscount && (
            <div className="flex flex-wrap items-end gap-2">
              <span className="w-full text-xs font-medium text-muted">
                {t('additems.invoiceDiscount')}
              </span>
              <span className="w-28">
                {label(t('additems.invoiceDiscountPct'), number(invPct, setInvPct))}
              </span>
              <span className="w-32">
                {label(t('additems.invoiceDiscountAmt'), number(invAmt, setInvAmt))}
              </span>
            </div>
          )}
          <PhotoPick
            label={t('additems.invoicePhoto')}
            file={invoicePhoto}
            onFile={setInvoicePhoto}
          />
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 rounded-t-2xl border border-line bg-surface px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(15,23,42,.35)] pb-safe">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {invDiscount > 0 && (
            <div className="flex items-baseline gap-2 text-sm">
              <span className="text-muted">{t('additems.subtotal')}</span>
              <span className="tnum">{money(subtotal)}</span>
              <span className="text-muted">−</span>
              <span className="tnum text-positive">{money(invDiscount)}</span>
            </div>
          )}
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-muted">{t('additems.owed')}</span>
            <span className="text-xl font-bold tnum">{money(total)}</span>
          </div>
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-muted">{t('additems.pieces')}</span>
            <span className="font-semibold tnum">{pieces}</span>
          </div>
          {someSaved && (
            <p className="min-w-0 flex-1 text-xs text-warning">{t('additems.partial')}</p>
          )}
          <Button
            className="ms-auto"
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
