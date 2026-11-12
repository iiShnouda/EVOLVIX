import { useDeferredValue, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  companyToday,
  formatDate,
  formatMoney,
  formatNumber,
  type Party,
  type StocktakeResult,
  type StocktakeSheetRow,
} from '@skb/shared';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { Pager } from '../components/Pager';
import { PartyPicker } from '../components/PartyPicker';
import { ReportActions } from '../components/ReportActions';
import { WarehouseSelect, useDefaultWarehouseId } from '../components/WarehouseSelect';
import { useT, joinList } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ApiError } from '../lib/api';
import { useWorkDraft } from '../lib/workDraft';
import { useAuth } from '../stores/auth';
import { useDeviceInfo } from '../lib/device';
import { useReportTools } from '../lib/report';
import {
  scanPhoto,
  useDepartments,
  usePageSize,
  useStocktake,
  useStocktakeSheet,
  useWarehouses,
} from '../lib/queries';
import { errorText } from '../lib/errors';
import { TableColumns } from '../components/TableColumns';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

interface Line {
  row: StocktakeSheetRow;
  qty: number;
  diff: number;
  value: number;
}

/** A row's own key: the item in its warehouse. */
const keyOf = (r: StocktakeSheetRow) => `${r.productId}:${r.warehouseId}`;

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
    const name = l.row.supplier || none;
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

/** What is kept of a count in progress. */
interface CountDraft {
  branchId: string;
  warehouseId: string | null;
  departmentId: string;
  supplier: Party | null;
  counted: Record<string, string>;
  reason: string;
}

/**
 * Stocktake (الجرد والتسويات) by branch, warehouse, department and factory, any of them together
 * (owner, 2026-11-10): print a count sheet, count by hand, then type the counts or upload a photo
 * of the sheet for the server to read. One warehouse, or every warehouse of a branch (or of all the
 * person's branches) at once. Each item's shortage or surplus shows with its value, and by supplier
 * (factory) with the total of all; nothing changes until whoever reviews it saves. Each difference
 * is then posted in its own warehouse as an adjustment at the current average cost, under one ADJ-
 * reference. Items left blank are not touched; only what the sheet shows is posted.
 */
