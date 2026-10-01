import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, toMinor, type Party } from '@skb/shared';
import { Button, Card, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { PartyPicker } from '../components/PartyPicker';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { useAuth } from '../stores/auth';
import { useWorkDraft } from '../lib/workDraft';
import {
  useCompanySettings,
  useCreateProduct,
  useCreatePurchaseInvoice,
  useDepartments,
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
  /** Set once the item exists, so saving again doesn't make it twice. */
  productId?: string;
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
    const sale = l.salePrice !== '' ? minor(l.salePrice) : marginSale;
    const perUnit = activeUnits.find((u) => u.id === l.unitId)?.pieces ?? 1;
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
    return { before, discount, after, sale, perUnit, qty, pieces: qty * perUnit };
  }
  const f = figures(entry);
  const entryOk = !!entry.name.trim() && f.qty > 0 && f.before > 0 && !!entry.unitId;

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
  const ready =
    !!supplier &&
    !!warehouseId &&
    !!departmentId &&
    !!season &&
    rows.length > 0 &&
    !!pieceUnit &&
    !!saleLevel &&
    !!purchaseLevel;

  async function saveAll() {
    if (!ready || !supplier || !pieceUnit || !saleLevel || !purchaseLevel) return;
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
        const big = r.perUnit > 1 && r.l.unitId !== pieceUnit.id;
        const created = await createProduct.mutateAsync({
          name: r.l.name.trim(),
          departmentId,
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
        lines: rows.map((r, i) => {
          const big = r.perUnit > 1 && r.l.unitId !== pieceUnit.id;
          return {
            productId: ids[i]!,
            unitId: big ? r.l.unitId : pieceUnit.id,
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

  const someSaved = lines.some((l) => l.productId);
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

  return (
    <div className="space-y-4 pb-4">
      <PageHeader
        title={t('additems.title')}
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate('/inventory/products/new?plain=1')}
            >
              {t('additems.plain')}
            </Button>
            <Button size="sm" variant="ghost" icon="close" onClick={() => navigate('/inventory')}>
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
            className={`${field} ${warehouseId && !departmentId ? 'border-warning' : ''}`}
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

      {/* The item being typed. */}
      <Card className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {label(
            t('item.name'),
            <input
              className={field}
              value={entry.name}
              onChange={(e) => set({ name: e.target.value })}
            />,
            'sm:col-span-2',
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
          {label(
            t('setup.sizeName'),
            <select
              className={field}
              value={entry.sizeId}
              onChange={(e) => set({ sizeId: e.target.value })}
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
                  background: colors.find((c) => c.id === entry.colorId)?.hex ?? 'transparent',
                }}
              />
              <select
                className={field}
                value={entry.colorId}
                onChange={(e) => set({ colorId: e.target.value })}
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
                {toggle(entry.discountMode, (m) => set({ discountMode: m }), t('additems.amount'))}
              </span>,
            )}
          {label(
            t('additems.costAfter'),
            <div className={`${field} grid items-center bg-surface-2 tnum`}>{money(f.after)}</div>,
          )}
          {label(
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
          {label(
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
          {label(
            t('item.barcode'),
            <input
              className={`${field} tnum`}
              dir="ltr"
              value={entry.barcode}
              onChange={(e) => set({ barcode: e.target.value })}
            />,
          )}
          {label(
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
                          {r.l.productId && (
                            <Icon name="check" size={14} className="text-positive" />
                          )}
                        </span>
                        {(size || color) && (
                          <span className="block text-xs text-muted">
                            {[size, color?.name].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-end tnum">
                        {r.qty} {unit?.name}
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
                        {!r.l.productId && (
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
