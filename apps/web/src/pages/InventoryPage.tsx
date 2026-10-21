import { useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import { useWorkPlace } from '../lib/workPlace';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatQuantity,
  type InventoryItem,
  type Party,
  type Valuation,
  type ValuationItem,
  type ValuationRow,
  companyToday,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { WarehouseSelect } from '../components/WarehouseSelect';
import { PartyPicker } from '../components/PartyPicker';
import { ItemFinderSheet } from '../components/ItemFinderSheet';
import { ItemLink } from '../components/ItemLink';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useAuth } from '../stores/auth';
import { useDeviceInfo } from '../lib/device';
import {
  useDepartments,
  useDocumentList,
  useGroups,
  useInventory,
  usePageSize,
  useValuation,
} from '../lib/queries';
import { Sheet } from '../components/Sheet';
import { api } from '../lib/api';
import { Pager } from '../components/Pager';
import { GroupPicker } from '../components/GroupTree';
import { TableColumns } from '../components/TableColumns';
import { ReportActions } from '../components/ReportActions';
import { useReportTools } from '../lib/report';

const field =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

const today = companyToday;

type Tab = 'items' | 'valuation';

/**
 * Inventory (المخزون): every item with stock, average cost, value and reorder status,
 * plus stock valuation at any date — for all warehouses or one. `?low=1` opens the reorder
 * list; `?tab=valuation` the valuation; `?wh=<id>` limits both to one warehouse.
 */
