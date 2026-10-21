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
  type TranslationKey,
  type Valuation,
  type ValuationItem,
  companyToday,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { WarehouseSelect } from '../components/WarehouseSelect';
import { PartyPicker } from '../components/PartyPicker';
import { ItemFinderSheet } from '../components/ItemFinderSheet';
import { ItemLink } from '../components/ItemLink';
import { MultiSelect } from '../components/MultiSelect';
import { StocktakePage } from './StocktakePage';
import { TransfersPage } from './TransfersPage';
import { LabelsPage } from './LabelsPage';
import { PriceListsPage } from './PriceListsPage';
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

type Tab = 'items' | 'valuation' | 'stocktake' | 'transfers' | 'labels' | 'pricelists';

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
  // The store's other screens open here, as tabs (owner, 2026-10-21: not on pages of their own).
  const tabs: { key: Tab; label: string }[] = [
    { key: 'items', label: t('inventory.items') },
    ...(canValuation ? [{ key: 'valuation' as Tab, label: t('inventory.valuation') }] : []),
    ...(canEdit ? [{ key: 'stocktake' as Tab, label: t('stocktake.action') }] : []),
    { key: 'transfers', label: t('transfer.title') },
    ...(can('labels:print') ? [{ key: 'labels' as Tab, label: t('labels.title') }] : []),
    { key: 'pricelists', label: t('pl.short') },
  ];
  const asked = params.get('tab');
  const tab: Tab = tabs.find((x) => x.key === asked)?.key ?? 'items';
  const ownFilters = tab === 'items' || tab === 'valuation';
  // Any of the stock statuses (owner, 2026-10-21: instead of the reorder tick); `?low=1` still opens
  // those at the reorder level.
  const statuses = (params.get('st') ?? (params.get('low') === '1' ? 'low' : ''))
    .split(',')
    .filter(Boolean);
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
    status: statuses,
    warehouseId: warehouseId || undefined,
    branchId: (!warehouseId && branchId) || undefined,
    departmentId: departmentId || undefined,
    groupId: groupId || undefined,
  });

  const currency = list.data?.currency ?? 'EGP';
  const filterKey = [
    search,
    code,
    supplier?.id,
    statuses.join(),
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
  const setTab = (next: Tab) => {
    // A tab's own choices (a transfer list's view, a price list's part) don't follow it out.
    const q = new URLSearchParams(params);
    for (const k of ['tab', 'low', 'tt', 'pl', 'doc', 'ids']) q.delete(k);
    if (next !== 'items') q.set('tab', next);
    setParams(q, { replace: true });
  };
  const setStatuses = (next: string[]) => update({ st: next.join(',') || null, low: null });
  const totals = list.data?.totals;

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

      {/* The totals of what the filters show, each for whoever may see it (owner, 2026-10-21). */}
      {tab === 'items' && totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {totals.items != null && (
            <Kpi label={t('inventory.totalItems')} value={formatNumber(totals.items, locale)} />
          )}
          {totals.quantity != null && (
            <Kpi
              label={t('inventory.totalQuantity')}
              value={formatNumber(totals.quantity, locale)}
            />
          )}
          {totals.saleValue != null && (
            <Kpi
              label={t('inventory.totalSaleValue')}
              value={formatMoney(totals.saleValue, currency, locale)}
            />
          )}
          {totals.supplyValue != null && (
            <Kpi
              label={t('inventory.totalSupplyValue')}
              value={formatMoney(totals.supplyValue, currency, locale)}
            />
          )}
          {totals.sold != null && (
            <Kpi label={t('inventory.totalSold')} value={formatNumber(totals.sold, locale)} />
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div
          role="tablist"
          className="flex max-w-full overflow-x-auto rounded-[var(--radius-app)] border border-line bg-surface p-1"
        >
          {tabs.map((x) => (
            <button
              key={x.key}
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => setTab(x.key)}
              className={`h-8 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors ${
                tab === x.key ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
              }`}
            >
              {x.label}
            </button>
          ))}
          {/* Setting up the catalogue stays a screen of its own. */}
          {[{ path: '/inventory/setup', label: t('catalog.setup') }].map((x) => (
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
        {ownFilters && myBranches.length > 0 && (
          <label className="block w-full shrink-0 sm:w-48">
            <span className="mb-0.5 block text-xs text-muted">{t('list.branch')}</span>
            <select
              className="h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm sm:w-48"
              aria-label={t('list.branch')}
              value={branchId}
              onChange={(e) => {
                update({ br: e.target.value || null, wh: null });
                if (e.target.value) setPlace({ branchId: e.target.value, warehouseId: '' });
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
        )}
        {ownFilters && (
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
        )}
        {tab === 'items' && departments.length > 0 && (
          <label className="block w-full shrink-0 sm:w-48">
            <span className="mb-0.5 block text-xs text-muted">{t('invoice.department')}</span>
            <select
              className="h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm sm:w-48"
              aria-label={t('invoice.department')}
              value={departmentId}
              onChange={(e) => {
                update({ dept: e.target.value || null, grp: null });
                if (e.target.value) setPlace({ departmentId: e.target.value });
              }}
            >
              <option value="">{t('common.all')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
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
          statuses={statuses}
          onStatuses={setStatuses}
          onOpen={(id) =>
            navigate(`/inventory/items/${id}${warehouseId ? `?wh=${warehouseId}` : ''}`)
          }
        />
      ) : tab === 'valuation' ? (
        <ValuationTab warehouseId={warehouseId} branchId={branchId} />
      ) : tab === 'stocktake' ? (
        <StocktakePage embedded />
      ) : tab === 'transfers' ? (
        <TransfersPage embedded />
      ) : tab === 'labels' ? (
        <LabelsPage embedded />
      ) : (
        <PriceListsPage embedded />
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
  statuses,
  onStatuses,
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
  statuses: string[];
  onStatuses: (v: string[]) => void;
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
        <MultiSelect
          className="w-full sm:w-56"
          label={t('valuation.status')}
          value={statuses}
          onChange={onStatuses}
          options={[
            { value: 'in', label: t('valuation.status.in') },
            { value: 'out', label: t('valuation.status.out') },
            { value: 'low', label: t('valuation.status.low') },
          ]}
        />
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

function ValuationTab({ warehouseId, branchId }: { warehouseId: string; branchId: string }) {
  const { t, locale } = useT();
  const can = useCan();
  const seeSuppliers = can('inventory:valuation_suppliers');
  const [asOf, setAsOf] = useState(today());
  // What to look at (owner, 2026-10-19/21): the branch and warehouse above, a department, a
  // supplier, an item's name or code, items picked in the detailed search, and a stock status.
  // Everything starts at "all".
  const [departmentId, setDepartmentId] = useState('');
  const [supplier, setSupplier] = useState<Party | null>(null);
  const [search, setSearch] = useState('');
  const settled = useDeferredValue(search.trim());
  const [picked, setPicked] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);
  const departments = (useDepartments().data ?? []).filter((d) => d.isActive);
  const valuation = useValuation(asOf, warehouseId || undefined, {
    branchId: branchId || undefined,
    departmentId: departmentId || undefined,
    supplierId: supplier?.id,
    search: settled || undefined,
    productIds: picked,
    status,
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
        <div data-noprint className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
          <MultiSelect
            label={t('valuation.status')}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'in', label: t('valuation.status.in') },
              { value: 'out', label: t('valuation.status.out') },
              { value: 'low', label: t('valuation.status.low') },
            ]}
          />
          {seeSuppliers && (
            <PartyPicker
              type="SUPPLIER"
              withCode
              value={supplier}
              onChange={setSupplier}
              label={t('inventory.supplier')}
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
        {picked.length > 0 && (
          <div data-noprint className="flex items-center gap-2 text-sm">
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
          </div>
        )}
      </Card>
      {finding && (
        <ItemFinderSheet
          browse
          branchId={branchId || undefined}
          warehouseId={warehouseId || undefined}
          departmentId={departmentId || undefined}
          onClose={() => setFinding(false)}
          onAdd={(items) => {
            setPicked(items.map((i) => i.product.id));
            setFinding(false);
          }}
        />
      )}

      {valuation.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : !data || data.itemCount === 0 ? (
        <Card>
          <EmptyState title={t('common.empty')} icon="inventory" />
        </Card>
      ) : (
        can('inventory:valuation_items') && (
          <ValuationItems data={data} money={money} seeSuppliers={seeSuppliers} />
        )
      )}

      <PurchasesOfDay
        day={asOf}
        departmentId={departmentId}
        supplierCode={supplier ? String(supplier.code) : ''}
      />
    </div>
  );
}

type ItemSort =
  | 'quantity'
  | 'value'
  | 'salePrice'
  | 'supplyPrice'
  | 'label'
  | 'code'
  | 'supplier'
  | 'branch'
  | 'department'
  | 'warehouse'
  | 'reorderLevel';

/**
 * Item balances (أرصدة الأصناف): each item where it is — branch, department and warehouse — with
 * its quantity and, for whoever may see them, its prices and value (owner, 2026-10-21).
 */
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
  const place = (r: ValuationItem) =>
    [r.branch, r.department, r.warehouse].filter(Boolean).join(' · ');
  const [sort, setSort] = useState<{ key: ItemSort; dir: 1 | -1 } | null>(null);
  const items = sort
    ? [...data.items].sort((a, b) => {
        const x = a[sort.key] ?? 0;
        const y = b[sort.key] ?? 0;
        const c =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y), locale);
        return c * sort.dir;
      })
    : data.items;
  // Rows per page (owner, 2026-10-21); the other pages' rows are only hidden, so all print.
  const [size, setSize] = usePageSize('valuation.items', 50);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(page, pages);
  const off = (n: number) => (n < (at - 1) * size || n >= at * size ? 'screen-hidden' : '');
  const pager = items.length > 10 && (
    <div data-noprint className="flex justify-end border-b border-line px-3 py-2">
      <Pager
        page={at}
        size={size}
        pages={pages}
        onPage={setPage}
        onSize={(n) => {
          setSize(n);
          setPage(1);
        }}
      />
    </div>
  );
  // The column titles, to sort by the one clicked (here, so the pages split after sorting).
  const sortLabel: Record<ItemSort, string> = {
    code: t('inventory.sku'),
    label: t('inventory.itemName'),
    supplier: t('inventory.supplier'),
    branch: t('list.branch'),
    department: t('valuation.department'),
    warehouse: t('list.warehouse'),
    quantity: t('inventory.qty'),
    reorderLevel: t('valuation.reorder'),
    salePrice: t('item.salePrice'),
    supplyPrice: t('finder.costPrice'),
    value: t('inventory.value'),
  };
  const heading = (
    <h2 className="border-b border-line p-3 text-sm font-semibold uppercase tracking-wide text-muted">
      {t('valuation.itemsTitle')}
    </h2>
  );
  // A phone (owner, 2026-10-21: the table was squeezed): one card per item, nothing cut off,
  // ordered from a list instead of the column titles.
  if (isPhone)
    return (
      <Card padded={false} className="overflow-hidden">
        {heading}
        {pager}
        <div data-noprint className="flex justify-end border-b border-line px-3 py-2">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            {t('list.sortBy')}
            <select
              className="h-8 rounded-lg border border-line bg-surface px-1.5 text-xs outline-none focus:border-brand"
              value={sort ? `${sort.key}:${sort.dir}` : ''}
              onChange={(e) => {
                const [k, d] = e.target.value.split(':');
                setSort(k ? { key: k as ItemSort, dir: Number(d) as 1 | -1 } : null);
              }}
            >
              <option value="">{t('common.all')}</option>
              {(
                [
                  ['quantity', 'inventory.qty'],
                  ['label', 'inventory.itemName'],
                  ...(seePrice ? [['salePrice', 'item.salePrice']] : []),
                  ...(seeValue
                    ? [
                        ['supplyPrice', 'finder.costPrice'],
                        ['value', 'inventory.value'],
                      ]
                    : []),
                ] as [ItemSort, TranslationKey][]
              ).flatMap(([k, label]) =>
                ([-1, 1] as const).map((d) => (
                  <option key={`${k}:${d}`} value={`${k}:${d}`}>
                    {t(label)} {d === -1 ? '↓' : '↑'}
                  </option>
                )),
              )}
            </select>
          </label>
        </div>
        <ul className="divide-y divide-[var(--c-line)]">
          {items.map((r, n) => (
            <li key={r.key} className={`space-y-1 p-3 text-sm ${off(n)}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <ItemLink id={r.productId} name={r.label} className="font-medium" />
                  <p className="text-xs text-muted tnum" dir="ltr">
                    {r.code}
                  </p>
                  {place(r) && <p className="text-xs text-muted">{place(r)}</p>}
                  {seeSuppliers && r.supplier && <p className="text-xs text-muted">{r.supplier}</p>}
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
      {pager}
      <TableColumns
        id="inventory.valuation.balances"
        sorted={sort ? { label: sortLabel[sort.key], dir: sort.dir } : null}
        onSort={(label, dir) => {
          const key = (Object.keys(sortLabel) as ItemSort[]).find((k) => sortLabel[k] === label);
          setSort(key ? { key, dir } : null);
          setPage(1);
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="p-2 text-start font-medium">{t('inventory.sku')}</th>
                <th className="p-2 text-start font-medium">{t('inventory.itemName')}</th>
                {seeSuppliers && (
                  <th className="p-2 text-start font-medium">{t('inventory.supplier')}</th>
                )}
                <th className="p-2 text-start font-medium">{t('list.branch')}</th>
                <th className="p-2 text-start font-medium">{t('valuation.department')}</th>
                <th className="p-2 text-start font-medium">{t('list.warehouse')}</th>
                <th className="p-2 text-end font-medium">{t('inventory.qty')}</th>
                <th className="p-2 text-end font-medium">{t('valuation.reorder')}</th>
                {seePrice && <th className="p-2 text-end font-medium">{t('item.salePrice')}</th>}
                {seeValue && <th className="p-2 text-end font-medium">{t('finder.costPrice')}</th>}
                {seeValue && <th className="p-2 text-end font-medium">{t('inventory.value')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {items.map((r, n) => (
                <tr key={r.key} className={off(n)}>
                  <td className="whitespace-nowrap p-2 text-muted tnum" dir="ltr">
                    {r.code}
                  </td>
                  <td className="p-2">
                    <ItemLink id={r.productId} name={r.label} />
                  </td>
                  {seeSuppliers && <td className="p-2 text-muted">{r.supplier ?? ''}</td>}
                  <td className="p-2 text-muted">{r.branch ?? ''}</td>
                  <td className="p-2 text-muted">{r.department ?? ''}</td>
                  <td className="p-2 text-muted">{r.warehouse ?? ''}</td>
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
