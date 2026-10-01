import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney, formatQuantity, type Party, type Product } from '@skb/shared';
import { PartyPicker } from './PartyPicker';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { Button, Spinner } from './ui';
import { useT } from '../lib/i18n';
import {
  useCategories,
  useDepartments,
  useItemFinder,
  type ItemFinderFilters,
} from '../lib/queries';
import { TableColumns } from './TableColumns';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';
const cell =
  'h-8 rounded-[var(--radius-app)] border border-line bg-surface px-1.5 text-sm outline-none focus:border-brand';

const EMPTY: ItemFinderFilters = {
  departmentId: '',
  categoryId: '',
  supplierId: '',
  code: '',
  name: '',
  minPrice: '',
  maxPrice: '',
  stock: '',
};

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
  inStockFirst,
  checkStock,
  onInvoice,
}: {
  /** `close`: the person is done (Add selected), else the sheet stays open for more. */
  onAdd: (items: FinderPick[], close: boolean) => void;
  onClose: () => void;
  /** The invoice's department: only its items (and items of no department). */
  departmentId?: string;
  /** Sales start with in-stock items only. */
  inStockFirst?: boolean;
  /** Sales: mark a quantity above the stock. */
  checkStock?: boolean;
  /** Base quantity of each item already on the invoice. */
  onInvoice?: Map<string, number>;
}) {
  const { t, locale } = useT();
  const departments = useDepartments();
  const categories = useCategories();
  const [supplier, setSupplier] = useState<Party | null>(null);
  const start: ItemFinderFilters = {
    ...EMPTY,
    departmentId: departmentId ?? '',
    stock: inStockFirst ? 'in' : '',
  };
  const [filters, setFilters] = useState<ItemFinderFilters>(start);
  const found = useItemFinder(useSettled(filters));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Set<string>>(new Set());
  const table = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<ItemFinderFilters>) => setFilters((d) => ({ ...d, ...patch }));
  const rows = found.data ?? [];
  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );
  const shownCategories = (categories.data ?? []).filter(
    (c) => !filters.departmentId || !c.departmentId || c.departmentId === filters.departmentId,
  );

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
    onAdd(
      picked.map((p) => ({ product: p, unitId: unitOf(p), quantity: qtyOf(p) })),
      true,
    );
  }

  return (
    <Sheet title={t('finder.title')} onClose={onClose} closeLabel={t('common.close')} wide="full">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          {/* A sale's department is fixed by the invoice. */}
          {!departmentId && (departments.data ?? []).length > 0 && (
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('finder.department')}</span>
              <select
                className={field}
                value={filters.departmentId}
                onChange={(e) => set({ departmentId: e.target.value, categoryId: '' })}
              >
                <option value="">{t('finder.all')}</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('finder.category')}</span>
            <select
              className={field}
              value={filters.categoryId}
              onChange={(e) => set({ categoryId: e.target.value })}
            >
              <option value="">{t('finder.all')}</option>
              {shownCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {/* The supplier (factory) by code or name, or items of none (بدون), as on the old screen. */}
          <div className="sm:col-span-2">
            <PartyPicker
              type="SUPPLIER"
              withCode
              value={supplier}
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
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('finder.priceFrom')}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={`${field} tnum`}
                value={filters.minPrice}
                onChange={(e) => set({ minPrice: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('finder.priceTo')}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={`${field} tnum`}
                value={filters.maxPrice}
                onChange={(e) => set({ maxPrice: e.target.value })}
              />
            </label>
          </div>
          <div className="flex items-end gap-2">
            <label className="block flex-1">
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
            <Button
              variant="secondary"
              onClick={() => {
                setFilters(start);
                setSupplier(null);
              }}
            >
              {t('finder.reset')}
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-[var(--radius-app)] border border-line">
          {found.isLoading ? (
            <div className="grid place-items-center py-10 text-muted">
              <Spinner size={22} />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted">{t('common.empty')}</p>
          ) : (
            <div
              ref={table}
              className={`max-h-[55vh] overflow-auto transition-opacity ${found.isPlaceholderData ? 'opacity-60' : ''}`}
            >
              <TableColumns id="itemFinder">
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
                      <th className="px-2 py-2 text-start font-medium">{t('finder.category')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('common.code')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('invoice.item')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('finder.supplier')}</th>
                      <th className="px-2 py-2 text-end font-medium">{t('invoice.price')}</th>
                      <th className="px-2 py-2 text-end font-medium">{t('inventory.reorder')}</th>
                      <th className="px-2 py-2 text-end font-medium">{t('invoice.balance')}</th>
                      <th className="px-2 py-2 text-end font-medium">{t('finder.onInvoice')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('finder.unit')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('finder.qty')}</th>
                      <th className="w-10 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--c-line)]">
                    {rows.map((p, i) => {
                      const on = qtyOf(p) > 0;
                      const over = overStock(p);
                      const already = onInvoice?.get(p.id) ?? 0;
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
                              onChange={() => toggle(p)}
                            />
                          </td>
                          <td className="px-2 py-1 text-muted">
                            {categoryName.get(p.categoryId) ?? ''}
                          </td>
                          <td className="px-2 py-1 tnum">{p.sku}</td>
                          <td
                            className="max-w-64 cursor-pointer truncate px-2 py-1 font-medium"
                            onClick={() => toggle(p)}
                          >
                            {p.name}
                          </td>
                          <td className="px-2 py-1 text-muted">{p.supplierName ?? ''}</td>
                          <td className="px-2 py-1 text-end tnum">
                            {formatMoney(p.salePrice, p.currency, locale)}
                          </td>
                          <td className="px-2 py-1 text-end tnum">{p.reorderLevel || ''}</td>
                          <td
                            className={`px-2 py-1 text-end tnum ${p.stockOnHand <= 0 ? 'text-destructive' : p.reorderLevel > 0 && p.stockOnHand <= p.reorderLevel ? 'text-warning' : ''}`}
                          >
                            {formatQuantity(p.stockOnHand, p.units, locale)}
                          </td>
                          <td className="px-2 py-1 text-end tnum text-brand">
                            {already > 0 ? formatQuantity(already, p.units, locale) : ''}
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
                              onClick={() => addNow(p, i)}
                              className={`grid h-8 w-8 place-items-center rounded-[var(--radius-app)] ${added.has(p.id) ? 'bg-positive text-white' : 'bg-brand text-brand-fg hover:opacity-90'}`}
                            >
                              <Icon name={added.has(p.id) ? 'check' : 'plus'} size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableColumns>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
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