export function StocktakePage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t, locale } = useT();
  const can = useCan();
  // What a count gains or loses at cost is the owner's unless given (costs:view).
  const seeCosts = can('costs:view');
  const canScan = can('ai:scan_stocktake');
  const navigate = useNavigate();
  const isPhone = useDeviceInfo().deviceClass === 'phone';
  const myBranches = useAuth((s) => s.user?.branches ?? []);
  const warehouses = useWarehouses(true);
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [supplier, setSupplier] = useState<Party | null>(null);
  const [search, setSearch] = useState('');
  const settled = useDeferredValue(search.trim());
  const defaultWarehouse = useDefaultWarehouseId();
  // null = not chosen yet (the working branch's default); '' = every warehouse in the branch.
  const [picked, setPicked] = useState<string | null>(null);
  const inBranch = (id: string) =>
    !branchId || (warehouses.data ?? []).some((w) => w.id === id && w.branchId === branchId);
  const warehouseId = picked ?? (inBranch(defaultWarehouse) ? defaultWarehouse : '');
  const warehouseName = (warehouses.data ?? []).find((w) => w.id === warehouseId)?.name ?? '';
  const branchName = myBranches.find((b) => b.id === branchId)?.name ?? '';
  const departments = (useDepartments().data ?? []).filter((d) => d.isActive);
  const departmentName = departments.find((d) => d.id === departmentId)?.name ?? '';
  const sheetQuery = useStocktakeSheet({
    branchId: branchId || undefined,
    warehouseId: warehouseId || undefined,
    departmentId: departmentId || undefined,
    supplierId: supplier?.id,
    search: settled || undefined,
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
  useWorkDraft<CountDraft>(
    2,
    () =>
      Object.values(counted).every((v) => v === '') && !reason.trim()
        ? null
        : { branchId, warehouseId: picked, departmentId, supplier, counted, reason },
    (d) => {
      if (typeof d.branchId === 'string') setBranchId(d.branchId);
      if (typeof d.warehouseId === 'string' || d.warehouseId === null) setPicked(d.warehouseId);
      if (typeof d.departmentId === 'string') setDepartmentId(d.departmentId);
      if (d.supplier && typeof d.supplier === 'object') setSupplier(d.supplier);
      if (d.counted && typeof d.counted === 'object') setCounted(d.counted);
      if (typeof d.reason === 'string') setReason(d.reason);
    },
  );

  const currency = sheetQuery.data?.currency ?? 'EGP';
  const rows = sheetQuery.data?.rows ?? [];
  // Several warehouses on one sheet: each row says where (owner, 2026-11-10).
  const several = new Set(rows.map((r) => r.warehouseId)).size > 1 || !warehouseId;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(page, pages);
  const shown = rows.slice((at - 1) * size, at * size);

  const lines: Line[] = rows
    .filter((r) => (counted[keyOf(r)] ?? '') !== '')
    .map((r) => {
      const qty = Math.max(0, Math.floor(Number(counted[keyOf(r)]) || 0));
      const diff = qty - r.quantity;
      return { row: r, qty, diff, value: diff * (r.avgCost ?? 0) };
    });
  const byKey = new Map(lines.map((l) => [keyOf(l.row), l]));
  const changed = lines.filter((l) => l.diff !== 0);
  const totals = bySupplier(changed, t('stocktake.noSupplier'));
  const grand = totals[totals.length - 1]!;
  const money = (v: number) => formatMoney(v, currency, locale);
  const n = (v: number) => formatNumber(v, locale);

  /** A filter changed: back to the first page (counts already typed stay with their rows). */
  const refilter = () => {
    setPage(1);
    setResult(null);
  };

  async function readSheet(file: File) {
    setReadNote(null);
    setReading(0);
    try {
      const read = await scanPhoto<{ code: string; counted: number }[]>(
        'stocktake',
        file,
        setReading,
      );
      // A code on several rows (the item in several warehouses) can't be told apart: left out.
      const byCode = new Map<string, StocktakeSheetRow | null>();
      for (const r of rows) byCode.set(norm(r.code), byCode.has(norm(r.code)) ? null : r);
      const next = { ...counted };
      const unknown: string[] = [];
      let matched = 0;
      for (const r of read) {
        const row = byCode.get(norm(r.code));
        if (!row) {
          unknown.push(r.code);
          continue;
        }
        next[keyOf(row)] = String(Math.max(0, Math.round(r.counted)));
        matched++;
      }
      setCounted(next);
      setReadNote({
        ok: matched > 0,
        text:
          t('stocktake.readDone').replace('{n}', n(matched)) +
          (unknown.length ? ` · ${t('stocktake.readUnknown')}: ${joinList(unknown)}` : ''),
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
        lines: changed.map((l) => ({
          productId: l.row.productId,
          countedQuantity: l.qty,
          warehouseId: l.row.warehouseId,
        })),
        reason: reason.trim() || undefined,
        // The count's scope: the server adjusts nothing outside it.
        branchId: branchId || undefined,
        departmentId: departmentId || undefined,
        supplierId: supplier?.id,
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

  const subtitle = [
    branchName,
    warehouseName,
    departmentName,
    supplier?.name,
    formatDate(companyToday(), locale),
  ]
    .filter(Boolean)
    .join(' · ');

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
            {t('stocktake.changedItems')}: {n(result.res.itemsChanged)}
            {seeCosts && ` · ${t('stocktake.valueImpact')} ${money(result.res.valueChange)}`}
          </p>
          <SupplierTable totals={result.totals} money={money} seeCosts={seeCosts} />
        </Card>
      )}

      <Card className="space-y-3">
        {/* Branch, warehouse, department and factory, side by side (owner, 2026-11-10). */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {myBranches.length > 1 && (
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('list.branch')}</span>
              <select
                className={field}
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setPicked(null);
                  refilter();
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
            allowAll
            onChange={(id) => {
              setPicked(id);
              refilter();
            }}
          />
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('valuation.department')}</span>
            <select
              className={field}
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                refilter();
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
          <PartyPicker
            type="SUPPLIER"
            withCode
            value={supplier}
            onChange={(p) => {
              setSupplier(p);
              refilter();
            }}
            label={t('inventory.supplier')}
            placeholder={t('common.all')}
          />
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
          {supplier && (
            <Button size="sm" variant="ghost" icon="close" onClick={() => setSupplier(null)}>
              {t('common.clear')}
            </Button>
          )}
          <ReportActions
            disabled={rows.length === 0}
            onPrint={() => report.print(sheet.current, t('stocktake.sheet'), subtitle)}
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
                disabled={rows.length === 0 || reading !== null}
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
        {sheetQuery.data?.truncated && (
          <p className="rounded-[var(--radius-app)] bg-warning-soft p-2 text-sm text-warning">
            {t('stocktake.truncated')}
          </p>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <Card padded={false} className="min-w-0 overflow-hidden">
          {sheetQuery.isLoading ? (
            <div className="grid place-items-center py-16 text-muted">
              <Spinner size={26} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title={t('common.empty')} icon="inventory" />
          ) : (
            <>
              <div className="flex justify-end border-b border-line p-2">
                <Pager
                  page={at}
                  size={size}
                  pages={pages}
                  onPage={setPage}
                  onSize={(x) => {
                    setSize(x);
                    setPage(1);
                  }}
                />
              </div>
              {/* The item's code and its name each in a column of its own (owner, 2026-11-10). */}
              <TableColumns id={isPhone ? 'stocktake.count.phone' : 'stocktake.count'}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-2 text-xs text-muted">
                      <tr>
                        <th className="p-2 text-start font-medium">{t('inventory.sku')}</th>
                        <th className="p-2 text-start font-medium">{t('inventory.itemName')}</th>
                        {!isPhone && (
                          <>
                            <th className="p-2 text-start font-medium">
                              {t('inventory.supplier')}
                            </th>
                            <th className="p-2 text-start font-medium">
                              {t('valuation.department')}
                            </th>
                            {several && (
                              <th className="p-2 text-start font-medium">
                                {t('inventory.places')}
                              </th>
                            )}
                            <th className="p-2 text-start font-medium">{t('stocktake.unit')}</th>
                          </>
                        )}
                        <th className="p-2 text-end font-medium">{t('stocktake.system')}</th>
                        <th className="p-2 text-start font-medium">{t('stocktake.counted')}</th>
                        {!isPhone && (
                          <th className="p-2 text-end font-medium">{t('stocktake.difference')}</th>
                        )}
                        {!isPhone && seeCosts && (
                          <th className="p-2 text-end font-medium">{t('inventory.value')}</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--c-line)]">
                      {shown.map((r) => {
                        const k = keyOf(r);
                        const line = byKey.get(k);
                        const tone = !line?.diff
                          ? 'text-muted'
                          : line.diff > 0
                            ? 'text-positive'
                            : 'text-destructive';
                        return (
                          <tr key={k}>
                            <td className="whitespace-nowrap p-2 text-muted tnum" dir="ltr">
                              {r.code}
                            </td>
                            <td className="p-2 font-medium">
                              {r.name}
                              {isPhone && several && (
                                <span className="block text-xs font-normal text-muted">
                                  {r.branch} / {r.warehouse}
                                </span>
                              )}
                            </td>
                            {!isPhone && (
                              <>
                                <td className="p-2 text-muted">{r.supplier ?? ''}</td>
                                <td className="p-2 text-muted">{r.department ?? ''}</td>
                                {several && (
                                  <td className="whitespace-nowrap p-2 text-xs text-muted">
                                    {r.branch} / {r.warehouse}
                                  </td>
                                )}
                                <td className="p-2 text-muted">{r.unit}</td>
                              </>
                            )}
                            <td className="whitespace-nowrap p-2 text-end tnum">{n(r.quantity)}</td>
                            <td className="p-2">
                              <input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                aria-label={`${t('stocktake.counted')} ${r.name}`}
                                className={`${field} !w-20 tnum`}
                                value={counted[k] ?? ''}
                                onChange={(e) =>
                                  setCounted((prev) => ({ ...prev, [k]: e.target.value }))
                                }
                              />
                              {isPhone && line && line.diff !== 0 && (
                                <span className={`block text-xs tnum ${tone}`}>
                                  {line.diff > 0 ? '+' : '−'}
                                  {n(Math.abs(line.diff))}
                                </span>
                              )}
                            </td>
                            {!isPhone && (
                              <td className={`whitespace-nowrap p-2 text-end tnum ${tone}`}>
                                {line && line.diff !== 0
                                  ? `${line.diff > 0 ? '+' : '−'}${n(Math.abs(line.diff))}`
                                  : ''}
                              </td>
                            )}
                            {!isPhone && seeCosts && (
                              <td className={`whitespace-nowrap p-2 text-end tnum ${tone}`}>
                                {line && line.diff !== 0 ? money(line.value) : ''}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </TableColumns>
            </>
          )}
        </Card>

        <div className="space-y-4 xl:sticky xl:top-20 xl:h-fit">
          <Card>
            <dl className="space-y-1.5 text-sm">
              <Row label={t('stocktake.changedItems')} value={n(changed.length)} />
              <Row
                label={t('stocktake.short')}
                value={n(grand.shortQty) + (seeCosts ? ` · ${money(grand.shortValue)}` : '')}
                tone="warning"
              />
              <Row
                label={t('stocktake.over')}
                value={n(grand.overQty) + (seeCosts ? ` · ${money(grand.overValue)}` : '')}
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
            {can('inventory:stocktake') && (
              <Button
                className="mt-4 w-full"
                icon="check"
                loading={stocktake.isPending}
                disabled={changed.length === 0}
                onClick={post}
              >
                {stocktake.isPending ? t('stocktake.saving') : t('stocktake.save')}
              </Button>
            )}
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
                  <li key={keyOf(l.row)} className="flex items-center gap-2 px-3 py-2">
                    <span className="shrink-0 text-xs text-muted tnum" dir="ltr">
                      {l.row.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {l.row.name}
                      {several && (
                        <span className="block truncate text-xs text-muted">{l.row.warehouse}</span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 tnum ${l.diff > 0 ? 'text-positive' : 'text-destructive'}`}
                    >
                      {l.diff > 0 ? '+' : '−'}
                      {n(Math.abs(l.diff))}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-faint hover:text-destructive"
                      aria-label={t('invoice.remove')}
                      title={t('invoice.remove')}
                      onClick={() => setCounted((prev) => ({ ...prev, [keyOf(l.row)]: '' }))}
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
                <th className="p-2 text-start">{t('inventory.supplier')}</th>
                {several && <th className="p-2 text-start">{t('inventory.places')}</th>}
                <th className="p-2 text-start">{t('stocktake.unit')}</th>
                <th className="w-32 p-2 text-start">{t('stocktake.counted')}</th>
                <th className="w-40 p-2 text-start">{t('stocktake.note')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={keyOf(r)}>
                  <td className="p-2 tnum">{i + 1}</td>
                  <td className="p-2 font-semibold tnum" dir="ltr">
                    {r.code}
                  </td>
                  <td className="p-2">{r.name}</td>
                  <td className="p-2">{r.supplier ?? ''}</td>
                  {several && (
                    <td className="p-2">
                      {r.branch} / {r.warehouse}
                    </td>
                  )}
                  <td className="p-2">{r.unit}</td>
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
      <TableColumns id="stocktake.totals">
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
      </TableColumns>
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