export function InventoryPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const canEdit = can('inventory:stocktake');
  // Average cost, stock value and the valuation are the owner's unless given (costs:view).
  const seeCosts = can('costs:view');
  // The valuation has its own permission, and each part and column another (owner, 2026-10-19).
  const canValuation = can('inventory:valuation');
  const tab: Tab = canValuation && params.get('tab') === 'valuation' ? 'valuation' : 'items';
  const lowOnly = params.get('low') === '1';
  const warehouseId = params.get('wh') ?? '';
  // Branch, warehouse and department in every search (owner, 2026-10-01).
  const branchId = params.get('br') ?? '';
  const departmentId = params.get('dept') ?? '';
  const groupId = params.get('grp') ?? '';
  const groups = (useGroups().data ?? []).filter(
    (g) => g.isActive && g.departmentId === departmentId,
  );
  const myBranches = useAuth((s) => s.user?.branches ?? []);
  const departments = (useDepartments().data ?? []).filter((d) => d.isActive);
  // The filters start at everything (owner, 2026-10-18: it opened on one department and store);
  // a place chosen here is still remembered for the other screens.
  const [, setPlace] = useWorkPlace();

  const [search, setSearch] = useState('');
  // The item's code, its name and the supplier each in a box of their own (owner, 2026-10-17).
  const [code, setCode] = useState('');
  const [supplier, setSupplier] = useState<Party | null>(null);
  // One page at a time, sorted by the column clicked (owner, 2026-10-18).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('inventory', 50);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const list = useInventory({
    page,
    pageSize,
    sort: sort?.key,
    dir: sort?.dir,
    search: search.trim() || undefined,
    code: code.trim() || undefined,
    supplierId: supplier?.id,
    lowOnly,
    warehouseId: warehouseId || undefined,
    branchId: (!warehouseId && branchId) || undefined,
    departmentId: departmentId || undefined,
    groupId: groupId || undefined,
  });
  // The cards at the top are the whole stock of the branch or warehouse, not the items the list's
  // filters happen to show (owner, 2026-10-19: they showed 2 items of 3).
  const summary = useInventory({
    page: 1,
    pageSize: 1,
    warehouseId: warehouseId || undefined,
    branchId: (!warehouseId && branchId) || undefined,
  });
  const currency = list.data?.currency ?? 'EGP';
  const filterKey = [
    search,
    code,
    supplier?.id,
    lowOnly,
    warehouseId,
    branchId,
    departmentId,
    groupId,
  ].join('|');
  useEffect(() => setPage(1), [filterKey]);
  const pages = Math.max(1, Math.ceil((list.data?.matched ?? 0) / pageSize));

  /** Change some URL params, keeping the rest (tab, low-stock filter, warehouse). */
  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  }
  const setTab = (next: Tab) =>
    update({ tab: next === 'valuation' ? 'valuation' : null, low: null });
  const setLowOnly = (on: boolean) => update({ low: on ? '1' : null });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('inventory.title')}
        action={
          <div className="flex flex-wrap gap-2">
            {can('products:create') && (
              <Button size="sm" icon="plus" onClick={() => navigate('/inventory/products/new')}>
                {can('purchases:create') && can('prices:edit')
                  ? t('additems.title')
                  : t('catalog.newItem')}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {seeCosts && (
          <Kpi
            label={t('inventory.stockValue')}
            value={formatMoney(summary.data?.totalValue ?? 0, currency, locale)}
          />
        )}
        <Kpi
          label={t('inventory.itemCount')}
          value={formatNumber(summary.data?.totalItems ?? 0, locale)}
        />
        <button
          onClick={() => setLowOnly(!lowOnly)}
          className="col-span-2 text-start lg:col-span-1"
        >
          <Kpi
            label={t('inventory.lowStock')}
            value={formatNumber(summary.data?.lowStockCount ?? 0, locale)}
            tone={(summary.data?.lowStockCount ?? 0) > 0 ? 'warning' : undefined}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div
          role="tablist"
          className="flex max-w-full overflow-x-auto rounded-[var(--radius-app)] border border-line bg-surface p-1"
        >
          {(canValuation ? (['items', 'valuation'] as const) : (['items'] as const)).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`h-8 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors ${
                tab === k ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
              }`}
            >
              {t(k === 'items' ? 'inventory.items' : 'inventory.valuation')}
            </button>
          ))}
          {/* The store's other screens, beside its tabs (owner, 2026-10-19). */}
          {[
            canEdit && { path: '/inventory/stocktake', label: t('stocktake.action') },
            { path: '/inventory/transfers', label: t('transfer.title') },
            can('labels:print') && { path: '/inventory/labels', label: t('labels.title') },
            { path: '/inventory/price-lists', label: t('pl.short') },
            { path: '/inventory/setup', label: t('catalog.setup') },
          ]
            .filter((x): x is { path: string; label: string } => !!x)
            .map((x) => (
              <button
                key={x.path}
                type="button"
                onClick={() => navigate(x.path)}
                className="h-8 shrink-0 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {x.label}
              </button>
            ))}
        </div>
        {myBranches.length > 0 && (
          <select
            className="h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm sm:w-48"
            aria-label={t('list.branch')}
            value={branchId}
            onChange={(e) => {
              update({ br: e.target.value || null, wh: null });
              if (e.target.value) setPlace({ branchId: e.target.value, warehouseId: '' });
            }}
          >
            <option value="">
              {t('list.branch')}: {t('common.all')}
            </option>
            {myBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <WarehouseSelect
          className="w-full sm:w-64"
          value={warehouseId}
          onChange={(id) => {
            update({ wh: id || null });
            if (id) setPlace({ warehouseId: id });
          }}
          allowAll
          includeClosed
        />
        {tab === 'items' && departments.length > 0 && (
          <select
            className="h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm sm:w-48"
            aria-label={t('invoice.department')}
            value={departmentId}
            onChange={(e) => {
              update({ dept: e.target.value || null, grp: null });
              if (e.target.value) setPlace({ departmentId: e.target.value });
            }}
          >
            <option value="">
              {t('invoice.department')}: {t('common.all')}
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        {tab === 'items' && departmentId && groups.length > 0 && (
          <GroupPicker
            departments={departments}
            groups={groups}
            departmentId={departmentId}
            groupId={groupId}
            showDepartment={false}
            anyLabel={t('common.all')}
            onChange={(_, g) => update({ grp: g || null })}
          />
        )}
      </div>

      {tab === 'items' ? (
        <ItemsTab
          items={list.data?.items ?? []}
          loading={list.isLoading}
          currency={currency}
          seeCosts={seeCosts}
          search={search}
          onSearch={setSearch}
          code={code}
          onCode={setCode}
          supplier={supplier}
          onSupplier={setSupplier}
          sort={sort}
          onSort={(key, dir) => {
            setSort({ key, dir });
            setPage(1);
          }}
          lowOnly={lowOnly}
          onLowOnly={setLowOnly}
          onOpen={(id) =>
            navigate(`/inventory/items/${id}${warehouseId ? `?wh=${warehouseId}` : ''}`)
          }
        />
      ) : (
        <ValuationTab warehouseId={warehouseId} />
      )}
      {tab === 'items' && (
        <div className="flex justify-end">
          <Pager page={page} size={pageSize} pages={pages} onPage={setPage} onSize={setPageSize} />
        </div>
      )}
    </div>
  );
}

function ItemsTab({
  items,
  loading,
  currency,
  seeCosts,
  search,
  onSearch,
  code,
  onCode,
  supplier,
  onSupplier,
  sort,
  onSort,
  lowOnly,
  onLowOnly,
  onOpen,
}: {
  items: InventoryItem[];
  loading: boolean;
  currency: string;
  seeCosts: boolean;
  search: string;
  onSearch: (v: string) => void;
  code: string;
  onCode: (v: string) => void;
  supplier: Party | null;
  onSupplier: (p: Party | null) => void;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  onSort: (key: string, dir: 'asc' | 'desc') => void;
  lowOnly: boolean;
  onLowOnly: (v: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const { t, locale } = useT();
  const { deviceClass } = useDeviceInfo();
  const isPhone = deviceClass === 'phone';
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const can = useCan();
  const navigate = useNavigate();
  // A right click on an item (owner, 2026-10-18): its card, or bringing in more of it.
  const [menu, setMenu] = useState<{ x: number; y: number; item: InventoryItem } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);
  // Each column with the permission it needs (owner, 2026-10-18): where it is, the supplier, the
  // sale price for everyone here, the supply price and the value for costs:view.
  const columns: {
    key: string;
    label: string;
    end?: boolean;
    className?: string;
    cell: (p: InventoryItem) => ReactNode;
  }[] = [
    { key: 'code', label: t('inventory.sku'), className: 'text-muted tnum', cell: (p) => p.sku },
    { key: 'name', label: t('inventory.products'), className: 'font-medium', cell: (p) => p.name },
    {
      key: 'department',
      label: t('inventory.category'),
      className: 'text-muted',
      cell: (p) => p.categoryName,
    },
    {
      key: 'places',
      label: t('inventory.places'),
      className: 'text-xs text-muted',
      cell: (p) =>
        (p.places ?? []).map((x) => (
          <span key={x} className="block whitespace-nowrap">
            {x}
          </span>
        )),
    },
    ...(can('parties:view') || can('purchases:view')
      ? [
          {
            key: 'supplier',
            label: t('inventory.supplier'),
            className: 'text-muted',
            cell: (p: InventoryItem) => p.supplierName ?? '',
          },
        ]
      : []),
    {
      key: 'stock',
      label: t('inventory.stock'),
      end: true,
      cell: (p) => (
        <>
          <span className="font-semibold">{formatNumber(p.stockOnHand, locale)}</span>{' '}
          <span className="text-xs text-muted">{p.unit}</span>
          {p.units.length > 1 && p.stockOnHand > 0 && (
            <span className="block text-xs text-muted">
              {formatQuantity(p.stockOnHand, p.units, locale)}
            </span>
          )}
        </>
      ),
    },
    {
      key: 'reorder',
      label: t('inventory.reorder'),
      end: true,
      className: 'text-muted',
      cell: (p) => formatNumber(p.reorderLevel, locale),
    },
    {
      key: 'sale',
      label: t('item.salePrice'),
      end: true,
      cell: (p) => formatMoney(p.salePrice, currency, locale),
    },
    ...(seeCosts
      ? [
          {
            key: 'cost',
            label: t('finder.costPrice'),
            end: true,
            cell: (p: InventoryItem) => formatMoney(p.avgCost, currency, locale),
          },
          {
            key: 'value',
            label: t('inventory.value'),
            end: true,
            cell: (p: InventoryItem) => formatMoney(p.stockValue, currency, locale),
          },
        ]
      : []),
    { key: 'status', label: t('common.status'), cell: (p) => <StockBadge item={p} /> },
  ];

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-3">
        <label className="block w-full sm:w-36">
          <span className="mb-0.5 block text-xs text-muted">{t('inventory.sku')}</span>
          <input
            className={`${field} w-full tnum`}
            dir="ltr"
            value={code}
            onChange={(e) => onCode(e.target.value)}
          />
        </label>
        <label className="relative block min-w-0 flex-1 basis-48">
          <span className="mb-0.5 block text-xs text-muted">{t('inventory.itemName')}</span>
          <span className="pointer-events-none absolute bottom-0 start-2.5 grid h-9 place-items-center text-faint">
            <Icon name="search" size={16} />
          </span>
          <input
            className={`${field} w-full ps-8`}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
        <div className="min-w-0 flex-1 basis-64">
          <PartyPicker
            type="SUPPLIER"
            withCode
            value={supplier}
            onChange={onSupplier}
            label={t('inventory.supplier')}
            placeholder={t('common.all')}
          />
        </div>
        {supplier && (
          <Button size="sm" variant="ghost" icon="close" onClick={() => onSupplier(null)}>
            {t('common.clear')}
          </Button>
        )}
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={lowOnly} onChange={(e) => onLowOnly(e.target.checked)} />
          {t('inventory.lowOnly')}
        </label>
        <ReportActions
          disabled={loading || items.length === 0}
          onPrint={() => report.print(paper.current, t('nav.inventory'))}
        />
      </div>

      <div ref={paper}>
        {loading ? (
          <div className="grid place-items-center py-16 text-muted">
            <Spinner size={26} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState title={t('common.empty')} icon="inventory" />
        ) : isPhone ? (
          <ul className="divide-y divide-[var(--c-line)]">
            {items.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onOpen(p.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, item: p });
                  }}
                  className="flex w-full items-center gap-3 p-4 text-start hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    {(p.places?.length ?? 0) > 0 && (
                      <span className="block truncate text-xs text-muted">
                        {p.places!.join(' · ')}
                      </span>
                    )}
                    <span className="text-xs text-muted tnum">
                      {p.sku}
                      {seeCosts &&
                        ` · ${t('inventory.avgCost')} ${formatMoney(p.avgCost, currency, locale)}`}
                    </span>
                  </span>
                  <span className="text-end">
                    <span className="block text-sm font-semibold tnum">
                      {formatQuantity(p.stockOnHand, p.units, locale)}
                    </span>
                    <StockBadge item={p} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <TableColumns
            id="inventory.items"
            sorted={(() => {
              const col = columns.find((c) => c.key === sort?.key);
              return col && sort ? { label: col.label, dir: sort.dir === 'desc' ? -1 : 1 } : null;
            })()}
            onSort={(label, dir) => {
              const col = columns.find((c) => c.label === label);
              if (col) onSort(col.key, dir === -1 ? 'desc' : 'asc');
            }}
            className="overflow-x-auto"
          >
            <table className="w-full whitespace-nowrap text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={`cursor-pointer select-none p-3 font-medium ${c.end ? 'text-end' : 'text-start'}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {items.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => onOpen(p.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, item: p });
                    }}
                    className="cursor-pointer transition-colors hover:bg-surface-2"
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`p-3 align-top ${c.end ? 'text-end tnum' : ''} ${c.className ?? ''}`}
                      >
                        {c.cell(p)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableColumns>
        )}
      </div>
      {menu && (
        <div
          role="menu"
          className="fixed z-50 min-w-44 overflow-hidden rounded-[var(--radius-app)] border border-line bg-surface py-1 text-sm shadow-[var(--shadow-card)]"
          style={{
            top: Math.min(menu.y, window.innerHeight - 130),
            left: Math.min(menu.x, window.innerWidth - 200),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="truncate border-b border-line px-3 py-1.5 text-xs text-muted">
            {menu.item.name}
          </p>
          <MenuItem
            icon="ledger"
            label={t('itemCard.title')}
            onClick={() => {
              setMenu(null);
              onOpen(menu.item.id);
            }}
          />
          {can('purchases:create') && (
            <MenuItem
              icon="plus"
              label={t('inventory.addStock')}
              onClick={() => {
                setMenu(null);
                navigate(`/inventory/products/new?item=${menu.item.id}`);
              }}
            />
          )}
          {can('products:edit') && (
            <MenuItem
              icon="edit"
              label={t('catalog.editItem')}
              onClick={() => {
                setMenu(null);
                navigate(`/inventory/products/${menu.item.id}/edit`);
              }}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function MenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-surface-2"
    >
      <Icon name={icon} size={16} className="text-muted" />
      {label}
    </button>
  );
}

function ValuationTab({ warehouseId }: { warehouseId: string }) {
  const { t, locale } = useT();
  const can = useCan();
  const seeSuppliers = can('inventory:valuation_suppliers');
  const [asOf, setAsOf] = useState(today());
  // What to look at (owner, 2026-10-19): a department, a supplier (by name or code), an item's
  // name or code, items picked in the detailed search, and only those run out (no reorder-level box:
  // owner, same day).
  const [departmentId, setDepartmentId] = useState('');
  const [supplier, setSupplier] = useState<Party | null>(null);
  const [search, setSearch] = useState('');
  const settled = useDeferredValue(search.trim());
  const [picked, setPicked] = useState<string[]>([]);
  const [empty, setEmpty] = useState(false);
  const [finding, setFinding] = useState(false);
  const departments = (useDepartments().data ?? []).filter((d) => d.isActive);
  const valuation = useValuation(asOf, warehouseId || undefined, {
    departmentId: departmentId || undefined,
    supplierId: supplier?.id,
    search: settled || undefined,
    productIds: picked,
    empty,
  });
  const data = valuation.data;
  const currency = data?.currency ?? 'EGP';
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const money = (v: number | null) => (v == null ? '' : formatMoney(v, currency, locale));
  const seeValue = data?.value != null;

  return (
    <div ref={paper} className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('inventory.asOf')}</span>
            <input
              type="date"
              className={field}
              value={asOf}
              max={today()}
              onChange={(e) => setAsOf(e.target.value || today())}
            />
          </label>
          <ReportActions
            disabled={!data}
            onPrint={() =>
              report.print(paper.current, t('inventory.valuation'), formatDate(asOf, locale))
            }
          />
          <div className="text-end">
            {seeValue && (
              <>
                <p className="text-xs text-muted">{t('inventory.stockValue')}</p>
                <p className="text-lg font-semibold tnum">{money(data?.value ?? 0)}</p>
              </>
            )}
            <p className="text-xs text-muted tnum">
              {formatNumber(data?.quantity ?? 0, locale)} {t('inventory.qty')}
            </p>
            <p className="text-sm font-medium tnum">
              {t('valuation.counter')
                .replace('{n}', formatNumber(data?.itemCount ?? 0, locale))
                .replace('{total}', formatNumber(data?.totalItems ?? 0, locale))}
            </p>
          </div>
        </div>
        <div data-noprint className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('valuation.department')}</span>
            <select
              className={`${field} w-full`}
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
          {seeSuppliers && (
            <PartyPicker
              type="SUPPLIER"
              withCode
              value={supplier}
              onChange={setSupplier}
              label={t('valuation.supplier')}
              placeholder={t('common.all')}
            />
          )}
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('valuation.search')}</span>
            <input
              className={`${field} w-full`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <Button variant="secondary" icon="search" onClick={() => setFinding(true)}>
              {t('finder.button')}
            </Button>
          </div>
        </div>
        <div data-noprint className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} />
            {t('valuation.empty')}
          </label>
          {picked.length > 0 && (
            <span className="inline-flex items-center gap-2">
              <Badge tone="brand">
                {t('valuation.picked').replace('{n}', formatNumber(picked.length, locale))}
              </Badge>
              <button
                type="button"
                className="text-xs font-medium text-brand hover:underline"
                onClick={() => setPicked([])}
              >
                {t('valuation.clearPicked')}
              </button>
            </span>
          )}
        </div>
      </Card>
      {finding && (
        <ItemFinderSheet
          warehouseId={warehouseId || undefined}
          departmentId={departmentId || undefined}
          onClose={() => setFinding(false)}
          onAdd={(items, close) => {
            setPicked((prev) => [...new Set([...prev, ...items.map((i) => i.product.id)])]);
            if (close) setFinding(false);
          }}
        />
      )}

      <PurchasesOfDay
        day={asOf}
        departmentId={departmentId}
        supplierCode={supplier ? String(supplier.code) : ''}
      />

      {valuation.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : !data || data.itemCount === 0 ? (
        <Card>
          <EmptyState title={t('common.empty')} icon="inventory" />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
            {data.categories.length > 0 && (
              <ValuationTable
                id="inventory.valuation.departments"
                nameLabel={t('valuation.department')}
                title={t('inventory.byCategory')}
                rows={data.categories}
                money={money}
                seeValue={seeValue}
              />
            )}
            {!warehouseId && data.warehouses.length > 1 && (
              <ValuationTable
                id="inventory.valuation.warehouses"
                nameLabel={t('warehouse.label')}
                title={t('warehouse.byWarehouse')}
                rows={data.warehouses}
                money={money}
                seeValue={seeValue}
              />
            )}
            {data.models.length > 0 && (
              <ValuationTable
                id="inventory.valuation.models"
                nameLabel={t('valuation.model')}
                title={t('inventory.byModel')}
                rows={data.models}
                money={money}
                seeValue={seeValue}
              />
            )}
          </div>
          {can('inventory:valuation_items') && (
            <ValuationItems data={data} money={money} seeSuppliers={seeSuppliers} />
          )}
        </div>
      )}
    </div>
  );
}

function ValuationTable({
  id,
  title,
  nameLabel,
  rows,
  money,
  seeValue,
}: {
  /** Each table keeps its own columns (owner, 2026-10-21: they were shared and came out wrong). */
  id: string;
  title: string;
  /** The first column's title: department, warehouse or model. */
  nameLabel: string;
  rows: ValuationRow[];
  money: (v: number | null) => string;
  seeValue: boolean;
}) {
  const { t, locale } = useT();
  return (
    <Card padded={false} className="h-fit overflow-hidden">
      <h2 className="border-b border-line p-3 text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      <TableColumns id={id}>
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="p-3 text-start font-medium">{nameLabel}</th>
              <th className="p-3 text-end font-medium">{t('valuation.count')}</th>
              <th className="p-3 text-end font-medium">{t('inventory.qty')}</th>
              {seeValue && <th className="p-3 text-end font-medium">{t('inventory.value')}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--c-line)]">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="p-3">{r.label}</td>
                <td className="p-3 text-end tnum">{formatNumber(r.count, locale)}</td>
                <td className="p-3 text-end tnum">{formatNumber(r.quantity, locale)}</td>
                {seeValue && <td className="p-3 text-end font-medium tnum">{money(r.value)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </TableColumns>
    </Card>
  );
}

/** The valuation item by item; each column shows only for whoever may see it. */
function ValuationItems({
  data,
  money,
  seeSuppliers,
}: {
  data: Valuation;
  money: (v: number | null) => string;
  seeSuppliers: boolean;
}) {
  const { t, locale } = useT();
  const isPhone = useDeviceInfo().deviceClass === 'phone';
  const seeValue = data.value != null;
  const seePrice = data.items.some((i) => i.salePrice != null);
  const qtyTone = (r: ValuationItem) =>
    r.empty ? 'text-destructive' : r.low ? 'text-warning' : '';
  const supplier = (r: ValuationItem) =>
    r.supplier ? `${r.supplierCode ?? ''} ${r.supplier}`.trim() : '';
  const heading = (
    <h2 className="border-b border-line p-3 text-sm font-semibold uppercase tracking-wide text-muted">
      {t('inventory.byItem')}
    </h2>
  );
  // A phone (owner, 2026-10-21: the table was squeezed): one card per item, nothing cut off.
  if (isPhone)
    return (
      <Card padded={false} className="overflow-hidden">
        {heading}
        <ul className="divide-y divide-[var(--c-line)]">
          {data.items.map((r) => (
            <li key={r.key} className="space-y-1 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <ItemLink id={r.key} name={r.label} className="font-medium" />
                  <p className="text-xs text-muted tnum" dir="ltr">
                    {r.code}
                  </p>
                  {seeSuppliers && supplier(r) && (
                    <p className="text-xs text-muted">{supplier(r)}</p>
                  )}
                </div>
                <div className="shrink-0 text-end">
                  <p className={`font-semibold tnum ${qtyTone(r)}`}>
                    {formatNumber(r.quantity, locale)}
                  </p>
                  {r.reorderLevel > 0 && (
                    <p className="text-xs text-muted tnum">
                      {t('valuation.reorder')} {formatNumber(r.reorderLevel, locale)}
                    </p>
                  )}
                </div>
              </div>
              {(seePrice || seeValue) && (
                <dl className="grid grid-cols-3 gap-2 rounded-[var(--radius-app)] bg-surface-2 px-2 py-1.5 text-xs">
                  {seePrice && (
                    <div>
                      <dt className="text-muted">{t('item.salePrice')}</dt>
                      <dd className="tnum">{money(r.salePrice)}</dd>
                    </div>
                  )}
                  {seeValue && (
                    <div>
                      <dt className="text-muted">{t('finder.costPrice')}</dt>
                      <dd className="tnum">{money(r.supplyPrice)}</dd>
                    </div>
                  )}
                  {seeValue && (
                    <div>
                      <dt className="text-muted">{t('inventory.value')}</dt>
                      <dd className="font-medium tnum">{money(r.value)}</dd>
                    </div>
                  )}
                </dl>
              )}
            </li>
          ))}
        </ul>
      </Card>
    );
  return (
    <Card padded={false} className="overflow-hidden">
      {heading}
      <TableColumns id="inventory.valuation.items">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="p-2 text-start font-medium">{t('inventory.sku')}</th>
                <th className="p-2 text-start font-medium">{t('inventory.itemName')}</th>
                {seeSuppliers && (
                  <th className="p-2 text-start font-medium">{t('inventory.supplier')}</th>
                )}
                <th className="p-2 text-end font-medium">{t('inventory.qty')}</th>
                <th className="p-2 text-end font-medium">{t('valuation.reorder')}</th>
                {seePrice && <th className="p-2 text-end font-medium">{t('item.salePrice')}</th>}
                {seeValue && <th className="p-2 text-end font-medium">{t('finder.costPrice')}</th>}
                {seeValue && <th className="p-2 text-end font-medium">{t('inventory.value')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {data.items.map((r) => (
                <tr key={r.key}>
                  <td className="whitespace-nowrap p-2 text-muted tnum" dir="ltr">
                    {r.code}
                  </td>
                  <td className="p-2">
                    <ItemLink id={r.key} name={r.label} />
                  </td>
                  {seeSuppliers && <td className="p-2 text-muted">{supplier(r)}</td>}
                  <td className={`whitespace-nowrap p-2 text-end tnum ${qtyTone(r)}`}>
                    {formatNumber(r.quantity, locale)}
                  </td>
                  <td className="whitespace-nowrap p-2 text-end text-muted tnum">
                    {r.reorderLevel > 0 ? formatNumber(r.reorderLevel, locale) : ''}
                  </td>
                  {seePrice && (
                    <td className="whitespace-nowrap p-2 text-end tnum">{money(r.salePrice)}</td>
                  )}
                  {seeValue && (
                    <td className="whitespace-nowrap p-2 text-end tnum">{money(r.supplyPrice)}</td>
                  )}
                  {seeValue && (
                    <td className="whitespace-nowrap p-2 text-end font-medium tnum">
                      {money(r.value)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableColumns>
    </Card>
  );
}

function StockBadge({ item }: { item: InventoryItem }) {
  const { t } = useT();
  return item.isLow ? (
    <Badge tone="warning">{t('inventory.lowStock')}</Badge>
  ) : (
    <Badge tone="positive">{t('inventory.ok')}</Badge>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <Card>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold tnum ${tone === 'warning' ? 'text-warning' : ''}`}>
        {value}
      </p>
    </Card>
  );
}

interface PriceSheet {
  number: string;
  date: string;
  supplierName: string | null;
  lines: { code: string; name: string; pieces: number; salePrice: number }[];
}

/**
 * The purchase invoices of the valuation's day (owner, 2026-10-19), each with its price sheet: the
 * items that came, how many, and what each sells for, to print for the salespeople. Sale prices
 * only: nothing of what was paid.
 */
function PurchasesOfDay({
  day,
  departmentId,
  supplierCode,
}: {
  day: string;
  /** The valuation's department and supplier filter the invoices too (owner, 2026-10-19). */
  departmentId?: string;
  supplierCode?: string;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const list = useDocumentList('purchases', 'invoices', {
    page: 1,
    pageSize: 50,
    from: day,
    to: day,
    departmentId: departmentId || undefined,
    partyCode: supplierCode || undefined,
    enabled: can('purchases:view'),
  });
  const [sheet, setSheet] = useState<PriceSheet | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const rows = list.data?.items ?? [];
  if (!can('purchases:view') || rows.length === 0) return null;
  const currency = list.data?.items[0]?.currency ?? 'EGP';
  return (
    <Card padded={false}>
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
        {t('inventory.purchasesOfDay')}
      </h2>
      <ul className="divide-y divide-[var(--c-line)]">
        {rows.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
          >
            <span className="tnum" dir="ltr">
              {d.number}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{d.partyName}</span>
            <Button
              size="sm"
              variant="secondary"
              icon="print"
              loading={opening === d.id}
              onClick={async () => {
                setOpening(d.id);
                try {
                  setSheet(await api.get<PriceSheet>(`/purchases/invoices/${d.id}/price-sheet`));
                } finally {
                  setOpening(null);
                }
              }}
            >
              {t('inventory.priceSheet')}
            </Button>
          </li>
        ))}
      </ul>
      {sheet && (
        <Sheet
          title={`${t('inventory.priceSheet')} · ${sheet.number}`}
          onClose={() => setSheet(null)}
          closeLabel={t('common.close')}
          wide
        >
          <div className="mb-3 flex justify-end">
            <Button
              icon="print"
              onClick={() =>
                report.print(
                  paper.current,
                  `${t('inventory.priceSheet')} ${sheet.number}`,
                  [sheet.supplierName, formatDate(sheet.date, locale)].filter(Boolean).join(' · '),
                )
              }
            >
              {t('common.print')}
            </Button>
          </div>
          <div ref={paper}>
            <table className="w-full text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="p-2 text-start font-medium">{t('inventory.sku')}</th>
                  <th className="p-2 text-start font-medium">{t('inventory.itemName')}</th>
                  <th className="p-2 text-end font-medium">{t('additems.pieces')}</th>
                  <th className="p-2 text-end font-medium">{t('item.salePrice')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {sheet.lines.map((l) => (
                  <tr key={l.code + l.name}>
                    <td className="p-2 text-muted tnum" dir="ltr">
                      {l.code}
                    </td>
                    <td className="p-2 font-medium">{l.name}</td>
                    <td className="p-2 text-end tnum">{formatNumber(l.pieces, locale)}</td>
                    <td className="p-2 text-end font-semibold tnum">
                      {formatMoney(l.salePrice, currency, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sheet>
      )}
    </Card>
  );
}
