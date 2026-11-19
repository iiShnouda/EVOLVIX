import { Fragment, useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import { useWorkPlace } from '../lib/workPlace';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  departmentFitsSeason,
  formatDate,
  formatMoney,
  formatNumber,
  formatQuantity,
  groupPermissions,
  parseDepartmentSeason,
  type DepartmentSeason,
  type InventoryItem,
  type Party,
  type Permission,
  type TranslationKey,
  type Valuation,
  type ValuationItem,
  type ValuationRow,
  companyToday,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { DeptSeasonSelect } from '../components/DeptSeasonSelect';
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
import {
  FilterPanel,
  RangeFilter,
  filterField,
  minorOf,
  useSettled,
} from '../components/FilterPanel';
import { ReportActions } from '../components/ReportActions';
import { useReportTools } from '../lib/report';

const field =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

const today = companyToday;

type Tab = 'items' | 'valuation' | 'stocktake' | 'transfers' | 'labels' | 'pricelists';
const TABS: { key: Tab; label: TranslationKey; anyOf: Permission[] }[] = [
  {
    key: 'items',
    label: 'inventory.items',
    anyOf: [
      'inventory:view',
      'inventory:card',
      'inventory:stocktake_view',
      'inventory:stocktake',
      'products:edit',
      'products:close',
      'products:delete',
      'products:barcodes',
      'products:images',
      'prices:edit',
      'products:card_purchases',
      'products:card_sales',
      'products:card_returns',
      'products:card_prices',
      'inventory:total_items',
      'inventory:total_quantity',
      'inventory:total_sale_value',
      'inventory:total_supply_value',
      'inventory:total_sold',
    ],
  },
  {
    key: 'valuation',
    label: 'inventory.valuation',
    anyOf: [
      'inventory:valuation',
      'inventory:valuation_departments',
      'inventory:valuation_warehouses',
      'inventory:valuation_items',
    ],
  },
  {
    key: 'stocktake',
    label: 'stocktake.action',
    anyOf: ['inventory:stocktake', 'inventory:stocktake_view'],
  },
  {
    key: 'transfers',
    label: 'transfer.title',
    anyOf: [
      'transfers:view',
      'transfers:print',
      'transfers:pdf',
      'inventory:transfer',
      'inventory:transfer_edit',
      'inventory:transfer_receive',
      'inventory:transfer_cancel',
    ],
  },
  { key: 'labels', label: 'labels.title', anyOf: ['labels:print', 'labels:pdf'] },
  {
    key: 'pricelists',
    label: 'pl.short',
    anyOf: [
      'price_lists:view',
      'price_lists:create',
      'price_lists:edit',
      'price_lists:prices',
      'price_lists:customers',
      'price_lists:delete',
      'quantity_breaks:view',
      'quantity_breaks:edit',
    ],
  },
];

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
  // Average cost, stock value and the valuation are the owner's unless given (costs:view).
  const seeCosts = can('costs:view');
  // The store's other screens open here, as tabs (owner, 2026-10-21: not on pages of their own),
  // each for whoever may use any part of it (owner, 2026-10-23).
  const tabs = TABS.filter((x) => x.anyOf.some(can)).map((x) => ({
    key: x.key,
    label: t(x.label),
  }));
  const asked = params.get('tab');
  const tab = (tabs.find((x) => x.key === asked)?.key ?? tabs[0]?.key) as Tab | undefined;
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
  // The departments' season (owner, 2026-11-16): only its departments, and those of none.
  const season = parseDepartmentSeason(params.get('season'));
  const allDepartments = useDepartments().data ?? [];
  const departments = allDepartments.filter(
    (d) => d.isActive && departmentFitsSeason(d.name, season),
  );
  // The filters start at everything (owner, 2026-10-18: it opened on one department and store);
  // a place chosen here is still remembered for the other screens.
  const [, setPlace] = useWorkPlace();

  const [search, setSearch] = useState('');
  // The item's code, its name and the supplier each in a box of their own (owner, 2026-10-17).
  const [code, setCode] = useState('');
  const [supplier, setSupplier] = useState<Party | null>(null);
  // The sale price between two amounts (owner, 2026-11-16: the detailed search).
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const prices = useSettled(`${minorOf(priceMin)}\u0001${minorOf(priceMax)}`);
  const [dMin = '', dMax = ''] = prices.split('\u0001');
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
    priceMin: dMin || undefined,
    priceMax: dMax || undefined,
    warehouseId: warehouseId || undefined,
    branchId: (!warehouseId && branchId) || undefined,
    departmentId: departmentId || undefined,
    groupId: groupId || undefined,
    season,
    enabled: tab === 'items',
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
    season,
    prices,
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
  // Branch, warehouse, department and group (owner, 2026-11-10), in the detailed search of the
  // items and above the valuation.
  const placeFilters = (
    <>
      {myBranches.length > 0 && (
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-muted">{t('list.branch')}</span>
          <select
            className={filterField}
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
      {
        <WarehouseSelect
          className="w-full min-w-0"
          value={warehouseId}
          onChange={(id, w) => {
            update({ wh: id || null });
            if (id && w?.kind !== 'DAMAGED') setPlace({ warehouseId: id });
          }}
          allowAll
          includeClosed
          withDamaged
        />
      }
      {departments.length > 0 && (
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-muted">{t('invoice.department')}</span>
          <select
            className={filterField}
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
      {departments.length > 0 && (
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-muted">{t('dash.deptSeason')}</span>
          <DeptSeasonSelect
            className={filterField}
            value={season}
            onChange={(v) => {
              // A department of the other season is let go.
              const picked = allDepartments.find((d) => d.id === departmentId);
              const off = picked && !departmentFitsSeason(picked.name, v);
              update({ season: v ?? null, ...(off ? { dept: null, grp: null } : {}) });
            }}
          />
        </label>
      )}
      {departmentId && groups.length > 0 && (
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
    </>
  );
  const placesActive = [branchId, warehouseId, departmentId, groupId, season].filter(
    Boolean,
  ).length;
  const clearPlaces = () => update({ br: null, wh: null, dept: null, grp: null, season: null });

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

      <div className="space-y-3">
        <div
          role="tablist"
          className="flex w-fit max-w-full overflow-x-auto rounded-[var(--radius-app)] border border-line bg-surface p-1"
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
          {[{ path: '/inventory/setup', label: t('catalog.setup') }]
            .filter(() => groupPermissions('setup').some(can))
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
          priceMin={priceMin}
          priceMax={priceMax}
          onPrice={(lo, hi) => {
            setPriceMin(lo);
            setPriceMax(hi);
          }}
          places={placeFilters}
          placesActive={placesActive}
          onClear={() => {
            setSupplier(null);
            setPriceMin('');
            setPriceMax('');
            update({ br: null, wh: null, dept: null, grp: null, st: null, low: null });
          }}
          onOpen={(id) =>
            navigate(`/inventory/items/${id}${warehouseId ? `?wh=${warehouseId}` : ''}`)
          }
        />
      ) : tab === 'valuation' ? (
        <>
          <FilterPanel id="valuation.places" active={placesActive} onClear={clearPlaces}>
            {placeFilters}
          </FilterPanel>
          <ValuationTab
            warehouseId={warehouseId}
            branchId={branchId}
            departmentId={departmentId}
            groupId={groupId}
            season={season}
          />
        </>
      ) : tab === 'stocktake' ? (
        <StocktakePage embedded />
      ) : tab === 'transfers' ? (
        <TransfersPage embedded />
      ) : tab === 'labels' ? (
        <LabelsPage embedded />
      ) : tab === 'pricelists' ? (
        <PriceListsPage embedded />
      ) : (
        <EmptyState title={t('common.empty')} icon="inventory" />
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
  priceMin,
  priceMax,
  onPrice,
  places,
  placesActive,
  onClear,
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
  priceMin: string;
  priceMax: string;
  onPrice: (min: string, max: string) => void;
  places: ReactNode;
  placesActive: number;
  onClear: () => void;
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
    // The supplier's code and name first, then the item's code and name (owner, 2026-11-10).
    ...(can('parties:view') || can('purchases:view')
      ? [
          {
            key: 'supplierCode',
            label: t('list.supplierCode'),
            className: 'text-muted tnum',
            cell: (p: InventoryItem) => p.supplierPartyCode ?? '',
          },
          {
            key: 'supplier',
            label: t('inventory.supplier'),
            className: 'text-muted',
            cell: (p: InventoryItem) => p.supplierName ?? '',
          },
        ]
      : []),
    { key: 'code', label: t('inventory.sku'), className: 'text-muted tnum', cell: (p) => p.sku },
    { key: 'name', label: t('inventory.itemName'), className: 'font-medium', cell: (p) => p.name },
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
      <div className="border-b border-line p-3">
        <FilterPanel
          id="inventory.items"
          active={
            placesActive +
            (supplier ? 1 : 0) +
            (statuses.length > 0 ? 1 : 0) +
            (priceMin || priceMax ? 1 : 0)
          }
          onClear={onClear}
          quick={
            <>
              <label className="block w-28 sm:w-36">
                <span className="mb-0.5 block text-xs text-muted">{t('inventory.sku')}</span>
                <input
                  className={`${filterField} tnum`}
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
                  className={`${filterField} ps-8`}
                  value={search}
                  onChange={(e) => onSearch(e.target.value)}
                />
              </label>
            </>
          }
          actions={
            <ReportActions
              scope="inventory"
              disabled={loading || items.length === 0}
              onPrint={() => report.print(paper.current, t('nav.inventory'))}
            />
          }
        >
          {places}
          <div className="min-w-0 sm:col-span-2">
            <PartyPicker
              type="SUPPLIER"
              withCode
              value={supplier}
              onChange={onSupplier}
              label={t('inventory.supplier')}
              placeholder={t('common.all')}
            />
          </div>
          <MultiSelect
            className="w-full min-w-0"
            label={t('valuation.status')}
            value={statuses}
            onChange={onStatuses}
            options={[
              { value: 'in', label: t('valuation.status.in') },
              { value: 'out', label: t('valuation.status.out') },
              { value: 'low', label: t('valuation.status.low') },
            ]}
          />
          <RangeFilter
            label={t('item.salePrice')}
            from={priceMin}
            to={priceMax}
            onFrom={(v) => onPrice(v, priceMax)}
            onTo={(v) => onPrice(priceMin, v)}
          />
        </FilterPanel>
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
          {(can('products:edit') || can('prices:edit') || can('products:delete')) && (
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

function ValuationTab({
  warehouseId,
  branchId,
  departmentId,
  groupId,
  season,
}: {
  warehouseId: string;
  branchId: string;
  departmentId: string;
  groupId: string;
  season?: DepartmentSeason;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const seeSuppliers = can('inventory:valuation_suppliers');
  const [asOf, setAsOf] = useState(today());
  // What to look at (owner, 2026-10-19/21): the branch, warehouse, department and group above (as
  // on the item list), a supplier, an item's name or code, items picked in the detailed search,
  // and a stock status. Everything starts at "all".
  const [supplier, setSupplier] = useState<Party | null>(null);
  const [search, setSearch] = useState('');
  const settled = useDeferredValue(search.trim());
  const [picked, setPicked] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);
  const valuation = useValuation(asOf, warehouseId || undefined, {
    branchId: branchId || undefined,
    departmentId: departmentId || undefined,
    groupId: (departmentId && groupId) || undefined,
    season,
    supplierId: supplier?.id,
    search: settled || undefined,
    productIds: picked,
    status,
  });
  const data = valuation.data;
  const currency = data?.currency ?? 'EGP';
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const money = (v: number | null | undefined) =>
    v == null ? '' : formatMoney(v, currency, locale);

  return (
    <div ref={paper} className="space-y-4">
      <Card className="space-y-3">
        <div data-noprint className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('inventory.asOf')}</span>
            <input
              type="date"
              className={`${field} w-full`}
              value={asOf}
              max={today()}
              onChange={(e) => setAsOf(e.target.value || today())}
            />
          </label>
          {seeSuppliers && (
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
          )}
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('valuation.search')}</span>
            <input
              className={`${field} w-full`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
          <div className="flex items-end">
            <Button variant="secondary" icon="search" onClick={() => setFinding(true)}>
              {t('finder.button')}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div data-noprint className="flex items-center gap-2 text-sm">
            {supplier && (
              <Button size="sm" variant="ghost" icon="close" onClick={() => setSupplier(null)}>
                {t('common.clear')}
              </Button>
            )}
            {picked.length > 0 && (
              <>
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
              </>
            )}
          </div>
          <ReportActions
            scope="inventory"
            disabled={!data}
            onPrint={() =>
              report.print(paper.current, t('inventory.valuation'), formatDate(asOf, locale))
            }
          />
        </div>
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

      {/* The totals first (owner, 2026-11-10: the page reorganised). */}
      {data && data.totalItems > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label={t('valuation.items')}
            value={t('valuation.counter')
              .replace('{n}', formatNumber(data.itemCount, locale))
              .replace('{total}', formatNumber(data.totalItems, locale))}
          />
          <Kpi label={t('inventory.qty')} value={formatNumber(data.quantity, locale)} />
          {data.value != null && (
            <Kpi label={t('inventory.stockValue')} value={money(data.value)} />
          )}
          {data.saleValue != null && (
            <Kpi label={t('valuation.saleValue')} value={money(data.saleValue)} />
          )}
        </div>
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
        <>
          <ValuationSummary data={data} money={money} />
          {can('inventory:valuation_items') && (
            <ValuationItems data={data} money={money} seeSuppliers={seeSuppliers} />
          )}
        </>
      )}

      <PurchasesOfDay
        day={asOf}
        departmentId={departmentId}
        supplierCode={supplier ? String(supplier.code) : ''}
      />
    </div>
  );
}

/**
 * Where the stock is (owner, 2026-11-10): by branch and warehouse (each branch with its total) or
 * by department, with pieces, value, value at sale price and each one's share — each for whoever may
 * see that part.
 */
function ValuationSummary({
  data,
  money,
}: {
  data: Valuation;
  money: (v: number | null | undefined) => string;
}) {
  const { t, locale } = useT();
  const parts = (
    [
      ['warehouses', 'valuation.byWarehouse', data.warehouses],
      ['departments', 'valuation.byDepartment', data.categories],
    ] as const
  ).filter(([, , rows]) => rows.length > 0);
  const [asked, setAsked] = useState<'warehouses' | 'departments'>('warehouses');
  const part = parts.find(([k]) => k === asked) ?? parts[0];
  if (!part) return null;
  const [key, , rows] = part;
  const seeValue = rows.some((r) => r.value != null);
  const seeSale = rows.some((r) => r.saleValue != null);
  const whole = rows.reduce((sum, r) => sum + (seeValue ? (r.value ?? 0) : r.quantity), 0);
  const share = (r: { value?: number | null; quantity: number }) =>
    whole > 0
      ? `${formatNumber(Math.round(((seeValue ? (r.value ?? 0) : r.quantity) * 1000) / whole) / 10, locale)}%`
      : '';
  const sum = (list: readonly ValuationRow[]) => ({
    count: list.reduce((s, r) => s + r.count, 0),
    quantity: list.reduce((s, r) => s + r.quantity, 0),
    value: list.reduce((s, r) => s + (r.value ?? 0), 0),
    saleValue: list.reduce((s, r) => s + (r.saleValue ?? 0), 0),
  });
  // Warehouses under their branch, each branch with its own total.
  const groups =
    key === 'warehouses'
      ? [...new Set(rows.map((r) => r.group ?? ''))]
          .sort((a, b) => a.localeCompare(b, locale))
          .map((g) => ({
            name: g,
            rows: rows
              .filter((r) => (r.group ?? '') === g)
              .sort((a, b) => (b.value ?? b.quantity) - (a.value ?? a.quantity)),
          }))
      : [{ name: '', rows: [...rows] }];
  const cells = (r: ReturnType<typeof sum> | ValuationRow) => (
    <>
      <td className="p-2 text-end tnum">{formatNumber(r.count, locale)}</td>
      <td className="p-2 text-end tnum">{formatNumber(r.quantity, locale)}</td>
      {seeValue && <td className="p-2 text-end tnum">{money(r.value)}</td>}
      {seeSale && <td className="p-2 text-end tnum">{money(r.saleValue)}</td>}
      <td className="p-2 text-end text-muted tnum">{share(r)}</td>
    </>
  );
  const total = sum(rows);
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t('valuation.summary')}
        </h2>
        {parts.length > 1 && (
          <div
            data-noprint
            role="tablist"
            className="flex rounded-[var(--radius-app)] border border-line bg-surface p-0.5"
          >
            {parts.map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={k === key}
                onClick={() => setAsked(k)}
                className={`h-7 rounded-md px-2.5 text-xs font-medium ${
                  k === key ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
                }`}
              >
                {t(label)}
              </button>
            ))}
          </div>
        )}
      </div>
      <TableColumns id="valuation.breakdown">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="p-2 text-start font-medium">
                  {t(key === 'warehouses' ? 'list.warehouse' : 'valuation.department')}
                </th>
                <th className="p-2 text-end font-medium">{t('valuation.items')}</th>
                <th className="p-2 text-end font-medium">{t('inventory.qty')}</th>
                {seeValue && <th className="p-2 text-end font-medium">{t('inventory.value')}</th>}
                {seeSale && (
                  <th className="p-2 text-end font-medium">{t('valuation.saleValue')}</th>
                )}
                <th className="p-2 text-end font-medium">{t('valuation.share')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {groups.map((g) => (
                <Fragment key={g.name || '-'}>
                  {g.name && (
                    <tr data-span className="bg-surface-2/60">
                      <td
                        className="p-2 font-semibold"
                        colSpan={2 + 2 + (seeValue ? 1 : 0) + (seeSale ? 1 : 0)}
                      >
                        {g.name}
                      </td>
                    </tr>
                  )}
                  {g.rows.map((r) => (
                    <tr key={r.key}>
                      <td className={`p-2 ${g.name ? 'ps-5' : ''}`}>{r.label}</td>
                      {cells(r)}
                    </tr>
                  ))}
                  {g.name && g.rows.length > 1 && (
                    <tr className="font-medium">
                      <td className="p-2 ps-5 text-muted">
                        {t('valuation.totalOf').replace('{name}', g.name)}
                      </td>
                      {cells(sum(g.rows))}
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr className="bg-surface-2 font-semibold">
                <td className="p-2">{t('common.total')}</td>
                {cells(total)}
              </tr>
            </tbody>
          </table>
        </div>
      </TableColumns>
    </Card>
  );
}

type ItemSort =
  | 'quantity'
  | 'value'
  | 'salePrice'
  | 'saleValue'
  | 'supplyPrice'
  | 'label'
  | 'code'
  | 'supplierPartyCode'
  | 'supplier'
  | 'branch'
  | 'department'
  | 'warehouse'
  | 'reorderLevel';

type GroupBy = '' | 'branch' | 'warehouse' | 'department' | 'supplier';

/**
 * Item balances (أرصدة الأصناف): each item where it is — branch, warehouse and department — with
 * its quantity and, for whoever may see them, its prices and value (owner, 2026-10-21); grouped by
 * branch, warehouse, department or supplier with each group's total, and the total of all at the
 * end (owner, 2026-11-10).
 */
function ValuationItems({
  data,
  money,
  seeSuppliers,
}: {
  data: Valuation;
  money: (v: number | null | undefined) => string;
  seeSuppliers: boolean;
}) {
  const { t, locale } = useT();
  const isPhone = useDeviceInfo().deviceClass === 'phone';
  const seeValue = data.value != null || data.items.some((i) => i.value != null);
  const seePrice = data.items.some((i) => i.salePrice != null);
  const qtyTone = (r: ValuationItem) =>
    r.empty ? 'text-destructive' : r.low ? 'text-warning' : '';
  const place = (r: ValuationItem) =>
    [r.branch, r.warehouse, r.department].filter(Boolean).join(' · ');
  const saleValue = (r: ValuationItem) => (r.salePrice == null ? null : r.salePrice * r.quantity);
  const [sort, setSort] = useState<{ key: ItemSort; dir: 1 | -1 } | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('');
  const groupOf = (r: ValuationItem) => (groupBy ? (r[groupBy] ?? '') : '');
  const valueOf = (r: ValuationItem, k: ItemSort) => (k === 'saleValue' ? saleValue(r) : r[k]);
  const items = [...data.items].sort((a, b) => {
    const g = groupOf(a).localeCompare(groupOf(b), locale);
    if (g || !sort) return g;
    const x = valueOf(a, sort.key) ?? 0;
    const y = valueOf(b, sort.key) ?? 0;
    const c =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), locale);
    return c * sort.dir;
  });
  // Rows per page (owner, 2026-10-21); the other pages' rows are only hidden, so all print.
  const [size, setSize] = usePageSize('valuation.items', 50);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(page, pages);
  const onPage = (n: number) => n >= (at - 1) * size && n < at * size;
  const off = (n: number) => (onPage(n) ? '' : 'screen-hidden');
  const totals = (list: ValuationItem[]) => ({
    quantity: list.reduce((s, r) => s + r.quantity, 0),
    value: list.reduce((s, r) => s + (r.value ?? 0), 0),
    saleValue: list.reduce((s, r) => s + (saleValue(r) ?? 0), 0),
  });
  const pager = items.length > 10 && (
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
  );
  // The column titles, to sort by the one clicked (here, so the pages split after sorting).
  const sortLabel: Partial<Record<ItemSort, string>> = {
    ...(seeSuppliers
      ? { supplierPartyCode: t('list.supplierCode'), supplier: t('inventory.supplier') }
      : {}),
    code: t('inventory.sku'),
    label: t('inventory.itemName'),
    branch: t('list.branch'),
    warehouse: t('list.warehouse'),
    department: t('valuation.department'),
    quantity: t('inventory.qty'),
    reorderLevel: t('valuation.reorder'),
    ...(seePrice ? { salePrice: t('item.salePrice'), saleValue: t('valuation.saleValue') } : {}),
    ...(seeValue ? { supplyPrice: t('finder.costPrice'), value: t('inventory.value') } : {}),
  };
  const columns = Object.keys(sortLabel) as ItemSort[];
  const numeric = new Set<ItemSort>([
    'quantity',
    'reorderLevel',
    'salePrice',
    'saleValue',
    'supplyPrice',
    'value',
  ]);
  const cell = (r: ValuationItem, k: ItemSort): ReactNode => {
    switch (k) {
      case 'label':
        return <ItemLink id={r.productId} name={r.label} />;
      case 'quantity':
        return formatNumber(r.quantity, locale);
      case 'reorderLevel':
        return r.reorderLevel > 0 ? formatNumber(r.reorderLevel, locale) : '';
      case 'salePrice':
      case 'supplyPrice':
      case 'value':
        return money(r[k]);
      case 'saleValue':
        return money(saleValue(r));
      default:
        return r[k] ?? '';
    }
  };
  const sumCell = (k: ItemSort, s: ReturnType<typeof totals>) =>
    k === 'quantity'
      ? formatNumber(s.quantity, locale)
      : k === 'value'
        ? money(s.value)
        : k === 'saleValue'
          ? money(s.saleValue)
          : '';
  const toolbar = (
    <div
      data-noprint
      className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2"
    >
      <label className="flex items-center gap-1.5 text-xs text-muted">
        {t('valuation.groupBy')}
        <select
          className="h-8 rounded-lg border border-line bg-surface px-1.5 text-xs outline-none focus:border-brand"
          value={groupBy}
          onChange={(e) => {
            setGroupBy(e.target.value as GroupBy);
            setPage(1);
          }}
        >
          <option value="">{t('valuation.noGroup')}</option>
          <option value="branch">{t('list.branch')}</option>
          <option value="warehouse">{t('list.warehouse')}</option>
          <option value="department">{t('valuation.department')}</option>
          {seeSuppliers && <option value="supplier">{t('inventory.supplier')}</option>}
        </select>
      </label>
      {isPhone && (
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
            {columns.flatMap((k) =>
              ([-1, 1] as const).map((d) => (
                <option key={`${k}:${d}`} value={`${k}:${d}`}>
                  {sortLabel[k]} {d === -1 ? '↓' : '↑'}
                </option>
              )),
            )}
          </select>
        </label>
      )}
      {pager}
    </div>
  );
  // Where each group starts and ends, to put its name above and its total below.
  const first = (n: number) =>
    !!groupBy && (n === 0 || groupOf(items[n - 1]!) !== groupOf(items[n]!));
  const last = (n: number) =>
    !!groupBy && (n === items.length - 1 || groupOf(items[n + 1]!) !== groupOf(items[n]!));
  const groupRows = (n: number) => items.filter((r) => groupOf(r) === groupOf(items[n]!));
  const heading = (
    <h2 className="border-b border-line p-3 text-sm font-semibold uppercase tracking-wide text-muted">
      {t('valuation.itemsTitle')}
    </h2>
  );
  const all = totals(items);
  // A phone (owner, 2026-10-21: the table was squeezed): one card per item, nothing cut off.
  if (isPhone)
    return (
      <Card padded={false} className="overflow-hidden">
        {heading}
        {toolbar}
        <ul className="divide-y divide-[var(--c-line)]">
          {items.map((r, n) => (
            <Fragment key={r.key}>
              {first(n) && (
                <li className={`bg-surface-2 px-3 py-2 text-sm font-semibold ${off(n)}`}>
                  {groupOf(r) || '—'}
                </li>
              )}
              <li className={`space-y-1 p-3 text-sm ${off(n)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <ItemLink id={r.productId} name={r.label} className="font-medium" />
                    <p className="text-xs text-muted tnum" dir="ltr">
                      {r.code}
                    </p>
                    {place(r) && <p className="text-xs text-muted">{place(r)}</p>}
                    {seeSuppliers && r.supplier && (
                      <p className="text-xs text-muted">
                        {r.supplierPartyCode != null ? `${r.supplierPartyCode} · ` : ''}
                        {r.supplier}
                      </p>
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
              {last(n) && (
                <li className={`flex justify-between px-3 py-2 text-sm font-medium ${off(n)}`}>
                  <span>{t('valuation.totalOf').replace('{name}', groupOf(r) || '—')}</span>
                  <span className="tnum">
                    {formatNumber(totals(groupRows(n)).quantity, locale)}
                    {seeValue && ` · ${money(totals(groupRows(n)).value)}`}
                  </span>
                </li>
              )}
            </Fragment>
          ))}
          <li className="flex justify-between bg-surface-2 px-3 py-2 text-sm font-semibold">
            <span>{t('common.total')}</span>
            <span className="tnum">
              {formatNumber(all.quantity, locale)}
              {seeValue && ` · ${money(all.value)}`}
            </span>
          </li>
        </ul>
      </Card>
    );
  return (
    <Card padded={false} className="overflow-hidden">
      {heading}
      {toolbar}
      <TableColumns
        id="inventory.valuation.balances"
        sorted={sort && sortLabel[sort.key] ? { label: sortLabel[sort.key]!, dir: sort.dir } : null}
        onSort={(label, dir) => {
          const key = columns.find((k) => sortLabel[k] === label);
          setSort(key ? { key, dir } : null);
          setPage(1);
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                {columns.map((k) => (
                  <th
                    key={k}
                    className={`p-2 font-medium ${numeric.has(k) ? 'text-end' : 'text-start'}`}
                  >
                    {sortLabel[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {items.map((r, n) => (
                <Fragment key={r.key}>
                  {first(n) && (
                    <tr data-span className={`bg-surface-2/60 ${off(n)}`}>
                      <td className="p-2 font-semibold" colSpan={columns.length}>
                        {groupOf(r) || '—'}
                      </td>
                    </tr>
                  )}
                  <tr className={off(n)}>
                    {columns.map((k) => (
                      <td
                        key={k}
                        className={`p-2 ${
                          numeric.has(k)
                            ? `whitespace-nowrap text-end tnum ${k === 'quantity' ? qtyTone(r) : ''} ${k === 'value' ? 'font-medium' : ''}`
                            : k === 'label'
                              ? 'min-w-48'
                              : k === 'code' || k === 'supplierPartyCode'
                                ? 'whitespace-nowrap text-muted tnum'
                                : 'whitespace-nowrap text-muted'
                        }`}
                        dir={k === 'code' ? 'ltr' : undefined}
                      >
                        {cell(r, k)}
                      </td>
                    ))}
                  </tr>
                  {last(n) && (
                    <tr className={`font-medium ${off(n)}`}>
                      {columns.map((k, i) => (
                        <td
                          key={k}
                          className={`whitespace-nowrap p-2 ${numeric.has(k) ? 'text-end tnum' : ''}`}
                        >
                          {i === 0
                            ? t('valuation.totalOf').replace('{name}', groupOf(r) || '—')
                            : sumCell(k, totals(groupRows(n)))}
                        </td>
                      ))}
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr className="bg-surface-2 font-semibold">
                {columns.map((k, i) => (
                  <td
                    key={k}
                    className={`whitespace-nowrap p-2 ${numeric.has(k) ? 'text-end tnum' : ''}`}
                  >
                    {i === 0 ? t('common.total') : sumCell(k, all)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </TableColumns>
    </Card>
  );
}

function StockBadge({ item }: { item: InventoryItem }) {
  const { t } = useT();
  // None left is run out, even at the reorder level (owner, 2026-11-10).
  return item.stockOnHand <= 0 ? (
    <Badge tone="destructive">{t('inventory.out')}</Badge>
  ) : item.isLow ? (
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
            <TableColumns id="inventory.supplierSheet">
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
            </TableColumns>
          </div>
        </Sheet>
      )}
    </Card>
  );
}
