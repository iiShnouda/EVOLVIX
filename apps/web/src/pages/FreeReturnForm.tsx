import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, toMinor, type Party, type Product } from '@skb/shared';
import { Button, Card, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { PartyPicker } from '../components/PartyPicker';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { useAuth } from '../stores/auth';
import { useWorkDraft } from '../lib/workDraft';
import {
  useCompanySettings,
  useCreateFreeReturn,
  useDepartments,
  useLastPrices,
  useProductSearch,
  useWarehouses,
  type DocScope,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:bg-surface-2';

/** One typed line: an item, its unit, how many, and (when allowed) a price and discount. */
interface FreeLine {
  key: string;
  productId: string;
  name: string;
  sku: string;
  units: { unitId: string; name: string; factor: number; price: number }[];
  unitId: string;
  qty: string;
  /** Typed price of one unit; '' = the party's last price. */
  price: string;
  discount: string;
}

/** A return being typed, as kept through an app update. */
interface FreeDraft {
  party: Party | null;
  branch: string;
  warehouse: string;
  department: string;
  lines: FreeLine[];
  notes: string;
}

/**
 * A return typed line by line like a sales invoice, without picking an invoice (owner decision
 * 2026-10-01). It goes on the party's account (a cash customer is paid back from the cash box), at
 * the party's last invoice price; another price needs the change-price permission. Purchase returns
 * go back at the net price, so the supplier's discount returns with the goods.
 */
export function FreeReturnForm({
  scope,
  initialParty,
}: {
  scope: DocScope;
  initialParty: Party | null;
}) {
  const isSale = scope === 'sales';
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const settings = useCompanySettings();
  const canChangePrice = can(isSale ? 'sales:change_price' : 'purchases:change_price');
  const canDiscount = can(isSale ? 'sales:discount' : 'purchases:discount');
  const currency = settings.data?.currency ?? 'EGP';

  // Branch, then warehouse, then department, as on the invoice.
  const myBranches = me?.branches ?? [];
  const [branch, setBranch] = useState(myBranches.length === 1 ? (myBranches[0]?.id ?? '') : '');
  const [warehouse, setWarehouse] = useState('');
  const [department, setDepartment] = useState('');
  const allWarehouses = useWarehouses(true);
  const branchWarehouses = (allWarehouses.data ?? []).filter(
    (w) => w.kind === 'STORE' && w.isActive && w.branchId === branch,
  );
  const warehouseId = branchWarehouses.some((w) => w.id === warehouse) ? warehouse : '';
  const departmentList = useDepartments();
  const myDepartments = me?.departmentIds ?? null;
  const onWarehouse = branchWarehouses.find((w) => w.id === warehouseId)?.departmentIds;
  const departments = (departmentList.data ?? []).filter(
    (d) =>
      d.isActive &&
      (!myDepartments || myDepartments.includes(d.id)) &&
      (!onWarehouse?.length || onWarehouse.includes(d.id)),
  );
  const departmentId = departments.some((d) => d.id === department) ? department : '';
  const departmentRequired =
    isSale && departments.length > 0 && settings.data?.requireDepartment !== false;

  const [party, setParty] = useState<Party | null>(initialParty);
  const partyId = party?.id ?? '';
  const [lines, setLines] = useState<FreeLine[]>([]);
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const found = useProductSearch(search.trim(), false, '', departmentId);
  const last = useLastPrices(
    scope,
    partyId,
    lines.map((l) => l.productId),
  );
  const create = useCreateFreeReturn(scope);

  const work = useWorkDraft<FreeDraft>(
    1,
    () =>
      lines.length === 0 && !notes ? null : { party, branch, warehouse, department, lines, notes },
    (d) => {
      if (d.party && typeof d.party.id === 'string') setParty(d.party);
      if (typeof d.branch === 'string') setBranch(d.branch);
      if (typeof d.warehouse === 'string') setWarehouse(d.warehouse);
      if (typeof d.department === 'string') setDepartment(d.department);
      if (Array.isArray(d.lines))
        setLines(
          d.lines.filter((l) => l && typeof l.productId === 'string' && Array.isArray(l.units)),
        );
      if (typeof d.notes === 'string') setNotes(d.notes);
    },
  );

  function add(p: Product) {
    const units = p.units.map((u) => ({
      unitId: u.unitId,
      name: u.name,
      factor: u.factor,
      price: u.prices[0]?.price ?? (isSale ? p.salePrice : p.costPrice) * u.factor,
    }));
    setLines((prev) => [
      ...prev,
      {
        key: `${p.id}-${Date.now()}`,
        productId: p.id,
        name: p.name,
        sku: p.sku,
        units,
        unitId: units[0]?.unitId ?? '',
        qty: '1',
        price: '',
        discount: '',
      },
    ]);
    setSearch('');
  }
  const update = (key: string, patch: Partial<FreeLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  /** The line's price of one unit: what was typed (when allowed), else the party's last price. */
  function priceOf(l: FreeLine): number | null {
    const lastPrice = last.data?.get(`${l.productId}:${l.unitId}`);
    if (canChangePrice && l.price !== '') return toMinor(Number(l.price) || 0);
    if (lastPrice != null) return lastPrice;
    return canChangePrice ? (l.units.find((u) => u.unitId === l.unitId)?.price ?? 0) : null;
  }
  const rows = lines.map((l) => {
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
    const price = priceOf(l);
    const discount = canDiscount ? Math.max(0, toMinor(Number(l.discount) || 0)) : 0;
    const total = price == null ? 0 : Math.max(0, qty * price - discount);
    return { l, qty, price, discount, total };
  });
  const total = rows.reduce((s, r) => s + r.total, 0);
  const ready =
    !!party &&
    !!branch &&
    !!warehouseId &&
    (!departmentRequired || !!departmentId) &&
    rows.length > 0 &&
    rows.every((r) => r.qty > 0 && r.price != null && r.discount <= r.qty * (r.price ?? 0));

  async function save() {
    if (!party) return;
    try {
      await create.mutateAsync({
        partyId: party.id,
        branchId: branch,
        warehouseId,
        departmentId: departmentId || undefined,
        lines: rows.map((r) => ({
          productId: r.l.productId,
          unitId: r.l.unitId || undefined,
          quantity: r.qty,
          unitPrice: r.price ?? 0,
          discount: r.discount,
        })),
        notes: notes.trim() || undefined,
      });
      work.finished();
      navigate(`/${scope}?tab=returns`);
    } catch {
      /* shown below */
    }
  }

  const results = search.trim() ? (found.data ?? []).slice(0, 8) : [];

  return (
    <div className="space-y-4 pb-24">
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2">
          <PartyPicker
            type={isSale ? 'CUSTOMER' : 'SUPPLIER'}
            withCode
            value={party}
            onChange={(p) => {
              setParty(p);
            }}
            label={t(isSale ? 'invoice.customer' : 'invoice.supplier')}
            placeholder={t(isSale ? 'invoice.selectCustomer' : 'invoice.selectSupplier')}
          />
        </div>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('list.branch')}</span>
          <select
            className={`${field} ${!branch ? 'border-warning' : ''}`}
            value={branch}
            onChange={(e) => {
              setBranch(e.target.value);
              setWarehouse('');
              setDepartment('');
            }}
          >
            <option value="" disabled>
              {t('invoice.chooseBranch')}
            </option>
            {myBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('list.warehouse')}</span>
          <select
            className={`${field} ${branch && !warehouseId ? 'border-warning' : ''}`}
            value={warehouseId}
            disabled={!branch}
            onChange={(e) => {
              setWarehouse(e.target.value);
              setDepartment('');
            }}
          >
            <option value="" disabled>
              {t('invoice.chooseWarehouse')}
            </option>
            {branchWarehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        {departments.length > 0 && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('invoice.department')}</span>
            <select
              className={`${field} ${departmentRequired && warehouseId && !departmentId ? 'border-warning' : ''}`}
              value={departmentId}
              disabled={!warehouseId}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="" disabled={departmentRequired}>
                {departmentRequired ? t('invoice.chooseDepartment') : t('invoice.noDepartment')}
              </option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="relative">
          <span className="flex h-10 items-center gap-2 rounded-[var(--radius-app)] border border-line bg-surface px-3 focus-within:border-brand">
            <Icon name="search" size={16} className="shrink-0 text-muted" />
            <input
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
              placeholder={t('invoice.searchProduct')}
              value={search}
              disabled={!warehouseId || !party}
              onChange={(e) => setSearch(e.target.value)}
            />
            {found.isFetching && search.trim() && <Spinner size={14} />}
          </span>
          {results.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-[var(--radius-app)] border border-line bg-surface shadow-lg">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2"
                    onClick={() => add(p)}
                  >
                    <span className="min-w-0 truncate font-medium">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted tnum">{p.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="rounded-[var(--radius-app)] bg-surface-2 p-4 text-center text-sm text-muted">
            {t('return.noItems')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-app)] border border-line">
            <table className="w-full text-[13px]">
              <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                <tr className="whitespace-nowrap">
                  <th className="px-1.5 py-2 text-start font-medium">#</th>
                  <th className="px-1.5 py-2 text-start font-medium">{t('invoice.item')}</th>
                  <th className="px-1.5 py-2 text-start font-medium">{t('invoice.unit')}</th>
                  <th className="px-1.5 py-2 text-start font-medium">{t('invoice.qty')}</th>
                  <th className="px-1.5 py-2 text-start font-medium">
                    {isSale ? t('invoice.price') : t('invoice.receiveCost')}
                  </th>
                  {canDiscount && (
                    <th className="px-1.5 py-2 text-start font-medium">{t('invoice.discount')}</th>
                  )}
                  <th className="px-1.5 py-2 text-end font-medium">{t('invoice.lineTotal')}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {rows.map((r, i) => {
                  const lastPrice = last.data?.get(`${r.l.productId}:${r.l.unitId}`);
                  return (
                    <tr key={r.l.key}>
                      <td className="px-1.5 py-2 text-muted tnum">{i + 1}</td>
                      <td className="min-w-40 px-1.5 py-2">
                        <span className="block font-medium">{r.l.name}</span>
                        <span className="block text-xs text-muted tnum">{r.l.sku}</span>
                      </td>
                      <td className="px-1.5 py-1.5">
                        <select
                          className={`${field} h-8 w-28`}
                          value={r.l.unitId}
                          onChange={(e) => update(r.l.key, { unitId: e.target.value, price: '' })}
                        >
                          {r.l.units.map((u) => (
                            <option key={u.unitId} value={u.unitId}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1.5 py-1.5">
                        <input
                          type="number"
                          min={1}
                          className={`${field} h-8 w-20 tnum`}
                          value={r.l.qty}
                          onChange={(e) => update(r.l.key, { qty: e.target.value })}
                        />
                      </td>
                      <td className="px-1.5 py-1.5">
                        {canChangePrice ? (
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={`${field} h-8 w-28 tnum`}
                            placeholder={r.price != null ? String(r.price / 100) : ''}
                            value={r.l.price}
                            onChange={(e) => update(r.l.key, { price: e.target.value })}
                          />
                        ) : r.price != null ? (
                          <span className="tnum">{formatMoney(r.price, currency, locale)}</span>
                        ) : (
                          <span className="text-xs text-destructive">
                            {t('return.noLastPrice')}
                          </span>
                        )}
                        {lastPrice != null && canChangePrice && (
                          <span className="block text-[11px] text-muted tnum">
                            {t('return.lastPrice')}: {formatMoney(lastPrice, currency, locale)}
                          </span>
                        )}
                      </td>
                      {canDiscount && (
                        <td className="px-1.5 py-1.5">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={`${field} h-8 w-24 tnum`}
                            value={r.l.discount}
                            onChange={(e) => update(r.l.key, { discount: e.target.value })}
                          />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-1.5 py-2 text-end font-semibold tnum">
                        {formatMoney(r.total, currency, locale)}
                      </td>
                      <td className="px-1 py-1.5">
                        <button
                          type="button"
                          className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-destructive-soft hover:text-destructive"
                          aria-label={t('invoice.remove')}
                          title={t('invoice.remove')}
                          onClick={() => setLines((prev) => prev.filter((x) => x.key !== r.l.key))}
                        >
                          <Icon name="close" size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('invoice.notes')}</span>
          <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </Card>

      <ReturnBar
        total={formatMoney(total, currency, locale)}
        note={t(isSale ? 'return.onAccountNote' : 'return.supplierOnAccountNote')}
        error={errorText(t, create.error)}
        saving={create.isPending}
        disabled={!ready || create.isPending}
        onSave={save}
      />
    </div>
  );
}

/** The return's total and Save, kept at the bottom of the screen (the side column is gone). */
export function ReturnBar({
  total,
  note,
  error,
  saving,
  disabled,
  onSave,
  extra,
}: {
  total: string;
  note?: string;
  error?: string | null;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
  extra?: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="sticky bottom-0 z-10 -mx-1 rounded-t-2xl border border-line bg-surface/95 px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(15,23,42,.35)] backdrop-blur pb-safe">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-muted">{t('invoice.grandTotal')}</span>
          <span className="text-xl font-bold tnum">{total}</span>
        </div>
        {extra}
        {note && <p className="min-w-0 flex-1 text-xs text-muted">{note}</p>}
        <Button
          className="ms-auto"
          icon="check"
          loading={saving}
          disabled={disabled}
          onClick={onSave}
        >
          {saving ? t('return.saving') : t('return.save')}
        </Button>
      </div>
      {error && (
        <p className="mt-2 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
