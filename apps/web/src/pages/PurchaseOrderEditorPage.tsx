import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  companyToday,
  formatMoney,
  formatNumber,
  toMinor,
  type Party,
  type PurchaseOrder,
  type PurchaseOrderLineInput,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { PartyPicker } from '../components/PartyPicker';
import { ItemFinderSheet, type FinderPick } from '../components/ItemFinderSheet';
import { GroupPicker } from '../components/GroupTree';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import {
  useCompanySettings,
  useDepartments,
  useGroups,
  useParty,
  usePriceLevels,
  useUnits,
  useVariantOptions,
  useWarehouses,
} from '../lib/queries';
import {
  usePurchaseOrder,
  usePurchaseOrderSuggestions,
  useSavePurchaseOrder,
} from '../lib/purchaseOrders';

const field =
  'h-9 w-full min-w-0 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** One line as typed: an item in the catalog, or a new one only named. */
interface Line {
  key: string;
  productId?: string;
  name: string;
  detail?: string;
  isNew: boolean;
  unitId: string;
  /** The units it can be ordered in (an item's own; any unit for a new item). */
  units: { unitId: string; name: string; factor: number }[];
  qty: string;
  /** Expected price of one unit, as typed (major units). */
  price: string;
  departmentId?: string;
  groupId?: string;
  sizeId?: string;
  colorId?: string;
  supplierCode?: string;
}

const major = (minor: number) => (minor > 0 ? String(minor / 100) : '');
let seq = 0;
const nextKey = () => `l${Date.now()}-${seq++}`;

/**
 * A purchase order to a factory (owner, 2026-11-18): the supplier, where the goods are to be received,
 * the dates and notes, then the items — the supplier's own items offered from the "what to buy"
 * suggestions with the quantity suggested (changeable), any item found by search, and new items not
 * in the catalog yet (a name, department and group, size and colour if wanted). Nothing is made or
 * moved: the items are made and the stock comes in when the order is received on a purchase invoice.
 */
