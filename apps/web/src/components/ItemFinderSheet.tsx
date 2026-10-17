import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney, formatQuantity, type Party, type Product } from '@skb/shared';
import { PartyPicker } from './PartyPicker';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { Button, Spinner } from './ui';
import { useT } from '../lib/i18n';
import { GroupPicker } from './GroupTree';
import {
  useDepartments,
  useGroups,
  useItemFinder,
  usePageSize,
  useSeasons,
  useWarehouses,
  type ItemFinderFilters,
  type RangeFilter,
} from '../lib/queries';
import { useCan } from '../lib/can';
import { TableColumns } from './TableColumns';
import { Pager } from './Pager';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';
const cell =
  'h-8 rounded-[var(--radius-app)] border border-line bg-surface px-1.5 text-sm outline-none focus:border-brand';

const NO_RANGE: RangeFilter = { op: 'eq', value: '' };
const EMPTY: ItemFinderFilters = {
  branchId: '',
  onlyDepartment: false,
  departmentId: '',
  groupId: '',
  seasonId: '',
  warehouseId: '',
  supplierId: '',
  code: '',
  name: '',
  stock: '',
  sale: NO_RANGE,
  cost: NO_RANGE,
  reorder: NO_RANGE,
  balance: NO_RANGE,
};

/** A number condition: =, > or <, and the value (owner, 2026-10-01: a wider search). */
function Range({
  label,
  value,
  onChange,
  money,
}: {
  label: string;
  value: RangeFilter;
  onChange: (v: RangeFilter) => void;
  money?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs text-muted">{label}</span>
      <span className="flex gap-1">
        <select
          className="h-9 w-14 shrink-0 rounded-[var(--radius-app)] border border-line bg-surface px-1 text-sm outline-none focus:border-brand"
          value={value.op}
          aria-label={label}
          onChange={(e) => onChange({ ...value, op: e.target.value as RangeFilter['op'] })}
        >
          <option value="eq">=</option>
          <option value="gt">&gt;</option>
          <option value="lt">&lt;</option>
        </select>
        <input
          type="number"
          min={0}
          step={money ? '0.01' : '1'}
          inputMode={money ? 'decimal' : 'numeric'}
          className={`${field} tnum`}
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
        />
      </span>
    </label>
  );
}

/** One item to put on the invoice. */
export interface FinderPick {
  product: Product;
  unitId: string;
  quantity: number;
}

/** The value after a short pause in typing. */
function useSettled<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * The detailed item search (البحث المفصل), as in the old program (owner, 2026-10-01): department,
 * category, supplier (or none), code and name "contain", a list-price range and stock. The list
 * follows the filters as they are typed. Each row takes a unit and a quantity: Enter or + puts that
 * row on the invoice at once and moves to the next; "Add selected" puts every row with a quantity.
 * Prices are list prices; cost is never shown here.
 */
