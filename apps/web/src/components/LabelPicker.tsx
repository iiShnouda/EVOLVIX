import { useEffect, useState } from 'react';
import { formatNumber, type InventoryItem, type InventoryList, type Party } from '@skb/shared';
import { Button, Spinner } from './ui';
import { Icon } from './Icon';
import { PartyPicker } from './PartyPicker';
import { WarehouseSelect } from './WarehouseSelect';
import { Pager } from './Pager';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import { useDepartments, useInventory, usePageSize } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

export interface LabelPick {
  id: string;
  /** Its stock where the filter looks (for "as many labels as pieces"). */
  stock: number;
}

/**
 * Choose items for labels right on the page (owner, 2026-10-18: the detailed search made no sense
 * here): the inventory's own filters — branch, warehouse, department, code, name, supplier, only
 * what is in stock — a page of results to tick, or every item the filters find.
 */
export function LabelPicker({ onAdd }: { onAdd: (picks: LabelPick[]) => void }) {
  const { t, locale } = useT();
  const myBranches = useAuth((s) => s.user?.branches ?? []);
  const departments = (useDepartments().data ?? []).filter((d) => d.isActive);
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [supplier, setSupplier] = useState<Party | null>(null);
  const [inStock, setInStock] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('labels.picker', 50);
  const [ticked, setTicked] = useState<Map<string, number>>(new Map());
  const [loadingAll, setLoadingAll] = useState(false);

  const filters = {
    search: name.trim() || undefined,
    code: code.trim() || undefined,
    supplierId: supplier?.id,
    warehouseId: warehouseId || undefined,
    branchId: (!warehouseId && branchId) || undefined,
    departmentId: departmentId || undefined,
    inStock: inStock ? 'true' : undefined,
  };
  const key = JSON.stringify(filters);
  useEffect(() => setPage(1), [key]);
  const list = useInventory({ ...filters, inStock, page, pageSize, sort: 'name' });
  const stockOf = (i: InventoryItem) => Math.max(0, i.stockOnHand);
  const rows = list.data?.items ?? [];
  const pages = Math.max(1, Math.ceil((list.data?.matched ?? 0) / pageSize));

  /** Every item the filters find, a page of 500 at a time. */
  async function addAll() {
    setLoadingAll(true);
    try {
      const picks: LabelPick[] = [];
      for (let p = 1; p <= 20; p++) {
        const q = new URLSearchParams({ page: String(p), pageSize: '500', sort: 'name' });
        for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
        const res = await api.get<InventoryList>(`/inventory/items?${q}`);
        for (const i of res.items) picks.push({ id: i.id, stock: stockOf(i) });
        if (p * 500 >= (res.matched ?? 0)) break;
      }
      onAdd(picks);
    } finally {
      setLoadingAll(false);
    }
  }

  const allTicked = rows.length > 0 && rows.every((r) => ticked.has(r.id));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('list.branch')}</span>
          <select
            className={field}
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setWarehouseId('');
            }}
          >
            <option value="">{t('common.all')}</option>
            {myBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <WarehouseSelect
          label={t('list.warehouse')}
          value={warehouseId}
          onChange={setWarehouseId}
          allowAll
        />
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('invoice.department')}</span>
          <select
            className={field}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">{t('common.all')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} />
          {t('labels.inStockOnly')}
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('inventory.sku')}</span>
          <input
            className={`${field} tnum`}
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('inventory.itemName')}</span>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="sm:col-span-2">
          <PartyPicker
            type="SUPPLIER"
            withCode
            value={supplier}
            onChange={setSupplier}
            label={t('inventory.supplier')}
            placeholder={t('common.all')}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-app)] border border-line">
        {list.isLoading ? (
          <div className="grid place-items-center py-8 text-muted">
            <Spinner size={22} />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs text-muted">
              <tr>
                <th className="w-10 p-2">
                  <input
                    type="checkbox"
                    aria-label={t('common.all')}
                    checked={allTicked}
                    onChange={() =>
                      setTicked((cur) => {
                        const next = new Map(cur);
                        for (const r of rows)
                          if (allTicked) next.delete(r.id);
                          else next.set(r.id, stockOf(r));
                        return next;
                      })
                    }
                  />
                </th>
                <th className="p-2 text-start font-medium">{t('inventory.sku')}</th>
                <th className="p-2 text-start font-medium">{t('inventory.itemName')}</th>
                <th className="p-2 text-start font-medium">{t('inventory.category')}</th>
                <th className="p-2 text-end font-medium">{t('inventory.stock')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-surface-2"
                  onClick={() =>
                    setTicked((cur) => {
                      const next = new Map(cur);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.set(r.id, stockOf(r));
                      return next;
                    })
                  }
                >
                  <td className="p-2 text-center">
                    <input type="checkbox" readOnly checked={ticked.has(r.id)} />
                  </td>
                  <td className="p-2 text-muted tnum" dir="ltr">
                    {r.sku}
                  </td>
                  <td className="p-2 font-medium">{r.name}</td>
                  <td className="p-2 text-muted">{r.categoryName}</td>
                  <td className="p-2 text-end tnum">
                    {formatNumber(r.stockOnHand, locale)} {r.unit}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-muted">
                    {t('common.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Pager page={page} size={pageSize} pages={pages} onPage={setPage} onSize={setPageSize} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon="inventory"
            loading={loadingAll}
            disabled={loadingAll || (list.data?.matched ?? 0) === 0}
            onClick={addAll}
          >
            {t('labels.addAll')} ({formatNumber(list.data?.matched ?? 0, locale)})
          </Button>
          <Button
            icon="plus"
            disabled={ticked.size === 0}
            onClick={() => {
              onAdd([...ticked].map(([id, stock]) => ({ id, stock })));
              setTicked(new Map());
            }}
          >
            {t('labels.addTicked')} ({ticked.size})
          </Button>
        </div>
      </div>
      {loadingAll && (
        <p className="flex items-center gap-1 text-xs text-muted">
          <Icon name="inventory" size={12} />
          {t('labels.loadingAll')}
        </p>
      )}
    </div>
  );
}
