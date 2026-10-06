import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  companyToday,
  formatMoney,
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
  useVariantOptions,
  useWarehouses,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:bg-surface-2';

type Mode = 'pct' | 'amt';

/** One new item on the supplier's invoice, as typed; prices are per piece. */
interface NewLine {
  key: string;
  name: string;
  unitId: string;
  sizeId: string;
  colorId: string;
  qty: string;
  costBefore: string;
  discount: string;
  discountMode: Mode;
  margin: string;
  marginMode: Mode;
  /** Typed sale price; '' = worked out from the margin. */
  salePrice: string;
  barcode: string;
  reorder: string;
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
  /**
   * An item already in the catalog, bought again (owner, 2026-10-06: one purchase screen): only
   * its quantity, cost and discount are typed; its unit holds `perUnit` pieces and it keeps its
   * own sale price (`existingSale`, per piece).
   */
  existing?: boolean;
  perUnit?: number;
  existingSale?: number;
  detail?: string;
}

interface AddItemsDraft {
  supplier: Party | null;
  branch: string;
  warehouse: string;
  department: string;
  season: string;
  lines: NewLine[];
  entry: NewLine;
}

const blank = (unitId = ''): NewLine => ({
  key: '',
  name: '',
  unitId,
  sizeId: '',
  colorId: '',
  qty: '1',
  costBefore: '',
  discount: '',
  discountMode: 'pct',
  margin: '',
  marginMode: 'pct',
  salePrice: '',
  barcode: '',
  reorder: '',
});

/** Minor units of a typed amount ('' = 0). */
const minor = (v: string) => Math.max(0, toMinor(Number(v) || 0));

