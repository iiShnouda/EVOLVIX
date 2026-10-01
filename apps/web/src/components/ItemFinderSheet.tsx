import { useMemo, useState } from 'react';
import { formatMoney, formatQuantity, type Product } from '@skb/shared';
import { Sheet } from './Sheet';
import { Button, Spinner } from './ui';
import { useT } from '../lib/i18n';
import {
  useCategories,
  useDepartments,
  useItemFinder,
  useParties,
  type ItemFinderFilters,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

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

/**
 * The detailed item search (البحث المفصل), as in the old program (owner, 2026-10-01): department,
 * category, supplier (or none), code and name "contain", a list-price range and stock (in, out, at
 * the reorder level). "Show" lists what matches; ticked items are added to the invoice at once.
 * Prices are list prices; cost is never shown here.
 */
export function ItemFinderSheet({
  onAdd,
  onClose,
  departmentId,
  inStockFirst,
}: {
  onAdd: (items: Product[]) => void;
  onClose: () => void;
  /** The invoice's department: only its items (and items of no department). */
  departmentId?: string;
  /** Sales start with in-stock items only. */
  inStockFirst?: boolean;
}) {
  const { t, locale } = useT();
  const departments = useDepartments();
  const categories = useCategories();
  const suppliers = useParties({ page: 1, pageSize: 100, type: 'SUPPLIER', active: true });
  const [draft, setDraft] = useState<ItemFinderFilters>({
    ...EMPTY,
    departmentId: departmentId ?? '',
    stock: inStockFirst ? 'in' : '',
  });
  const [applied, setApplied] = useState<ItemFinderFilters>(draft);
  const [run, setRun] = useState(0);
  const found = useItemFinder(applied, run);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const set = (patch: Partial<ItemFinderFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const rows = found.data ?? [];
  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );
  const shownCategories = (categories.data ?? []).filter(
    (c) => !draft.departmentId || !c.departmentId || c.departmentId === draft.departmentId,
  );

  function show() {
    setApplied(draft);
    setRun((n) => n + 1);
    setPicked(new Set());
  }
  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allPicked = rows.length > 0 && rows.every((p) => picked.has(p.id));

  return (
    <Sheet title={t('finder.title')} onClose={onClose} closeLabel={t('common.close')} wide="full">
      <div className="space-y-3">
        <p className="text-xs text-faint">{t('finder.hint')}</p>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            show();
          }}
        >
          {/* A sale's department is fixed by the invoice. */}
          {!departmentId && (departments.data ?? []).length > 0 && (
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('finder.department')}</span>
              <select
                className={field}
                value={draft.departmentId}
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
              value={draft.categoryId}
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
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('finder.supplier')}</span>
            <select
              className={field}
              value={draft.supplierId}
              onChange={(e) => set({ supplierId: e.target.value })}
            >
              <option value="">{t('finder.all')}</option>
              <option value="none">{t('finder.noSupplier')}</option>
              {(suppliers.data?.items ?? []).map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name} ({sp.code})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('finder.code')}</span>
            <input
              className={field}
              value={draft.code}
              onChange={(e) => set({ code: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('finder.name')}</span>
            <input
              className={field}
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('finder.priceFrom')}</span>
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              className={`${field} tnum`}
              value={draft.minPrice}
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
              value={draft.maxPrice}
              onChange={(e) => set({ maxPrice: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('finder.stock')}</span>
            <select
              className={field}
              value={draft.stock}
              onChange={(e) => set({ stock: e.target.value as ItemFinderFilters['stock'] })}
            >
              <option value="">{t('finder.stockAny')}</option>
              <option value="in">{t('finder.stockIn')}</option>
              <option value="out">{t('finder.stockOut')}</option>
              <option value="low">{t('finder.stockLow')}</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" icon="search" className="w-full">
              {t('finder.show')}
            </Button>
          </div>
        </form>

        <div className="overflow-hidden rounded-[var(--radius-app)] border border-line">
          {run === 0 ? null : found.isLoading ? (
            <div className="grid place-items-center py-10 text-muted">
              <Spinner size={22} />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted">{t('common.empty')}</p>
          ) : (
            <div className="max-h-[50vh] overflow-auto">
              <table className="w-full whitespace-nowrap text-[13px]">
                <thead className="sticky top-0 border-b border-line bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="w-8 px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label={t('finder.add')}
                        checked={allPicked}
                        onChange={() =>
                          setPicked(allPicked ? new Set() : new Set(rows.map((p) => p.id)))
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--c-line)]">
                  {rows.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => toggle(p.id)}
                      className={`cursor-pointer hover:bg-surface-2 ${picked.has(p.id) ? 'bg-brand-soft' : ''}`}
                    >
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={p.name}
                          checked={picked.has(p.id)}
                          onChange={() => toggle(p.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-muted">
                        {categoryName.get(p.categoryId) ?? ''}
                      </td>
                      <td className="px-2 py-1.5 tnum">{p.sku}</td>
                      <td className="max-w-64 truncate px-2 py-1.5 font-medium">{p.name}</td>
                      <td className="px-2 py-1.5 text-muted">{p.supplierName ?? ''}</td>
                      <td className="px-2 py-1.5 text-end tnum">
                        {formatMoney(p.salePrice, p.currency, locale)}
                      </td>
                      <td className="px-2 py-1.5 text-end tnum">{p.reorderLevel || ''}</td>
                      <td
                        className={`px-2 py-1.5 text-end tnum ${p.stockOnHand <= 0 ? 'text-destructive' : p.reorderLevel > 0 && p.stockOnHand <= p.reorderLevel ? 'text-warning' : ''}`}
                      >
                        {formatQuantity(p.stockOnHand, p.units, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted tnum">
            {run > 0 && (
              <>
                {rows.length} {t('finder.found')}
                {picked.size > 0 && (
                  <>
                    {' '}
                    · {picked.size} {t('finder.selected')}
                  </>
                )}
              </>
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              icon="check"
              disabled={picked.size === 0}
              onClick={() => onAdd(rows.filter((p) => picked.has(p.id)))}
            >
              {t('finder.add')}
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