export function PurchaseOrderEditorPage({ editId }: { editId?: string }) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const [params] = useSearchParams();
  const me = useAuth((s) => s.user);
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  const money = (v: number) => formatMoney(v, currency, locale);

  const existing = usePurchaseOrder(editId);
  const fromSupplier = useParty(editId ? null : params.get('supplier'));
  const days = Number(params.get('days')) || 30;
  const target = Number(params.get('target')) || 30;

  const units = (useUnits().data ?? []).filter((u) => u.isActive);
  const pieceUnit = units.find((u) => (u.pieces ?? 1) === 1);
  const allUnits = units.map((u) => ({ unitId: u.id, name: u.name, factor: u.pieces ?? 1 }));
  const options = (useVariantOptions().data ?? []).filter((o) => o.isActive);
  const sizes = options.filter((o) => o.kind === 'SIZE');
  const colors = options.filter((o) => o.kind === 'COLOR');
  const mine = me?.departmentIds ?? null;
  const departments = (useDepartments().data ?? []).filter(
    (d) => d.isActive && (!mine?.length || mine.includes(d.id)),
  );
  const groups = (useGroups().data ?? []).filter((g) =>
    departments.some((d) => d.id === g.departmentId),
  );
  const levels = usePriceLevels().data ?? [];
  const buyLevel = levels.find((l) => l.side === 'PURCHASE' && l.isDefault);
  const stores = (useWarehouses(true).data ?? []).filter((w) => w.kind === 'STORE' && w.isActive);

  const [supplier, setSupplier] = useState<Party | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [orderDate, setOrderDate] = useState(companyToday);
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useSavePurchaseOrder();

  // A store of the working branch by default.
  const workBranch = me?.branchId;
  const warehouse =
    stores.find((w) => w.id === warehouseId) ??
    (stores.length === 1
      ? stores[0]
      : stores.find((w) => w.branchId === workBranch && w.isDefault));
  useEffect(() => {
    if (!warehouseId && warehouse) setWarehouseId(warehouse.id);
  }, [warehouseId, warehouse]);

  // Changing an order: what it has.
  const loaded = useRef(false);
  useEffect(() => {
    const o = existing.data;
    if (!o || loaded.current) return;
    loaded.current = true;
    setSupplier({ id: o.partyId, name: o.partyName, code: o.partyCode } as Party);
    setWarehouseId(o.warehouseId);
    setDepartmentId(o.departmentId ?? '');
    setOrderDate(o.orderDate);
    setExpectedDate(o.expectedDate ?? '');
    setNotes(o.notes ?? '');
    setLines(o.lines.map(fromOrderLine));
  }, [existing.data]);

  // Opened from the supplier's card or "what to buy": that supplier.
  useEffect(() => {
    if (fromSupplier.data && !supplier) setSupplier(fromSupplier.data);
  }, [fromSupplier.data, supplier]);

  const suggestions = usePurchaseOrderSuggestions(
    supplier?.id,
    days,
    target,
    can('purchase_orders:create') || can('purchase_orders:edit'),
  );
  // From "what to buy": every suggested item comes on the order at once, its quantity changeable.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || editId || params.get('suggested') !== '1' || !suggestions.data) return;
    prefilled.current = true;
    const picks = suggestions.data.filter((s) => s.suggested > 0);
    if (picks.length) void addProducts(picks.map((s) => ({ id: s.productId, qty: s.suggested })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions.data]);

  function fromOrderLine(l: PurchaseOrder['lines'][number]): Line {
    return {
      key: l.id,
      productId: l.isNew ? undefined : (l.productId ?? undefined),
      name: l.name,
      detail: [l.sku, l.sizeName, l.colorName].filter(Boolean).join(' · '),
      isNew: l.isNew,
      unitId: l.unitId ?? '',
      units: l.unitId ? [{ unitId: l.unitId, name: l.unitName ?? '', factor: l.unitFactor }] : [],
      qty: String(l.quantity),
      price: major(l.unitPrice),
      departmentId: l.departmentId ?? undefined,
      groupId: l.groupId ?? undefined,
      sizeId: l.sizeId ?? undefined,
      colorId: l.colorId ?? undefined,
      supplierCode: l.supplierCode ?? undefined,
    };
  }

  /** Items of the catalog as lines (each once): the unit and price from the item. */
  function productLines(picks: FinderPick[]): Line[] {
    return picks.map(({ product: p, unitId, quantity }) => {
      const unit = p.units.find((u) => u.unitId === unitId) ?? p.units[0];
      const listed = unit?.prices.find((x) => x.priceLevelId === buyLevel?.id)?.price;
      return {
        key: nextKey(),
        productId: p.id,
        name: p.name,
        detail: [p.sku, p.sizeName, p.colorName].filter(Boolean).join(' · '),
        isNew: false,
        unitId: unit?.unitId ?? '',
        units: p.units.map((u) => ({ unitId: u.unitId, name: u.name, factor: u.factor })),
        qty: String(quantity || 1),
        price: major(listed ?? p.costPrice * (unit?.factor ?? 1)),
        supplierCode: p.supplierCode ?? undefined,
      };
    });
  }
  function addPicks(picks: FinderPick[]) {
    setLines((cur) => {
      const fresh = picks.filter((p) => !cur.some((l) => l.productId === p.product.id));
      return [...cur, ...productLines(fresh)];
    });
  }
  /** Suggested items, read in full so each keeps its units and prices. */
  async function addProducts(asked: { id: string; qty: number }[]) {
    const found = await api
      .get<FinderPick['product'][]>(`/products?limit=200&ids=${asked.map((a) => a.id).join(',')}`)
      .catch(() => []);
    addPicks(
      asked.flatMap((a) => {
        const product = found.find((p) => p.id === a.id);
        return product
          ? [{ product, unitId: product.units[0]?.unitId ?? '', quantity: a.qty }]
          : [];
      }),
    );
  }

  /** A new item may be ordered in any unit; an item of the catalog in its own. */
  const unitsOf = (l: Line) => (l.isNew ? allUnits : l.units);
  const set = (key: string, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const rows = lines.map((l) => {
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
    const price = Math.max(0, toMinor(Number(l.price) || 0));
    const factor = unitsOf(l).find((u) => u.unitId === l.unitId)?.factor ?? 1;
    return { l, qty, price, total: qty * price, pieces: qty * factor };
  });
  const total = rows.reduce((s, r) => s + r.total, 0);
  const pieces = rows.reduce((s, r) => s + r.pieces, 0);
  const ready =
    !!supplier && !!warehouse && rows.length > 0 && rows.every((r) => r.qty > 0 && r.l.name.trim());

  async function submit() {
    if (!ready || !supplier || !warehouse) return;
    setError(null);
    const out: PurchaseOrderLineInput[] = rows.map(({ l, qty, price }) =>
      l.isNew
        ? {
            name: l.name.trim(),
            quantity: qty,
            unitPrice: price,
            unitId: l.unitId || undefined,
            departmentId: l.departmentId || undefined,
            groupId: (l.departmentId && l.groupId) || undefined,
            sizeId: l.sizeId || undefined,
            colorId: l.colorId || undefined,
            supplierCode: l.supplierCode?.trim() || undefined,
          }
        : {
            productId: l.productId,
            quantity: qty,
            unitPrice: price,
            unitId: l.unitId || undefined,
          },
    );
    try {
      const order = await save.mutateAsync({
        id: editId,
        input: {
          partyId: supplier.id,
          warehouseId: warehouse.id,
          departmentId: departmentId || undefined,
          orderDate,
          expectedDate: expectedDate || undefined,
          notes: notes.trim() || undefined,
          lines: out,
        },
      });
      navigate(`/purchase-orders/${order.id}`, { replace: true });
    } catch (e) {
      setError(errorText(t, e));
    }
  }

  if (editId && existing.isLoading)
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );

  const label = (text: string, child: ReactNode, className = '') => (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-0.5 block text-xs text-muted">{text}</span>
      {child}
    </label>
  );
  const notOnOrder = (suggestions.data ?? []).filter(
    (s) => !lines.some((l) => l.productId === s.productId),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={editId ? `${t('po.edit')} ${existing.data?.number ?? ''}` : t('po.new')}
        action={
          <Button
            size="sm"
            variant="ghost"
            icon="close"
            onClick={() => navigate(editId ? `/purchase-orders/${editId}` : '/purchase-orders')}
          >
            {t('common.cancel')}
          </Button>
        }
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-1">
            <PartyPicker
              type="SUPPLIER"
              value={supplier}
              onChange={setSupplier}
              label={t('po.supplier')}
              placeholder={t('po.supplier')}
              withCode
            />
          </div>
          {label(
            t('po.deliverTo'),
            <select
              className={field}
              value={warehouse?.id ?? ''}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              {!warehouse && <option value="" />}
              {stores.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>,
          )}
          {label(
            t('po.department'),
            <select
              className={field}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              {!mine?.length && <option value="">{t('po.noDepartment')}</option>}
              {mine?.length && !departmentId && <option value="" />}
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>,
          )}
          {label(
            t('po.date'),
            <input
              type="date"
              className={`${field} tnum`}
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />,
          )}
          {label(
            t('po.expected'),
            <input
              type="date"
              className={`${field} tnum`}
              value={expectedDate}
              min={orderDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />,
          )}
          {label(
            t('po.notes'),
            <input
              className={field}
              value={notes}
              maxLength={1000}
              onChange={(e) => setNotes(e.target.value)}
            />,
          )}
        </div>
      </Card>

      {supplier && notOnOrder.length > 0 && (
        <SuggestionsCard
          rows={notOnOrder}
          money={money}
          onAdd={(picked) => void addProducts(picked)}
        />
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="font-semibold">{t('po.lines')}</h2>
          <Button size="sm" variant="secondary" icon="search" onClick={() => setFinding(true)}>
            {t('po.addItem')}
          </Button>
        </div>
        {rows.length === 0 ? (
          <EmptyState title={t('po.noLines')} icon="inventory" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="p-2 text-start font-medium">{t('po.item')}</th>
                  <th className="p-2 text-start font-medium">{t('po.unit')}</th>
                  <th className="p-2 text-end font-medium">{t('po.quantity')}</th>
                  <th className="p-2 text-end font-medium">{t('po.price')}</th>
                  <th className="p-2 text-end font-medium">{t('po.total')}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {rows.map(({ l, total: lineTotal }) => (
                  <tr key={l.key}>
                    <td className="p-2 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <bdi className="font-medium">{l.name}</bdi>
                        {l.isNew && <Badge tone="info">{t('po.newBadge')}</Badge>}
                      </div>
                      <p className="text-xs text-muted">
                        {l.isNew
                          ? [
                              departments.find((d) => d.id === l.departmentId)?.name,
                              groups.find((g) => g.id === l.groupId)?.name,
                              sizes.find((x) => x.id === l.sizeId)?.name,
                              colors.find((x) => x.id === l.colorId)?.name,
                              l.supplierCode && `${t('po.model')} ${l.supplierCode}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : l.detail}
                      </p>
                    </td>
                    <td className="p-2 align-top">
                      <select
                        className={`${field} w-28`}
                        value={l.unitId}
                        onChange={(e) => set(l.key, { unitId: e.target.value })}
                      >
                        {unitsOf(l).map((u) => (
                          <option key={u.unitId} value={u.unitId}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 align-top">
                      <input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        aria-label={t('po.quantity')}
                        className={`${field} w-24 text-end tnum`}
                        value={l.qty}
                        onChange={(e) => set(l.key, { qty: e.target.value })}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        aria-label={t('po.price')}
                        className={`${field} w-28 text-end tnum`}
                        value={l.price}
                        onChange={(e) => set(l.key, { price: e.target.value })}
                      />
                    </td>
                    <td className="p-2 text-end align-top tnum">{money(lineTotal)}</td>
                    <td className="p-2 text-end align-top">
                      <button
                        type="button"
                        aria-label={t('common.remove')}
                        title={t('common.remove')}
                        className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-destructive"
                        onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-2 font-semibold">
                <tr>
                  <td className="p-2">{t('po.total')}</td>
                  <td className="p-2" />
                  <td className="p-2 text-end tnum">
                    {formatNumber(pieces, locale)} {t('po.pieces')}
                  </td>
                  <td className="p-2" />
                  <td className="p-2 text-end tnum">{money(total)}</td>
                  <td className="p-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <NewItemCard
        units={units.map((u) => ({ unitId: u.id, name: u.name, factor: u.pieces ?? 1 }))}
        pieceUnitId={pieceUnit?.id ?? ''}
        departments={departments}
        groups={groups}
        sizes={sizes}
        colors={colors}
        defaultDepartment={departmentId}
        onAdd={(line) => setLines((cur) => [...cur, line])}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button
          icon="check"
          loading={save.isPending}
          disabled={!ready}
          onClick={() => void submit()}
        >
          {t('po.save')}
        </Button>
      </div>

      {finding && (
        <ItemFinderSheet
          departmentId={departmentId || undefined}
          warehouseId={warehouse?.id}
          branchId={warehouse?.branchId}
          onClose={() => setFinding(false)}
          onAdd={(items, close) => {
            addPicks(items);
            if (close) setFinding(false);
          }}
        />
      )}
    </div>
  );
}

/** The supplier's items to buy again: ticked ones go on the order with the quantity shown. */
function SuggestionsCard({
  rows,
  money,
  onAdd,
}: {
  rows: {
    productId: string;
    sku: string;
    name: string;
    stock: number;
    soldQty: number;
    suggested: number;
    cost: number;
  }[];
  money: (v: number) => string;
  onAdd: (picked: { id: string; qty: number }[]) => void;
}) {
  const { t, locale } = useT();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const n = (v: number) => formatNumber(v, locale);
  const chosen = rows.filter((r) => ticked[r.productId] ?? r.suggested > 0);
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="font-semibold">{t('po.suggestions')}</h2>
        <Button
          size="sm"
          icon="plus"
          disabled={chosen.length === 0}
          onClick={() =>
            onAdd(
              chosen.map((r) => ({
                id: r.productId,
                qty: Math.max(1, Math.floor(Number(qty[r.productId] ?? r.suggested) || 1)),
              })),
            )
          }
        >
          {t('po.addSuggested')}
        </Button>
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
            <tr>
              <th className="w-8 p-2" />
              <th className="p-2 text-start font-medium">{t('po.item')}</th>
              <th className="p-2 text-end font-medium">{t('po.stock')}</th>
              <th className="p-2 text-end font-medium">{t('po.sold')}</th>
              <th className="p-2 text-end font-medium">{t('buy.cost')}</th>
              <th className="p-2 text-end font-medium">{t('buy.suggested')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--c-line)]">
            {rows.map((r) => (
              <tr key={r.productId}>
                <td className="p-2">
                  <input
                    type="checkbox"
                    aria-label={r.name}
                    className="h-4 w-4 accent-[var(--c-brand)]"
                    checked={ticked[r.productId] ?? r.suggested > 0}
                    onChange={(e) => setTicked((x) => ({ ...x, [r.productId]: e.target.checked }))}
                  />
                </td>
                <td className="p-2">
                  <bdi>{r.name}</bdi>
                  <span className="ms-1 text-xs text-faint tnum">{r.sku}</span>
                </td>
                <td className="p-2 text-end tnum">{n(r.stock)}</td>
                <td className="p-2 text-end tnum">{n(r.soldQty)}</td>
                <td className="p-2 text-end tnum">{r.cost ? money(r.cost) : ''}</td>
                <td className="p-2 text-end">
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    aria-label={t('buy.suggested')}
                    className={`${field} ms-auto w-20 text-end tnum`}
                    value={qty[r.productId] ?? String(r.suggested || '')}
                    onChange={(e) => setQty((x) => ({ ...x, [r.productId]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** A new item not in the catalog yet: only named (it is made when its goods are received). */
function NewItemCard({
  units,
  pieceUnitId,
  departments,
  groups,
  sizes,
  colors,
  defaultDepartment,
  onAdd,
}: {
  units: Line['units'];
  pieceUnitId: string;
  departments: Parameters<typeof GroupPicker>[0]['departments'];
  groups: Parameters<typeof GroupPicker>[0]['groups'];
  sizes: { id: string; name: string }[];
  colors: { id: string; name: string }[];
  defaultDepartment: string;
  onAdd: (line: Line) => void;
}) {
  const { t } = useT();
  const blank = {
    name: '',
    qty: '1',
    price: '',
    departmentId: '',
    groupId: '',
    sizeId: '',
    colorId: '',
    unitId: '',
    supplierCode: '',
  };
  const [x, setX] = useState(blank);
  const [variant, setVariant] = useState(false);
  const put = (patch: Partial<typeof blank>) => setX((v) => ({ ...v, ...patch }));
  const departmentId = x.departmentId || defaultDepartment;
  const unitId = x.unitId || pieceUnitId;
  const ok = !!x.name.trim() && (Number(x.qty) || 0) >= 1 && !!unitId;
  const add = () => {
    if (!ok) return;
    onAdd({
      key: nextKey(),
      name: x.name.trim(),
      isNew: true,
      unitId,
      units,
      qty: x.qty,
      price: x.price,
      departmentId: departmentId || undefined,
      groupId: (departmentId && x.groupId) || undefined,
      sizeId: (variant && x.sizeId) || undefined,
      colorId: (variant && x.colorId) || undefined,
      supplierCode: x.supplierCode.trim() || undefined,
    });
    setX({ ...blank, departmentId: x.departmentId, unitId: x.unitId });
  };
  const box = (text: string, child: ReactNode, className = '') => (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-0.5 block text-xs text-muted">{text}</span>
      {child}
    </label>
  );
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <Icon name="plus" size={18} />
        {t('po.addNew')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {box(
          t('po.newName'),
          <input
            className={field}
            value={x.name}
            maxLength={200}
            onChange={(e) => put({ name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />,
          'sm:col-span-2',
        )}
        {box(
          t('po.model'),
          <input
            className={field}
            dir="ltr"
            value={x.supplierCode}
            maxLength={100}
            onChange={(e) => put({ supplierCode: e.target.value })}
          />,
        )}
        {box(
          t('po.unit'),
          <select
            className={field}
            value={unitId}
            onChange={(e) => put({ unitId: e.target.value })}
          >
            {units.map((u) => (
              <option key={u.unitId} value={u.unitId}>
                {u.name}
              </option>
            ))}
          </select>,
        )}
        <div className="sm:col-span-2">
          <GroupPicker
            departments={departments}
            groups={groups}
            departmentId={departmentId}
            groupId={x.groupId}
            onChange={(d, g) => put({ departmentId: d, groupId: g })}
          />
        </div>
        {box(
          t('po.quantity'),
          <input
            type="number"
            min={1}
            inputMode="numeric"
            className={`${field} tnum`}
            value={x.qty}
            onChange={(e) => put({ qty: e.target.value })}
          />,
        )}
        {box(
          t('po.price'),
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className={`${field} tnum`}
            value={x.price}
            onChange={(e) => put({ price: e.target.value })}
          />,
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--c-brand)]"
            checked={variant}
            onChange={(e) => setVariant(e.target.checked)}
          />
          {t('po.withVariant')}
        </label>
        {variant && (
          <>
            {box(
              t('po.size'),
              <select
                className={field}
                value={x.sizeId}
                onChange={(e) => put({ sizeId: e.target.value })}
              >
                <option value="" />
                {sizes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>,
            )}
            {box(
              t('po.color'),
              <select
                className={field}
                value={x.colorId}
                onChange={(e) => put({ colorId: e.target.value })}
              >
                <option value="" />
                {colors.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>,
            )}
          </>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="secondary" icon="plus" disabled={!ok} onClick={add}>
          {t('po.add')}
        </Button>
      </div>
    </Card>
  );
}