export function ItemFinderSheet({
  onAdd,
  onClose,
  departmentId,
  warehouseId,
  inStockFirst,
  checkStock,
  onInvoice,
  branchId,
  lockPlace,
}: {
  /** `close`: the person is done (Add selected), else the sheet stays open for more. */
  onAdd: (items: FinderPick[], close: boolean) => void;
  onClose: () => void;
  /** The invoice's department: only its items (and items of no department). */
  departmentId?: string;
  /** The invoice's warehouse: the search starts at its stock. */
  warehouseId?: string;
  /** Sales start with in-stock items only. */
  inStockFirst?: boolean;
  /** Sales: mark a quantity above the stock. */
  checkStock?: boolean;
  /** Base quantity of each item already on the invoice. */
  onInvoice?: Map<string, number>;
  /** The invoice's branch: the search starts in it. */
  branchId?: string;
  /** A sale's branch, warehouse and department are the invoice's: shown, not changed. */
  lockPlace?: boolean;
}) {
  const { t, locale } = useT();
  const departments = useDepartments();
  const seasons = useSeasons();
  const warehouses = useWarehouses(true);
  const seeCosts = useCan()('costs:view');
  const [supplier, setSupplier] = useState<Party | null>(null);
  // Only the invoice's department's own items (owner, 2026-10-02).
  const start: ItemFinderFilters = {
    ...EMPTY,
    branchId: branchId ?? '',
    departmentId: departmentId ?? '',
    onlyDepartment: !!departmentId,
    warehouseId: warehouseId ?? '',
    stock: inStockFirst ? 'in' : '',
  };
  const [stop, setStop] = useState('');
  const [filters, setFilters] = useState<ItemFinderFilters>(start);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [savedSize, saveSize] = usePageSize('itemFinder', 50);
  useEffect(() => setSize(savedSize), [savedSize]);
  const settled = useSettled(filters);
  // Other filters start again at the first page.
  useEffect(() => setPage(1), [settled]);
  const found = useItemFinder(settled, page, size);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Set<string>>(new Set());
  const table = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<ItemFinderFilters>) => setFilters((d) => ({ ...d, ...patch }));
  // Branches from the warehouses the person may see; warehouses of the chosen branch; departments
  // of the chosen warehouse.
  const stores = (warehouses.data ?? []).filter((w) => w.kind !== 'TRANSIT');
  const branchList = [
    ...new Map(stores.map((w) => [w.branchId, { id: w.branchId, name: w.branchName }])).values(),
  ];
  const storeList = stores.filter((w) => !filters.branchId || w.branchId === filters.branchId);
  const departmentList = (departments.data ?? []).filter(
    (d) =>
      d.id === filters.departmentId ||
      (d.isActive &&
        (!filters.warehouseId ||
          !d.warehouseIds?.length ||
          d.warehouseIds.includes(filters.warehouseId))),
  );
  const groups = (useGroups().data ?? []).filter(
    (g) => g.isActive && g.departmentId === filters.departmentId,
  );
  const rows = useMemo(() => found.data?.items ?? [], [found.data]);

  const unitOf = (p: Product) => unit[p.id] ?? p.units[0]?.unitId ?? '';
  const qtyOf = (p: Product) => Math.max(0, Math.floor(Number(qty[p.id]) || 0));
  const factorOf = (p: Product) => p.units.find((u) => u.unitId === unitOf(p))?.factor ?? 1;
  const overStock = (p: Product) =>
    !!checkStock && qtyOf(p) * factorOf(p) + (onInvoice?.get(p.id) ?? 0) > p.stockOnHand;
  const picked = rows.filter((p) => qtyOf(p) > 0);
  const pickedQty = picked.reduce((n, p) => n + qtyOf(p), 0);
  const allPicked = rows.length > 0 && rows.every((p) => qtyOf(p) > 0);

  function setRowQty(id: string, value: string) {
    setQty((q) => {
      const next = { ...q };
      if (value === '' || Number(value) <= 0) delete next[id];
      else next[id] = value;
      return next;
    });
  }
  function toggle(p: Product) {
    setRowQty(p.id, qtyOf(p) > 0 ? '' : '1');
  }

  /** Put one row on the invoice now, and go to the next row's quantity. */
  function addNow(p: Product, index: number) {
    const quantity = qtyOf(p) || 1;
    // Never more than is in stock (owner, 2026-10-02); the server refuses it too.
    if (checkStock && quantity * factorOf(p) + (onInvoice?.get(p.id) ?? 0) > p.stockOnHand) {
      setStop(`${p.name}: ${t('finder.overStock')}`);
      return;
    }
    setStop('');
    onAdd([{ product: p, unitId: unitOf(p), quantity }], false);
    setRowQty(p.id, '');
    setAdded((s) => new Set(s).add(p.id));
    setTimeout(
      () =>
        setAdded((s) => {
          const next = new Set(s);
          next.delete(p.id);
          return next;
        }),
      1500,
    );
    const nextBox = table.current?.querySelector<HTMLInputElement>(`[data-qty="${index + 1}"]`);
    nextBox?.focus();
    nextBox?.select();
  }

  function addPicked() {
    const over = picked.find(overStock);
    if (over) {
      setStop(`${over.name}: ${t('finder.overStock')}`);
      return;
    }
    setStop('');
    onAdd(
      picked.map((p) => ({ product: p, unitId: unitOf(p), quantity: qtyOf(p) })),
      true,
    );
  }

  return (
    <Sheet
      title={t('finder.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide="full"
      fill
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* The filters in three even rows (owner, 2026-10-02): where, what, and the numbers. */}
        <div className="shrink-0 space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('list.branch')}</span>
              <select
                className={field}
                disabled={lockPlace}
                value={filters.branchId}
                onChange={(e) =>
                  set({ branchId: e.target.value, warehouseId: '', departmentId: '', groupId: '' })
                }
              >
                <option value="">{t('finder.all')}</option>
                {branchList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('list.warehouse')}</span>
              <select
                className={field}
                disabled={lockPlace}
                value={filters.warehouseId}
                onChange={(e) =>
                  set({ warehouseId: e.target.value, departmentId: '', groupId: '' })
                }
              >
                <option value="">{t('finder.all')}</option>
                {storeList.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('finder.department')}</span>
              <select
                className={field}
                disabled={!!departmentId && lockPlace}
                value={filters.departmentId}
                onChange={(e) =>
                  set({
                    departmentId: e.target.value,
                    groupId: '',
                    onlyDepartment: !!e.target.value,
                  })
                }
              >
                <option value="">{t('finder.all')}</option>
                {departmentList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('item.season')}</span>
              <select
                className={field}
                value={filters.seasonId}
                onChange={(e) => set({ seasonId: e.target.value })}
              >
                <option value="">{t('finder.all')}</option>
                {(seasons.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {/* The department's tree, level by level (owner, 2026-10-06). */}
          {filters.departmentId && groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-app)] bg-surface-2 px-2 py-1.5">
              <span className="text-xs text-muted">{t('groups.tab')}</span>
              <GroupPicker
                departments={departments.data ?? []}
                groups={groups}
                departmentId={filters.departmentId}
                groupId={filters.groupId ?? ''}
                showDepartment={false}
                anyLabel={t('finder.all')}
                onChange={(_, g) => set({ groupId: g })}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('finder.name')}</span>
              <input
                autoFocus
                className={field}
                value={filters.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('finder.code')}</span>
              <input
                className={field}
                value={filters.code}
                onChange={(e) => set({ code: e.target.value })}
              />
            </label>
            {/* The supplier by code or name, or items of none (بدون): then no supplier can be picked. */}
            <div className="col-span-2">
              <PartyPicker
                type="SUPPLIER"
                withCode
                value={supplier}
                disabled={filters.supplierId === 'none'}
                onChange={(p) => {
                  setSupplier(p);
                  set({ supplierId: p?.id ?? '' });
                }}
                label={t('finder.supplier')}
                placeholder={t('finder.all')}
              />
              <label className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={filters.supplierId === 'none'}
                  onChange={(e) => {
                    setSupplier(null);
                    set({ supplierId: e.target.checked ? 'none' : '' });
                  }}
                />
                {t('finder.noSupplier')}
              </label>
            </div>
          </div>
          <div
            className={`grid grid-cols-2 gap-2.5 ${seeCosts ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}
          >
            <Range
              label={t('finder.salePrice')}
              money
              value={filters.sale}
              onChange={(sale) => set({ sale })}
            />
            {seeCosts && (
              <Range
                label={t('finder.costPrice')}
                money
                value={filters.cost}
                onChange={(cost) => set({ cost })}
              />
            )}
            <Range
              label={t('invoice.balance')}
              value={filters.balance}
              onChange={(balance) => set({ balance })}
            />
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('finder.stock')}</span>
              <select
                className={field}
                value={filters.stock}
                onChange={(e) => set({ stock: e.target.value as ItemFinderFilters['stock'] })}
              >
                <option value="">{t('finder.stockAny')}</option>
                <option value="in">{t('finder.stockIn')}</option>
                <option value="out">{t('finder.stockOut')}</option>
                <option value="low">{t('finder.stockLow')}</option>
              </select>
            </label>
            <div className="flex items-end">
              <Button
                variant="secondary"
                className="w-full"
                icon="close"
                onClick={() => {
                  setFilters(start);
                  setSupplier(null);
                }}
              >
                {t('finder.reset')}
              </Button>
            </div>
          </div>
          {stop && (
            <p className="rounded-[var(--radius-app)] bg-destructive-soft px-3 py-2 text-sm text-destructive">
              {stop}
            </p>
          )}
        </div>

        {/* Only the list scrolls (owner, 2026-10-01). */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-app)] border border-line">
          {found.isLoading ? (
            <div className="grid place-items-center py-10 text-muted">
              <Spinner size={22} />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted">{t('common.empty')}</p>
          ) : (
            <div
              ref={table}
              className={`min-h-0 flex-1 overflow-auto transition-opacity ${found.isPlaceholderData ? 'opacity-60' : ''}`}
            >
              <TableColumns id="itemFinder">
                {/* What to pick comes first, so the add button is never off the screen. */}
                <table className="w-full whitespace-nowrap text-[13px]">
                  <thead className="sticky top-0 z-10 border-b border-line bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="w-8 px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label={t('finder.add')}
                          checked={allPicked}
                          onChange={() =>
                            setQty(
                              allPicked
                                ? {}
                                : Object.fromEntries(
                                    rows.map((p) => [p.id, qty[p.id] ?? '1'] as const),
                                  ),
                            )
                          }
                        />
                      </th>
                      <th className="px-2 py-2 text-start font-medium">{t('common.code')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('invoice.item')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('finder.unit')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('finder.qty')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('finder.addOne')}</th>
                      <th className="px-2 py-2 text-end font-medium">{t('invoice.price')}</th>
                      {seeCosts && (
                        <th className="px-2 py-2 text-end font-medium">{t('finder.costPrice')}</th>
                      )}
                      <th className="px-2 py-2 text-end font-medium">{t('invoice.balance')}</th>
                      <th className="px-2 py-2 text-end font-medium">{t('finder.onInvoice')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('finder.supplier')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('finder.category')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('item.season')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--c-line)]">
                    {rows.map((p, i) => {
                      const on = qtyOf(p) > 0;
                      const over = overStock(p);
                      const already = onInvoice?.get(p.id) ?? 0;
                      const empty = !!checkStock && p.stockOnHand - already <= 0;
                      return (
                        <tr
                          key={p.id}
                          className={`hover:bg-surface-2 ${on ? 'bg-brand-soft' : ''} ${added.has(p.id) ? 'bg-positive-soft' : ''}`}
                        >
                          <td className="px-2 py-1 text-center">
                            <input
                              type="checkbox"
                              aria-label={p.name}
                              checked={on}
                              disabled={empty}
                              onChange={() => toggle(p)}
                            />
                          </td>
                          <td className="px-2 py-1 tnum">{p.sku}</td>
                          <td
                            className="max-w-64 cursor-pointer truncate px-2 py-1 font-medium"
                            onClick={() => !empty && toggle(p)}
                          >
                            {p.name}
                          </td>
                          <td className="px-2 py-1">
                            <select
                              className={`${cell} w-24`}
                              value={unitOf(p)}
                              disabled={p.units.length < 2}
                              aria-label={t('finder.unit')}
                              onChange={(e) => setUnit((u) => ({ ...u, [p.id]: e.target.value }))}
                            >
                              {p.units.map((u) => (
                                <option key={u.unitId} value={u.unitId}>
                                  {u.name}
                                  {u.factor > 1 ? ` (${u.factor})` : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1">
                            <input
                              type="number"
                              min={0}
                              step={1}
                              inputMode="numeric"
                              data-qty={i}
                              aria-label={t('finder.qty')}
                              title={over ? t('finder.overStock') : undefined}
                              disabled={empty}
                              className={`${cell} w-20 tnum ${over ? 'border-destructive text-destructive' : ''}`}
                              value={qty[p.id] ?? ''}
                              onChange={(e) => setRowQty(p.id, e.target.value)}
                              onFocus={(e) => e.target.select()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addNow(p, i);
                                }
                              }}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              title={t('finder.addOne')}
                              aria-label={`${t('finder.addOne')} ${p.name}`}
                              disabled={empty || over}
                              onClick={() => addNow(p, i)}
                              className={`flex h-8 items-center gap-1 rounded-[var(--radius-app)] px-2.5 text-xs font-semibold disabled:opacity-40 ${added.has(p.id) ? 'bg-positive text-white' : 'bg-brand text-brand-fg hover:opacity-90'}`}
                            >
                              <Icon name={added.has(p.id) ? 'check' : 'plus'} size={15} />
                              {t('finder.addShort')}
                            </button>
                          </td>
                          <td className="px-2 py-1 text-end tnum">
                            {formatMoney(p.salePrice, p.currency, locale)}
                          </td>
                          {seeCosts && (
                            <td className="px-2 py-1 text-end tnum text-muted">
                              {formatMoney(p.costPrice, p.currency, locale)}
                            </td>
                          )}
                          <td
                            className={`px-2 py-1 text-end tnum ${p.stockOnHand <= 0 ? 'text-destructive' : p.reorderLevel > 0 && p.stockOnHand <= p.reorderLevel ? 'text-warning' : ''}`}
                          >
                            {formatQuantity(p.stockOnHand, p.units, locale)}
                          </td>
                          <td className="px-2 py-1 text-end tnum text-brand">
                            {already > 0 ? formatQuantity(already, p.units, locale) : ''}
                          </td>
                          <td className="px-2 py-1 text-muted">{p.supplierName ?? ''}</td>
                          <td className="px-2 py-1 text-muted">{p.departmentName ?? ''}</td>
                          <td className="px-2 py-1 text-muted">{p.seasonName ?? ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableColumns>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <Pager
            page={page}
            size={size}
            hasMore={found.data?.hasMore}
            onPage={setPage}
            onSize={(n) => {
              setSize(n);
              setPage(1);
              saveSize(n);
            }}
          />
          <span className="flex items-center gap-2 text-xs text-muted tnum">
            {rows.length} {t('finder.found')}
            {picked.length > 0 && (
              <>
                {' '}
                · {picked.length} {t('finder.selected')} · {t('finder.qty')} {pickedQty}
              </>
            )}
            {found.isFetching && <Spinner size={12} />}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button icon="check" disabled={picked.length === 0} onClick={addPicked}>
              {t('finder.add')}
              {picked.length > 0 && <span className="tnum"> ({picked.length})</span>}
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