/**
 * Adding items is a purchase invoice (owner decision 2026-10-01): the supplier, where the goods are
 * stored (branch, warehouse, department) and the season, then each item with its cost before the
 * supplier's discount (per piece, % or an amount), the margin (% or an amount on the cost before the
 * discount) and the sale price. Add puts it in the list; Save creates every item and one purchase
 * invoice that puts them in stock at the net cost, owed to the supplier.
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
  const warehouseId = branchWarehouses.some((w) => w.id === warehouse) ? warehouse : '';
  const onWarehouse = branchWarehouses.find((w) => w.id === warehouseId)?.departmentIds;
  const departments = (useDepartments().data ?? []).filter(
    (d) => d.isActive && (!onWarehouse?.length || onWarehouse.includes(d.id)),
  );
  const departmentId = departments.some((d) => d.id === department) ? department : '';
  const allGroups = useGroups().data ?? [];
  const groups = allGroups.filter((g) => departments.some((d) => d.id === g.departmentId));
  const activeSeasons = (seasons.data ?? []).filter((s) => s.isActive);
  const currentSeason = activeSeasons.find((s) => s.isCurrent)?.id ?? '';
  useEffect(() => {
    if (!season && currentSeason) setSeason(currentSeason);
  }, [season, currentSeason]);

  const [lines, setLines] = useState<NewLine[]>([]);
  const [entry, setEntry] = useState<NewLine>(blank());
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    if (!entry.unitId && pieceUnit) setEntry((e) => ({ ...e, unitId: pieceUnit.id }));
  }, [entry.unitId, pieceUnit]);

  const createProduct = useCreateProduct();
  const createInvoice = useCreatePurchaseInvoice();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const work = useWorkDraft<AddItemsDraft>(
    1,
    () =>
      lines.length === 0 && !entry.name
        ? null
        : { supplier, branch, warehouse, department, season, lines, entry },
    (d) => {
      if (d.supplier && typeof d.supplier.id === 'string') setSupplier(d.supplier);
      if (typeof d.branch === 'string') setBranch(d.branch);
      if (typeof d.warehouse === 'string') setWarehouse(d.warehouse);
      if (typeof d.department === 'string') setDepartment(d.department);
      if (typeof d.season === 'string') setSeason(d.season);
      if (Array.isArray(d.lines)) setLines(d.lines.filter((l) => l && typeof l.name === 'string'));
      if (d.entry && typeof d.entry.name === 'string') setEntry(d.entry);
    },
  );

  /** A line's per-piece figures (minor units) and its pieces. */
  function figures(l: NewLine) {
    const before = minor(l.costBefore);
    const rawDiscount = canDiscount
      ? l.discountMode === 'pct'
        ? Math.round((before * Math.min(100, Number(l.discount) || 0)) / 100)
        : minor(l.discount)
      : 0;
    const discount = Math.min(before, rawDiscount);
    const after = before - discount;
    const marginSale =
      l.marginMode === 'pct'
        ? Math.round(before * (1 + (Number(l.margin) || 0) / 100))
        : before + minor(l.margin);
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
  const [finding, setFinding] = useState(false);
  function addExisting(items: FinderPick[]) {
    setLines((prev) => [
      ...prev,
      ...items.map((i, n) => {
        const unit = i.product.units.find((u) => u.unitId === i.unitId) ?? i.product.units[0];
        const perUnit = unit?.factor ?? 1;
        return {
          ...blank(i.unitId),
          key: `${Date.now()}-${prev.length + n}`,
          name: i.product.name,
          qty: String(i.quantity || 1),
          costBefore: i.product.costPrice > 0 ? String(i.product.costPrice / 100) : '',
          productId: i.product.id,
          existing: true,
          perUnit,
          existingSale: i.product.salePrice,
          detail: [i.product.sku, i.product.sizeName, i.product.colorName, unit?.name]
            .filter(Boolean)
            .join(' · '),
        } satisfies NewLine;
      }),
    ]);
  }

  /**
   * A supplier invoice read from a photo (owner, 2026-10-06): the supplier when found, each line as
   * the item it names when the search finds one, else as a new item read like a typed name. The
   * person checks every line before saving.
   */
  const [scanNote, setScanNote] = useState<string | null>(null);
  async function fromScan(scan: PurchaseScan) {
    if (!supplier && scan.supplierName) {
      const found = await api.get<Paginated<Party>>(
        `/parties?page=1&pageSize=5&search=${encodeURIComponent(scan.supplierName)}`,
      );
      const match = found.items.find((p) => p.types.includes('SUPPLIER'));
      if (match) setSupplier(match);
    }
    const picks: FinderPick[] = [];
    const fresh: NewLine[] = [];
    for (const [n, l] of scan.lines.entries()) {
      const hits = await api.get<Product[]>(
        `/products?limit=1&search=${encodeURIComponent(l.name)}`,
      );
      const hit = hits[0];
      const qty = Math.max(1, Math.round(l.quantity));
      if (hit) {
        picks.push({
          product: { ...hit, costPrice: toMinor(l.unitPrice) },
          unitId: hit.units[0]?.unitId ?? '',
          quantity: qty,
        });
      } else if (canNewItems && pieceUnit) {
        const read = readItemName(l.name, { departments, groups, sizes, colors });
        fresh.push({
          ...blank(pieceUnit.id),
          key: `${Date.now()}-scan-${n}`,
          name: l.name,
          qty: String(qty),
          costBefore: l.unitPrice ? String(l.unitPrice) : '',
          discount: l.discount ? String(l.discount) : '',
          discountMode: 'amt',
          departmentId: read.departmentId ?? '',
          groupId: read.groupId ?? '',
          sizeId: read.sizeId ?? '',
          colorId: read.colorId ?? '',
        });
      }
    }
    if (picks.length) addExisting(picks);
    if (fresh.length) setLines((prev) => [...prev, ...fresh]);
    setScanNote(t('assistant.scanned').replace('{n}', String(picks.length + fresh.length)));
  }

  function addEntry() {
    if (!entryOk) return;
    if (editing) {
      setLines((prev) => prev.map((l) => (l.key === editing ? { ...entry, key: editing } : l)));
      setEditing(null);
    } else setLines((prev) => [...prev, { ...entry, key: `${Date.now()}-${prev.length}` }]);
    // The next item keeps the unit and the way discount and margin are given.
    setEntry({
      ...blank(entry.unitId),
      discountMode: entry.discountMode,
      marginMode: entry.marginMode,
      margin: entry.margin,
    });
  }

  const rows = lines.map((l) => ({ l, ...figures(l) }));
  const owed = rows.reduce((s, r) => s + r.pieces * r.after, 0);
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
          sizeId: r.l.sizeId || undefined,
          colorId: r.l.colorId || undefined,
          warehouseId,
          supplierId: supplier.id,
          reorderLevel: Math.max(0, Math.floor(Number(r.l.reorder) || 0)),
          units: [
            {
              unitId: pieceUnit.id,
              factor: 1,
              barcode: big ? undefined : r.l.barcode || undefined,
            },
            ...(big
              ? [{ unitId: r.l.unitId, factor: r.perUnit, barcode: r.l.barcode || undefined }]
              : []),
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
      // 2. One purchase invoice for all of them, at the cost before the discount less the discount.
      await createInvoice.mutateAsync({
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
      });
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
  const toggle = (value: Mode, set: (m: Mode) => void, unit: string) => (
    <div className="flex shrink-0 overflow-hidden rounded-[var(--radius-app)] border border-line text-xs">
      {(['pct', 'amt'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          className={`h-9 px-2 ${value === m ? 'bg-brand text-brand-fg' : 'bg-surface text-muted'}`}
          onClick={() => set(m)}
        >
          {m === 'pct' ? t('additems.percent') : unit}
        </button>
      ))}
    </div>
  );
  const label = (text: string, child: ReactNode, className = '') => (
    <label className={`block ${className}`}>
      <span className="mb-0.5 block text-xs text-muted">{text}</span>
      {child}
    </label>
  );
  const set = (patch: Partial<NewLine>) => setEntry((e) => ({ ...e, ...patch }));
  /** A typed name fills the department, group, size and color it names (unless chosen by hand). */
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
        ...(picked.includes('size') || !read.sizeId ? {} : { sizeId: read.sizeId }),
        ...(picked.includes('color') || !read.colorId ? {} : { colorId: read.colorId }),
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

  return (
    <div className="space-y-4 pb-4">
      <PageHeader
        title={t('qa.purchaseInvoice')}
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate('/inventory/products/new?plain=1')}
            >
              {t('additems.plain')}
            </Button>
            <Button size="sm" variant="ghost" icon="close" onClick={() => navigate('/purchases')}>
              {t('invoice.back')}
            </Button>
          </div>
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

      {/* Items already in the catalog, bought again. */}
      <Card className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{t('additems.existing')}</span>
        <span className="flex flex-wrap items-start gap-2">
          <ScanButton<PurchaseScan> kind="purchase" disabled={!warehouseId} onResult={fromScan} />
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
            <p className="text-sm font-semibold">
              {entry.name} <span className="text-xs font-normal text-muted">{entry.detail}</span>
            </p>
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
              {nextCode.data && (
                <span className="ms-auto flex items-center gap-1.5 text-xs">
                  <span className="text-muted">{t('groups.code')}</span>
                  <span
                    className="rounded bg-surface px-1.5 py-0.5 font-mono font-semibold"
                    dir="ltr"
                  >
                    {nextCode.data.code}
                  </span>
                </span>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {!entry.existing &&
              label(
                t('item.name'),
                <input
                  className={field}
                  value={entry.name}
                  onChange={(e) => setName(e.target.value)}
                />,
                'sm:col-span-2',
              )}
            {!entry.existing &&
              label(
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
            {!entry.existing &&
              label(
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
            {!entry.existing &&
              label(
                t('setup.colorName'),
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-6 w-6 shrink-0 rounded-full border border-line"
                    style={{
                      background: colors.find((c) => c.id === entry.colorId)?.hex ?? 'transparent',
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
              <input
                type="number"
                min={0}
                step="0.01"
                className={`${field} tnum`}
                value={entry.costBefore}
                onChange={(e) => set({ costBefore: e.target.value })}
              />,
            )}
            {canDiscount &&
              label(
                t('additems.supplierDiscount'),
                <span className="flex gap-1">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${field} tnum`}
                    value={entry.discount}
                    onChange={(e) => set({ discount: e.target.value })}
                  />
                  {toggle(
                    entry.discountMode,
                    (m) => set({ discountMode: m }),
                    t('additems.amount'),
                  )}
                </span>,
              )}
            {label(
              t('additems.costAfter'),
              <div className={`${field} grid items-center bg-surface-2 tnum`}>
                {money(f.after)}
              </div>,
            )}
            {!entry.existing &&
              label(
                t('additems.margin'),
                <span className="flex gap-1">
                  <input
                    type="number"
                    step="0.01"
                    className={`${field} tnum`}
                    value={entry.margin}
                    onChange={(e) => set({ margin: e.target.value, salePrice: '' })}
                  />
                  {toggle(
                    entry.marginMode,
                    (m) => set({ marginMode: m, salePrice: '' }),
                    t('additems.amount'),
                  )}
                </span>,
              )}
            {!entry.existing &&
              label(
                t('item.salePrice'),
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={`${field} tnum`}
                  placeholder={String(f.sale / 100)}
                  value={entry.salePrice}
                  onChange={(e) => set({ salePrice: e.target.value })}
                />,
              )}
            {!entry.existing &&
              label(
                t('item.barcode'),
                <input
                  className={`${field} tnum`}
                  dir="ltr"
                  value={entry.barcode}
                  onChange={(e) => set({ barcode: e.target.value })}
                />,
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            {editing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setEntry(blank(entry.unitId));
                }}
              >
                {t('common.cancel')}
              </Button>
            )}
            <Button icon={editing ? 'check' : 'plus'} disabled={!entryOk} onClick={addEntry}>
              {editing ? t('additems.update') : t('additems.add')}
            </Button>
          </div>
        </Card>
      )}

      {/* What is on the invoice so far. */}
      <Card>
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
                  const size = sizes.find((o) => o.id === r.l.sizeId)?.name;
                  const color = colors.find((o) => o.id === r.l.colorId);
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
                          {r.l.productId && !r.l.existing && (
                            <Icon name="check" size={14} className="text-positive" />
                          )}
                        </span>
                        {r.l.existing && (
                          <span className="block text-xs text-muted">
                            {t('additems.existingTag')}
                            {r.l.detail ? ` · ${r.l.detail}` : ''}
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
                                setEntry(r.l);
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
      </Card>

      <div className="sticky bottom-0 z-10 rounded-t-2xl border border-line bg-surface/95 px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(15,23,42,.35)] backdrop-blur pb-safe">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-muted">{t('additems.owed')}</span>
            <span className="text-xl font-bold tnum">{money(owed)}</span>
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
