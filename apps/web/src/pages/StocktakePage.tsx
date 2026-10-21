import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  companyToday,
  formatDate,
  formatMoney,
  formatNumber,
  type InventoryItem,
  type StocktakeResult,
} from '@skb/shared';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { Pager } from '../components/Pager';
import { ReportActions } from '../components/ReportActions';
import { WarehouseSelect, useDefaultWarehouseId } from '../components/WarehouseSelect';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ApiError } from '../lib/api';
import { useWorkDraft } from '../lib/workDraft';
import { useAuth } from '../stores/auth';
import { useReportTools } from '../lib/report';
import {
  scanPhoto,
  useDepartments,
  useInventory,
  usePageSize,
  useStocktake,
  useWarehouses,
} from '../lib/queries';
import { errorText } from '../lib/errors';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

interface Line {
  item: InventoryItem;
  qty: number;
  diff: number;
  value: number;
}

/** Shortage and surplus of one supplier (a factory), or of all of them. */
interface SupplierTotals {
  name: string;
  shortQty: number;
  shortValue: number;
  overQty: number;
  overValue: number;
}

/** Totals by supplier, with the grand total last. */
function bySupplier(lines: Line[], none: string): SupplierTotals[] {
  const map = new Map<string, SupplierTotals>();
  const total: SupplierTotals = { name: '', shortQty: 0, shortValue: 0, overQty: 0, overValue: 0 };
  for (const l of lines) {
    const name = l.item.supplierName || none;
    const row = map.get(name) ?? { name, shortQty: 0, shortValue: 0, overQty: 0, overValue: 0 };
    for (const r of [row, total]) {
      if (l.diff < 0) {
        r.shortQty += -l.diff;
        r.shortValue += -l.value;
      } else {
        r.overQty += l.diff;
        r.overValue += l.value;
      }
    }
    map.set(name, row);
  }
  return [...[...map.values()].sort((a, b) => a.name.localeCompare(b.name)), total];
}

/** The code as written or printed, to match an item: digits as Latin, no spaces, any case. */
const norm = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, '')
    .toLowerCase();

/**
 * Stocktake (الجرد والتسويات) of one warehouse, by branch and department (owner, 2026-10-21): print
 * a count sheet, count by hand, then type the counts or upload a photo of the sheet for the server to
 * read. Each item's shortage or surplus shows with its value, and by supplier (factory) with the
 * total of all; nothing changes until whoever reviews it saves. Each difference is then posted as an
 * adjustment at the current average cost, under one ADJ- reference. Items left blank are not touched.
 */
