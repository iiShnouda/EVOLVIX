import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useWorkPlace } from '../lib/workPlace';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatQuantity,
  type InventoryItem,
  type Party,
  companyToday,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { WarehouseSelect } from '../components/WarehouseSelect';
import { PartyPicker } from '../components/PartyPicker';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useAuth } from '../stores/auth';
import { useDeviceInfo } from '../lib/device';
import { useDepartments, useGroups, useInventory, usePageSize, useValuation } from '../lib/queries';
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
  const tab: Tab = seeCosts && params.get('tab') === 'valuation' ? 'valuation' : 'items';
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
            <Button
              size="sm"
              variant="secondary"
              icon="settings"
              onClick={() => navigate('/inventory/setup')}
            >
              {t('catalog.setup')}
            </Button>
            {can('labels:print') && (
              <Button
                size="sm"
                variant="secondary"
                icon="scan"
                onClick={() => navigate('/inventory/labels')}
              >
                {t('labels.title')}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate('/inventory/price-lists')}
            >
              {t('pl.short')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="returns"
              onClick={() => navigate('/inventory/transfers')}
            >
              {t('transfer.title')}
            </Button>
            {canEdit && (
              <Button size="sm" icon="check" onClick={() => navigate('/inventory/stocktake')}>
                {t('stocktake.action')}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {seeCosts && (
          <Kpi
            label={t('inventory.stockValue')}
            value={formatMoney(list.data?.totalValue ?? 0, currency, locale)}
          />
        )}
        <Kpi
          label={t('inventory.itemCount')}
          value={formatNumber(list.data?.totalItems ?? 0, locale)}
        />
        <button
          onClick={() => setLowOnly(!lowOnly)}
          className="col-span-2 text-start lg:col-span-1"
        >
          <Kpi
            label={t('inventory.lowStock')}
            value={formatNumber(list.data?.lowStockCount ?? 0, locale)}
            tone={(list.data?.lowStockCount ?? 0) > 0 ? 'warning' : undefined}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div
          role="tablist"
          className="inline-flex rounded-[var(--radius-app)] border border-line bg-surface p-1"
        >
          {(seeCosts ? (['items', 'valuation'] as const) : (['items'] as const)).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
                tab === k ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
              }`}
            >
              {t(k === 'items' ? 'inventory.items' : 'inventory.valuation')}
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
    </Card>
  );
}

function ValuationTab({ warehouseId }: { warehouseId: string }) {
  const { t, locale } = useT();
  const [asOf, setAsOf] = useState(today());
  const valuation = useValuation(asOf, warehouseId || undefined);
  const data = valuation.data;
  const currency = data?.currency ?? 'EGP';
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);

  return (
    <div ref={paper} className="space-y-4">
      <Card>
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
            <p className="text-xs text-muted">{t('inventory.stockValue')}</p>
            <p className="text-lg font-semibold tnum">
              {formatMoney(data?.value ?? 0, currency, locale)}
            </p>
            <p className="text-xs text-muted tnum">
              {formatNumber(data?.quantity ?? 0, locale)} {t('inventory.qty')}
            </p>
          </div>
        </div>
      </Card>

      {valuation.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('common.empty')} icon="inventory" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.models.length > 0 && (
            <ValuationTable
              title={t('inventory.byModel')}
              rows={data.models}
              currency={currency}
              locale={locale}
            />
          )}
          {!warehouseId && data.warehouses.length > 1 && (
            <ValuationTable
              title={t('warehouse.byWarehouse')}
              rows={data.warehouses}
              currency={currency}
              locale={locale}
            />
          )}
          <ValuationTable
            title={t('inventory.byCategory')}
            rows={data.categories}
            currency={currency}
            locale={locale}
          />
          <ValuationTable
            title={t('inventory.byItem')}
            rows={data.items}
            currency={currency}
            locale={locale}
          />
        </div>
      )}
    </div>
  );
}

function ValuationTable({
  title,
  rows,
  currency,
  locale,
}: {
  title: string;
  rows: { key: string; label: string; quantity: number; value: number }[];
  currency: string;
  locale: 'en' | 'ar';
}) {
  const { t } = useT();
  return (
    <Card padded={false} className="h-fit overflow-hidden">
      <h2 className="border-b border-line p-3 text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      <TableColumns id="inventory.valuation">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="p-3 text-start font-medium">{title}</th>
              <th className="p-3 text-end font-medium">{t('inventory.qty')}</th>
              <th className="p-3 text-end font-medium">{t('inventory.value')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--c-line)]">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="p-3">{r.label}</td>
                <td className="p-3 text-end tnum">{formatNumber(r.quantity, locale)}</td>
                <td className="p-3 text-end font-medium tnum">
                  {formatMoney(r.value, currency, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