export function StocktakePage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t, locale } = useT();
  const can = useCan();
  // What a count gains or loses at cost is the owner's unless given (costs:view).
  const seeCosts = can('costs:view');
  const canScan = can('ai:scan');
  const navigate = useNavigate();
  const myBranches = useAuth((s) => s.user?.branches ?? []);
  const warehouses = useWarehouses(true);
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  const defaultWarehouse = useDefaultWarehouseId();
  const [picked, setPicked] = useState('');
  const inBranch = (id: string) =>
    !branchId || (warehouses.data ?? []).some((w) => w.id === id && w.branchId === branchId);
  const warehouseId = picked || (inBranch(defaultWarehouse) ? defaultWarehouse : '');
  const warehouseName = (warehouses.data ?? []).find((w) => w.id === warehouseId)?.name ?? '';
  const departments = (useDepartments().data ?? []).filter((d) => d.isActive);
  const list = useInventory({
    warehouseId: warehouseId || undefined,
    departmentId: departmentId || undefined,
  });
  const stocktake = useStocktake();
  const error = stocktake.error as ApiError | null;
  const [size, setSize] = usePageSize('stocktake', 50);
  const [page, setPage] = useState(1);

  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<{ res: StocktakeResult; totals: SupplierTotals[] } | null>(
    null,
  );
  const [reading, setReading] = useState<number | null>(null);
  const [readNote, setReadNote] = useState<{ ok: boolean; text: string } | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const report = useReportTools();

  // A count in progress is kept on the server, brought back after a crash or on another device.
  useWorkDraft<{ warehouseId: string; counted: Record<string, string>; reason: string }>(
    1,
    () =>
      Object.values(counted).every((v) => v === '') && !reason.trim()
        ? null
        : { warehouseId: picked, counted, reason },
    (d) => {
      if (typeof d.warehouseId === 'string') setPicked(d.warehouseId);
      if (d.counted && typeof d.counted === 'object') setCounted(d.counted);
      if (typeof d.reason === 'string') setReason(d.reason);
    },
  );

  const currency = list.data?.currency ?? 'EGP';
  const all = list.data?.items ?? [];
  const s = search.trim().toLowerCase();
  const visible = s
    ? all.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
    : all;
  const pages = Math.max(1, Math.ceil(visible.length / size));
  const at = Math.min(page, pages);
  const shown = visible.slice((at - 1) * size, at * size);

  const lines: Line[] = all
    .filter((p) => (counted[p.id] ?? '') !== '')
    .map((p) => {
      const qty = Math.max(0, Math.floor(Number(counted[p.id]) || 0));
      const diff = qty - p.stockOnHand;
      return { item: p, qty, diff, value: diff * p.avgCost };
    });
  const changed = lines.filter((l) => l.diff !== 0);
  const totals = bySupplier(changed, t('stocktake.noSupplier'));
  const grand = totals[totals.length - 1]!;
  const money = (v: number) => formatMoney(v, currency, locale);

  function newCount() {
    setCounted({});
    setResult(null);
    setReadNote(null);
    setPage(1);
  }

  async function readSheet(file: File) {
    setReadNote(null);
    setReading(0);
    try {
      const rows = await scanPhoto<{ code: string; counted: number }[]>(
        'stocktake',
        file,
        setReading,
      );
      const byCode = new Map(all.map((p) => [norm(p.sku), p]));
      const next = { ...counted };
      const unknown: string[] = [];
      let matched = 0;
      for (const r of rows) {
        const item = byCode.get(norm(r.code));
        if (!item) {
          unknown.push(r.code);
          continue;
        }
        next[item.id] = String(Math.max(0, Math.round(r.counted)));
        matched++;
      }
      setCounted(next);
      setReadNote({
        ok: matched > 0,
        text:
          t('stocktake.readDone').replace('{n}', formatNumber(matched, locale)) +
          (unknown.length ? ` · ${t('stocktake.readUnknown')}: ${unknown.join('، ')}` : ''),
      });
    } catch (e) {
      setReadNote({ ok: false, text: errorText(t, e as ApiError) ?? '' });
    } finally {
      setReading(null);
      if (photo.current) photo.current.value = '';
    }
  }

  async function post() {
    try {
      const res = await stocktake.mutateAsync({
        lines: changed.map((l) => ({ productId: l.item.id, countedQuantity: l.qty })),
        reason: reason.trim() || undefined,
        warehouseId: warehouseId || undefined,
      });
      // What happened, by supplier, stays on the screen after the count is cleared.
      setResult({ res, totals });
      setCounted({});
      setReason('');
      setReadNote(null);
    } catch {
      /* surfaced via error */
    }
  }

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader
          title={t('stocktake.title')}
          action={
            <Button variant="ghost" size="sm" icon="close" onClick={() => navigate('/inventory')}>
              {t('itemCard.back')}
            </Button>
          }
        />
      )}

      {result && (
        <Card className="space-y-3 border-positive">
          <p className="text-sm font-semibold text-positive">
            {t('stocktake.posted')} · <span className="tnum">{result.res.reference}</span> ·{' '}
            {result.res.warehouseName}
          </p>
          <p className="text-sm text-muted tnum">
            {t('stocktake.changedItems')}: {formatNumber(result.res.itemsChanged, locale)}
            {seeCosts && ` · ${t('stocktake.valueImpact')} ${money(result.res.valueChange)}`}
          </p>
          <SupplierTable totals={result.totals} money={money} seeCosts={seeCosts} />
        </Card>
      )}

      <Card className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {myBranches.length > 1 && (
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('list.branch')}</span>
              <select
                className={field}
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setPicked('');
                  newCount();
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
          <WarehouseSelect
            label={t('warehouse.counting')}
            branchId={branchId || undefined}
            value={warehouseId}
            onChange={(id) => {
              // Counts belong to one warehouse: switching starts a fresh count.
              setPicked(id);
              newCount();
            }}
          />
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('valuation.department')}</span>
            <select
              className={field}
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setPage(1);
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
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('valuation.search')}</span>
            <input
              className={field}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReportActions
            disabled={!warehouseId || visible.length === 0}
            onPrint={() =>
              report.print(
                sheet.current,
                t('stocktake.sheet'),
                [warehouseName, formatDate(companyToday(), locale)].filter(Boolean).join(' · '),
              )
            }
          />
          {canScan && (
            <>
              <input
                ref={photo}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readSheet(f);
                }}
              />
              <Button
                variant="secondary"
                icon="upload"
                disabled={!warehouseId || reading !== null}
                loading={reading !== null}
                onClick={() => photo.current?.click()}
              >
                {reading !== null
                  ? `${t('stocktake.reading')} ${reading}s`
                  : t('stocktake.readPhoto')}
              </Button>
            </>
          )}
        </div>
        {readNote && (
          <p
            className={`rounded-[var(--radius-app)] p-2 text-sm ${readNote.ok ? 'bg-positive-soft text-positive' : 'bg-destructive-soft text-destructive'}`}
          >
            {readNote.text}
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <Card padded={false} className="min-w-0 overflow-hidden">
          {!warehouseId ? (
            <EmptyState title={t('stocktake.pickWarehouse')} icon="inventory" />
          ) : list.isLoading ? (
            <div className="grid place-items-center py-16 text-muted">
              <Spinner size={26} />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState title={t('common.empty')} icon="inventory" />
          ) : (
            <>
              <div className="flex justify-end border-b border-line p-2">
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
              <ul className="divide-y divide-[var(--c-line)]">
                {shown.map((p) => {
                  const line = lines.find((l) => l.item.id === p.id);
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted tnum">
                          {p.sku} · {t('stocktake.system')}: {formatNumber(p.stockOnHand, locale)}{' '}
                          {p.unit}
                          {p.supplierName ? ` · ${p.supplierName}` : ''}
                        </p>
                        {line && line.diff !== 0 && (
                          <p
                            className={`text-xs tnum ${line.diff > 0 ? 'text-positive' : 'text-destructive'}`}
                          >
                            {t(line.diff > 0 ? 'stocktake.over' : 'stocktake.short')}:{' '}
                            {formatNumber(Math.abs(line.diff), locale)}
                            {seeCosts && ` · ${money(Math.abs(line.value))}`}
                          </p>
                        )}
                      </div>
                      <label className="block w-28">
                        <span className="mb-0.5 block text-xs text-muted">
                          {t('stocktake.counted')}
                        </span>
                        <input
                          type="number"
                          min={0}
                          className={`${field} tnum`}
                          value={counted[p.id] ?? ''}
                          onChange={(e) =>
                            setCounted((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>

        <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <Card>
            <dl className="space-y-1.5 text-sm">
              <Row
                label={t('stocktake.changedItems')}
                value={formatNumber(changed.length, locale)}
              />
              <Row
                label={t('stocktake.short')}
                value={
                  formatNumber(grand.shortQty, locale) +
                  (seeCosts ? ` · ${money(grand.shortValue)}` : '')
                }
                tone="warning"
              />
              <Row
                label={t('stocktake.over')}
                value={
                  formatNumber(grand.overQty, locale) +
                  (seeCosts ? ` · ${money(grand.overValue)}` : '')
                }
                tone="positive"
              />
              {seeCosts && (
                <>
                  <div className="my-1 border-t border-line" />
                  <Row
                    label={t('stocktake.valueImpact')}
                    value={money(grand.overValue - grand.shortValue)}
                    strong
                  />
                </>
              )}
            </dl>
            <label className="mt-3 block">
              <span className="mb-0.5 block text-xs text-muted">{t('stocktake.reason')}</span>
              <input
                className={field}
                placeholder={t('stocktake.reasonHint')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && (
              <p className="mt-3 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
                {errorText(t, error)}
              </p>
            )}
            <Button
              className="mt-4 w-full"
              icon="check"
              loading={stocktake.isPending}
              disabled={changed.length === 0}
              onClick={post}
            >
              {stocktake.isPending ? t('stocktake.saving') : t('stocktake.save')}
            </Button>
          </Card>
          {changed.length > 0 && (
            <Card padded={false} className="overflow-hidden">
              <h3 className="border-b border-line p-3 text-sm font-semibold">
                {t('stocktake.bySupplier')}
              </h3>
              <SupplierTable totals={totals} money={money} seeCosts={seeCosts} />
            </Card>
          )}
          {/* Each difference, to review before saving: one taken off is not adjusted. */}
          {changed.length > 0 && (
            <Card padded={false} className="overflow-hidden">
              <h3 className="border-b border-line p-3 text-sm font-semibold">
                {t('stocktake.review')}
              </h3>
              <ul className="max-h-96 divide-y divide-[var(--c-line)] overflow-y-auto text-sm">
                {changed.map((l) => (
                  <li key={l.item.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">{l.item.name}</span>
                    <span
                      className={`shrink-0 tnum ${l.diff > 0 ? 'text-positive' : 'text-destructive'}`}
                    >
                      {l.diff > 0 ? '+' : '−'}
                      {formatNumber(Math.abs(l.diff), locale)}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-faint hover:text-destructive"
                      aria-label={t('invoice.remove')}
                      title={t('invoice.remove')}
                      onClick={() => setCounted((prev) => ({ ...prev, [l.item.id]: '' }))}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {/* The count sheet: printed, filled in by hand, then typed or photographed back. */}
      <div className="hidden">
        <div ref={sheet}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="p-2 text-start">#</th>
                <th className="p-2 text-start">{t('inventory.sku')}</th>
                <th className="p-2 text-start">{t('inventory.itemName')}</th>
                <th className="p-2 text-start">{t('stocktake.unit')}</th>
                <th className="w-32 p-2 text-start">{t('stocktake.counted')}</th>
                <th className="w-40 p-2 text-start">{t('stocktake.note')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p, i) => (
                <tr key={p.id}>
                  <td className="p-2 tnum">{i + 1}</td>
                  <td className="p-2 font-semibold tnum" dir="ltr">
                    {p.sku}
                  </td>
                  <td className="p-2">{p.name}</td>
                  <td className="p-2">{p.unit}</td>
                  <td className="p-2" />
                  <td className="p-2" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SupplierTable({
  totals,
  money,
  seeCosts,
}: {
  totals: SupplierTotals[];
  money: (v: number) => string;
  seeCosts: boolean;
}) {
  const { t, locale } = useT();
  const n = (v: number) => formatNumber(v, locale);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>
            <th className="p-2 text-start font-medium">{t('inventory.supplier')}</th>
            <th className="p-2 text-end font-medium">{t('stocktake.short')}</th>
            <th className="p-2 text-end font-medium">{t('stocktake.over')}</th>
            {seeCosts && <th className="p-2 text-end font-medium">{t('stocktake.net')}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--c-line)]">
          {totals.map((r, i) => {
            const last = i === totals.length - 1;
            return (
              <tr key={r.name || '__total'} className={last ? 'bg-surface-2 font-semibold' : ''}>
                <td className="p-2">{last ? t('common.total') : r.name}</td>
                <td className="whitespace-nowrap p-2 text-end tnum text-destructive">
                  {n(r.shortQty)}
                  {seeCosts && <span className="block text-xs">{money(r.shortValue)}</span>}
                </td>
                <td className="whitespace-nowrap p-2 text-end tnum text-positive">
                  {n(r.overQty)}
                  {seeCosts && <span className="block text-xs">{money(r.overValue)}</span>}
                </td>
                {seeCosts && (
                  <td className="whitespace-nowrap p-2 text-end tnum">
                    {money(r.overValue - r.shortValue)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'positive' | 'warning';
}) {
  const color = tone === 'positive' ? 'text-positive' : tone === 'warning' ? 'text-warning' : '';
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`tnum ${strong ? 'font-semibold' : ''} ${color}`}>{value}</dd>
    </div>
  );
}
