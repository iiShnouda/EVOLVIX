import { confirm } from '../lib/confirm';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  companyToday,
  formatMoney,
  formatNumber,
  toMajor,
  toMinor,
  type Party,
  type PriceList,
  type PriceListItem,
  type PriceListParty,
  type Product,
  type QuantityBreak,
} from '@skb/shared';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';
import { PartyPicker } from '../components/PartyPicker';
import { ItemFinderSheet } from '../components/ItemFinderSheet';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import {
  useCompanySettings,
  useDeletePriceList,
  useDepartments,
  useGroups,
  usePriceLevels,
  usePriceList,
  usePriceLists,
  useProductSearch,
  useQuantityBreaks,
  useSavePriceList,
  useSetPriceListItems,
  useSetPriceListParties,
  useSetQuantityBreaks,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:opacity-60';

type Tab = 'lists' | 'breaks';

/**
 * Price lists (special prices for chosen items — or a percent off a department's items — for the
 * customers given them or for everyone while they run, optionally only from an invoice amount) and
 * quantity discounts (a percent off from a quantity or an amount) — DOMAIN.md §2.2. Customers only
 * (owner, 2026-10-21). Anyone who sees stock can look; changing them needs price_lists:manage.
 * Invoices use them on their own.
 */
export function PriceListsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Its own key (the inventory page's tabs use `tab`).
  const tab: Tab = params.get('pl') === 'breaks' ? 'breaks' : 'lists';

  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader
          title={t('pl.title')}
          action={
            <Button variant="ghost" size="sm" icon="close" onClick={() => navigate('/inventory')}>
              {t('itemCard.back')}
            </Button>
          }
        />
      )}
      <div
        role="tablist"
        className="flex max-w-full flex-wrap gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1"
      >
        {(['lists', 'breaks'] as const).map((x) => (
          <button
            key={x}
            role="tab"
            aria-selected={tab === x}
            onClick={() => {
              const q = new URLSearchParams(params);
              if (x === 'lists') q.delete('pl');
              else q.set('pl', x);
              setParams(q, { replace: true });
            }}
            className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
              tab === x ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
            }`}
          >
            {t(x === 'lists' ? 'pl.lists' : 'pl.breaks')}
          </button>
        ))}
      </div>
      {tab === 'lists' ? <ListsTab /> : <BreaksTab />}
    </div>
  );
}

// ------------------------------------------------------------------ lists

function ListsTab() {
  const { t, locale } = useT();
  const can = useCan();
  const lists = usePriceLists();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const canManage = can('price_lists:manage');

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="min-w-0 space-y-3">
        {canManage &&
          (adding ? (
            <ListSettings
              onDone={(id) => {
                setAdding(false);
                if (id) setSelected(id);
              }}
            />
          ) : (
            <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
              {t('pl.new')}
            </Button>
          ))}
        <Card padded={false} className="overflow-hidden">
          {lists.isLoading ? (
            <div className="grid place-items-center py-12 text-muted">
              <Spinner size={24} />
            </div>
          ) : (lists.data ?? []).length === 0 ? (
            <EmptyState title={t('pl.empty')} icon="inventory" />
          ) : (
            <ul className="divide-y divide-[var(--c-line)]">
              {(lists.data ?? []).map((l) => (
                <li key={l.id}>
                  <button
                    onClick={() => setSelected(l.id)}
                    className={`flex w-full flex-col gap-1 p-3 text-start hover:bg-surface-2 ${
                      selected === l.id ? 'bg-brand-soft' : ''
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <bdi className="font-medium">{l.name}</bdi>
                      {l.side === 'PURCHASE' && <Badge tone="brand">{t('pl.sidePurchase')}</Badge>}
                      {l.percentBp > 0 && (
                        <Badge tone="info">
                          <span className="tnum">{formatNumber(l.percentBp / 100, locale)}%</span>
                        </Badge>
                      )}
                      {l.forEveryone && <Badge tone="info">{t('pl.forEveryone')}</Badge>}
                      <Badge tone={l.current ? 'positive' : 'neutral'}>
                        {t(!l.isActive ? 'pl.closed' : l.current ? 'pl.current' : 'pl.notCurrent')}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted">
                      {t('pl.itemsCount')} {formatNumber(l.items, locale)}
                      {!l.forEveryone &&
                        ` · ${t('pl.partiesCount')} ${formatNumber(l.parties, locale)}`}
                      {(l.validFrom || l.validTo) &&
                        ` · ${l.validFrom ?? '…'} → ${l.validTo ?? t('pl.openEnded')}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="min-w-0">
        {selected ? (
          <ListEditor key={selected} id={selected} onGone={() => setSelected(null)} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * A new list, or a list's settings: name, first and last day, who gets it, which department or
 * sub-group, a percent off, and the invoice amount it starts from (owner, 2026-10-21).
 */
function ListSettings({ list, onDone }: { list?: PriceList; onDone: (id?: string) => void }) {
  const { t } = useT();
  const can = useCan();
  const save = useSavePriceList();
  const departments = useDepartments();
  const groups = useGroups();
  const [f, setF] = useState({
    name: list?.name ?? '',
    forEveryone: list?.forEveryone ?? false,
    validFrom: list ? (list.validFrom ?? '') : companyToday(),
    validTo: list?.validTo ?? '',
    isActive: list?.isActive ?? true,
    notes: list?.notes ?? '',
    departmentId: list?.departmentId ?? '',
    groupId: list?.groupId ?? '',
    percent: list?.percentBp ? String(list.percentBp / 100) : '',
    minAmount: list?.minAmount ? String(toMajor(list.minAmount)) : '',
  });
  const disabled = !can('price_lists:manage');
  const deptGroups = (groups.data ?? []).filter(
    (g) => g.departmentId === f.departmentId && g.isActive,
  );
  const badNumber =
    (f.percent.trim() !== '' && !(Number(f.percent) >= 0 && Number(f.percent) <= 90)) ||
    (f.minAmount.trim() !== '' && !(Number(f.minAmount) >= 0));

  async function submit() {
    try {
      const saved = await save.mutateAsync({
        id: list?.id,
        input: {
          name: f.name,
          ...(list ? {} : { side: 'SALE' as const }),
          forEveryone: f.forEveryone,
          validFrom: f.validFrom,
          validTo: f.validTo,
          isActive: f.isActive,
          notes: f.notes,
          departmentId: f.departmentId,
          groupId: f.departmentId ? f.groupId : '',
          percent: Number(f.percent || 0),
          minAmount: toMinor(Number(f.minAmount || 0)),
        },
      });
      onDone(saved.list.id);
    } catch {
      /* shown below */
    }
  }

  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-0.5 block text-xs text-muted">{t('pl.name')}</span>
          <input
            className={field}
            dir="auto"
            disabled={disabled}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('pl.startDate')}</span>
          <input
            type="date"
            className={`${field} tnum`}
            disabled={disabled}
            value={f.validFrom}
            onChange={(e) => setF({ ...f, validFrom: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('pl.endDate')}</span>
          <input
            type="date"
            className={`${field} tnum`}
            disabled={disabled}
            value={f.validTo}
            min={f.validFrom || undefined}
            onChange={(e) => setF({ ...f, validTo: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('pl.customers')}</span>
          <select
            className={field}
            disabled={disabled}
            value={f.forEveryone ? '1' : ''}
            onChange={(e) => setF({ ...f, forEveryone: e.target.value === '1' })}
          >
            <option value="">{t('pl.forGiven')}</option>
            <option value="1">{t('pl.forEveryone')}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('pl.department')}</span>
          <select
            className={field}
            disabled={disabled}
            value={f.departmentId}
            onChange={(e) => setF({ ...f, departmentId: e.target.value, groupId: '' })}
          >
            <option value="">{t('common.all')}</option>
            {(departments.data ?? [])
              .filter((d) => d.isActive || d.id === f.departmentId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
        {f.departmentId && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('pl.group')}</span>
            <select
              className={field}
              disabled={disabled}
              value={f.groupId}
              onChange={(e) => setF({ ...f, groupId: e.target.value })}
            >
              <option value="">{t('common.all')}</option>
              {deptGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('pl.listPercent')}</span>
          <input
            className={`${field} tnum`}
            inputMode="decimal"
            disabled={disabled}
            value={f.percent}
            placeholder="0"
            onChange={(e) => setF({ ...f, percent: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('pl.minAmount')}</span>
          <input
            className={`${field} tnum`}
            inputMode="decimal"
            disabled={disabled}
            value={f.minAmount}
            placeholder="0"
            onChange={(e) => setF({ ...f, minAmount: e.target.value })}
          />
        </label>
        {list && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              disabled={disabled}
              checked={!f.isActive}
              onChange={(e) => setF({ ...f, isActive: !e.target.checked })}
            />
            {t('pl.closed')}
          </label>
        )}
      </div>
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon="check"
            loading={save.isPending}
            disabled={!f.name.trim() || badNumber}
            onClick={submit}
          >
            {t('common.save')}
          </Button>
          {!list && (
            <Button size="sm" variant="ghost" onClick={() => onDone()}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      )}
      {save.error && <p className="text-xs text-destructive">{errorText(t, save.error)}</p>}
    </Card>
  );
}

/** The customers a list is given to: picked by code or name, each removable. */
function ListCustomers({ id, parties }: { id: string; parties: PriceListParty[] }) {
  const { t } = useT();
  const canManage = useCan()('price_lists:manage');
  const save = useSetPriceListParties();
  const [chosen, setChosen] = useState<PriceListParty[]>(parties);
  const [picker, setPicker] = useState<Party | null>(null);
  const dirty =
    JSON.stringify(chosen.map((p) => p.id).sort()) !==
    JSON.stringify(parties.map((p) => p.id).sort());

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {t('pl.customers')}
      </h2>
      {canManage && (
        <PartyPicker
          type="CUSTOMER"
          withCode
          value={picker}
          label={t('pl.addCustomer')}
          placeholder={t('pl.addCustomer')}
          onChange={(p) => {
            if (p && !chosen.some((c) => c.id === p.id))
              setChosen([...chosen, { id: p.id, name: p.name, code: String(p.code) }]);
            setPicker(null);
          }}
        />
      )}
      {chosen.length === 0 ? (
        <p className="text-sm text-muted">{t('pl.noCustomers')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {chosen.map((p) => (
            <li
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 ps-3 pe-1 text-sm"
            >
              {p.code && <span className="text-xs text-muted tnum">{p.code}</span>}
              <bdi>{p.name}</bdi>
              {canManage && (
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-surface hover:text-destructive"
                  onClick={() => setChosen(chosen.filter((c) => c.id !== p.id))}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <Button
          size="sm"
          icon="check"
          loading={save.isPending}
          disabled={!dirty}
          onClick={() => save.mutate({ id, partyIds: chosen.map((p) => p.id) })}
        >
          {t('pl.saveCustomers')}
        </Button>
      )}
      {save.error && <p className="text-xs text-destructive">{errorText(t, save.error)}</p>}
    </Card>
  );
}

type Row = {
  key: string;
  productId?: string | null;
  modelId?: string | null;
  name: string;
  sku: string;
  unitId: string;
  unitName: string;
  factor: number;
  price: string;
  levelPrice?: number | null;
};

const rowOf = (i: PriceListItem): Row => ({
  key: `${i.productId ?? i.modelId}:${i.unitId}`,
  productId: i.productId,
  modelId: i.modelId,
  name: i.name,
  sku: i.sku,
  unitId: i.unitId,
  unitName: i.unitName,
  factor: i.factor,
  price: String(toMajor(i.price)),
  levelPrice: i.levelPrice,
});

function ListEditor({ id, onGone }: { id: string; onGone: () => void }) {
  const { t, locale } = useT();
  const can = useCan();
  const detail = usePriceList(id);
  const saveItems = useSetPriceListItems();
  const remove = useDeletePriceList();
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  const levels = usePriceLevels();
  const canManage = can('price_lists:manage');
  const [rows, setRows] = useState<Row[]>([]);
  const [wholeModel, setWholeModel] = useState(false);
  useEffect(() => {
    if (detail.data) setRows(detail.data.items.map(rowOf));
  }, [detail.data]);

  if (detail.isLoading || !detail.data)
    return (
      <div className="grid place-items-center py-12 text-muted">
        <Spinner size={24} />
      </div>
    );
  const list = detail.data.list;
  const saved = detail.data.items.map(rowOf);
  const dirty =
    JSON.stringify(rows.map((r) => [r.key, r.price])) !==
    JSON.stringify(saved.map((r) => [r.key, r.price]));
  const bad = rows.some((r) => r.price.trim() === '' || !(Number(r.price) >= 0));

  function add(p: Product, unitId: string) {
    const unit = p.units.find((u) => u.unitId === unitId) ?? p.units[0];
    if (!unit) return;
    const target = wholeModel && p.modelId ? { modelId: p.modelId } : { productId: p.id };
    const key = `${target.modelId ?? target.productId}:${unit.unitId}`;
    if (rows.some((r) => r.key === key)) return;
    const defaultLevel = (levels.data ?? []).find((l) => l.side === list.side && l.isDefault);
    const level = unit.prices.find((x) => x.priceLevelId === defaultLevel?.id)?.price ?? null;
    setRows([
      ...rows,
      {
        key,
        ...target,
        name: wholeModel && p.modelId ? `${p.name.split(' — ')[0]} (${t('pl.model')})` : p.name,
        sku: p.sku,
        unitId: unit.unitId,
        unitName: unit.name,
        factor: unit.factor,
        price: level == null ? '' : String(toMajor(level)),
        levelPrice: level,
      },
    ]);
  }

  return (
    <div className="space-y-4">
      <ListSettings
        key={[
          list.id,
          list.name,
          list.validFrom,
          list.validTo,
          list.isActive,
          list.forEveryone,
          list.departmentId,
          list.groupId,
          list.percentBp,
          list.minAmount,
        ].join(':')}
        list={list}
        onDone={() => undefined}
      />
      {list.side === 'SALE' && !list.forEveryone && (
        <ListCustomers
          key={(detail.data.parties ?? []).map((p) => p.id).join()}
          id={list.id}
          parties={detail.data.parties ?? []}
        />
      )}
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t('pl.items')}
        </h2>
        {canManage && (
          <div className="space-y-2">
            <ItemPicker onPick={add} />
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={wholeModel}
                onChange={(e) => setWholeModel(e.target.checked)}
              />
              {t('pl.wholeModel')}
            </label>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{t('pl.noItems')}</p>
        ) : (
          <ul className="divide-y divide-[var(--c-line)]">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <bdi className="block truncate text-sm font-medium">{r.name}</bdi>
                  <span className="block truncate text-xs text-muted">
                    <bdi>{r.unitName}</bdi>
                    {r.factor > 1 ? ` × ${formatNumber(r.factor, locale)}` : ''}
                    {r.levelPrice != null &&
                      ` · ${t('pl.levelPrice')} ${formatMoney(r.levelPrice, currency, locale)}`}
                  </span>
                </span>
                <input
                  className={`${field} tnum !w-28`}
                  inputMode="decimal"
                  aria-label={t('pl.listPrice')}
                  disabled={!canManage}
                  value={r.price}
                  onChange={(e) =>
                    setRows(
                      rows.map((x) => (x.key === r.key ? { ...x, price: e.target.value } : x)),
                    )
                  }
                />
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="close"
                    aria-label={t('common.cancel')}
                    onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              icon="check"
              loading={saveItems.isPending}
              disabled={!dirty || bad}
              onClick={() =>
                saveItems.mutate({
                  id: list.id,
                  items: rows.map((r) => ({
                    productId: r.productId,
                    modelId: r.modelId,
                    unitId: r.unitId,
                    price: toMinor(Number(r.price)),
                  })),
                })
              }
            >
              {t('pl.savePrices')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={remove.isPending}
              onClick={async () => {
                if (!(await confirm({ message: t('pl.deleteConfirm'), danger: true }))) return;
                await remove.mutateAsync(list.id);
                onGone();
              }}
            >
              {t('pl.delete')}
            </Button>
          </div>
        )}
        {(saveItems.error || remove.error) && (
          <p className="text-xs text-destructive">
            {errorText(t, saveItems.error ?? remove.error)}
          </p>
        )}
      </Card>
    </div>
  );
}

/**
 * Pick an item (in one of its units) the way the invoice does (owner, 2026-10-21): its code in a
 * box of its own (Enter), a search by name, or the detailed search.
 */
function ItemPicker({ onPick }: { onPick: (p: Product, unitId: string) => void }) {
  const { t, locale } = useT();
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [code, setCode] = useState('');
  const [codeNote, setCodeNote] = useState('');
  const [finding, setFinding] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const found = useProductSearch(debounced);
  const results = debounced ? (found.data ?? []).slice(0, 10) : [];

  async function byCode() {
    const c = code.trim();
    if (!c) return;
    try {
      const list = await api.get<Product[]>(`/products?search=${encodeURIComponent(c)}`);
      const lower = c.toLowerCase();
      const p = list.find(
        (x) => x.sku.toLowerCase() === lower || (x.barcode ?? '').toLowerCase() === lower,
      );
      if (!p) {
        setCodeNote(`${c}: ${t('invoice.codeNotFound')}`);
        return;
      }
      const base = p.units.find((u) => u.factor === 1) ?? p.units[0];
      onPick(p, base?.unitId ?? '');
      setCode('');
    } catch {
      setCodeNote(`${c}: ${t('invoice.codeNotFound')}`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <label className="block w-28 shrink-0 sm:w-36">
          <span className="sr-only">{t('invoice.itemCode')}</span>
          <input
            className={`${field} tnum`}
            dir="ltr"
            placeholder={t('invoice.itemCode')}
            aria-label={t('invoice.itemCode')}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeNote('');
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              void byCode();
            }}
          />
          {codeNote && <span className="mt-1 block text-xs text-destructive">{codeNote}</span>}
        </label>
        <div className="relative min-w-0 flex-1 basis-48">
          <span className="pointer-events-none absolute inset-y-0 start-2.5 grid place-items-center text-faint">
            <Icon name="search" size={16} />
          </span>
          <input
            className={`${field} ps-8`}
            dir="auto"
            placeholder={t('pl.pickItem')}
            aria-label={t('pl.pickItem')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {debounced && (
            <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-card)]">
              {found.isLoading ? (
                <div className="grid place-items-center py-6 text-muted">
                  <Spinner size={18} />
                </div>
              ) : results.length === 0 ? (
                <p className="p-3 text-sm text-muted">{t('common.empty')}</p>
              ) : (
                results.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 last:border-0"
                  >
                    <span className="min-w-0 flex-1">
                      <bdi className="block truncate text-sm font-medium">{p.name}</bdi>
                      <span className="text-xs text-muted tnum">
                        {p.sku} · {formatMoney(p.salePrice, currency, locale)}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {p.units.map((u) => (
                        <Button
                          key={u.unitId}
                          size="sm"
                          variant="secondary"
                          icon="plus"
                          onClick={() => {
                            onPick(p, u.unitId);
                            setSearch('');
                          }}
                        >
                          <bdi>{u.name}</bdi>
                          {u.factor > 1 ? ` × ${formatNumber(u.factor, locale)}` : ''}
                        </Button>
                      ))}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <Button variant="secondary" icon="search" onClick={() => setFinding(true)}>
          {t('finder.button')}
        </Button>
      </div>
      {finding && (
        <ItemFinderSheet
          onClose={() => setFinding(false)}
          onAdd={(picks, close) => {
            for (const p of picks) onPick(p.product, p.unitId);
            if (close) setFinding(false);
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ quantity discounts

type Target = { productId?: string; modelId?: string; name: string; baseUnitName: string };

function BreaksTab() {
  const { t, locale } = useT();
  const can = useCan();
  const breaks = useQuantityBreaks();
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  const [target, setTarget] = useState<Target | null>(null);
  const [wholeModel, setWholeModel] = useState(false);
  const canManage = can('price_lists:manage');

  const groups = useMemo(() => {
    const m = new Map<string, { target: Target; steps: QuantityBreak[] }>();
    for (const b of breaks.data ?? []) {
      const key = b.productId ?? b.modelId ?? '';
      const g = m.get(key) ?? {
        target: {
          productId: b.productId ?? undefined,
          modelId: b.modelId ?? undefined,
          name: b.modelId ? `${b.name} (${t('pl.model')})` : b.name,
          baseUnitName: b.baseUnitName,
        },
        steps: [],
      };
      g.steps.push(b);
      m.set(key, g);
    }
    return [...m.values()];
  }, [breaks.data, t]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="min-w-0 space-y-3">
        {canManage && (
          <Card className="space-y-2">
            <ItemPicker
              onPick={(p) => {
                const base = p.units.find((u) => u.factor === 1) ?? p.units[0];
                setTarget(
                  wholeModel && p.modelId
                    ? {
                        modelId: p.modelId,
                        name: `${p.name.split(' — ')[0]} (${t('pl.model')})`,
                        baseUnitName: base?.name ?? '',
                      }
                    : { productId: p.id, name: p.name, baseUnitName: base?.name ?? '' },
                );
              }}
            />
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={wholeModel}
                onChange={(e) => setWholeModel(e.target.checked)}
              />
              {t('pl.wholeModel')}
            </label>
          </Card>
        )}
        <Card padded={false} className="overflow-hidden">
          {breaks.isLoading ? (
            <div className="grid place-items-center py-12 text-muted">
              <Spinner size={24} />
            </div>
          ) : groups.length === 0 ? (
            <EmptyState title={t('pl.noBreaks')} icon="inventory" />
          ) : (
            <ul className="divide-y divide-[var(--c-line)]">
              {groups.map((g) => (
                <li key={g.target.productId ?? g.target.modelId}>
                  <button
                    onClick={() => setTarget(g.target)}
                    className="flex w-full flex-col gap-0.5 p-3 text-start hover:bg-surface-2"
                  >
                    <bdi className="font-medium">{g.target.name}</bdi>
                    <span className="text-xs text-muted tnum">
                      {g.steps
                        .map(
                          (s) =>
                            `${
                              s.minAmount > 0
                                ? formatMoney(s.minAmount, currency, locale)
                                : formatNumber(s.minQuantity, locale)
                            }+ → ${formatNumber(s.percentBp / 100, locale)}%`,
                        )
                        .join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="min-w-0">
        {target && (
          <StepsEditor
            key={target.productId ?? target.modelId}
            target={target}
            steps={(breaks.data ?? []).filter(
              (b) =>
                (b.productId ?? undefined) === target.productId &&
                (b.modelId ?? undefined) === target.modelId,
            )}
          />
        )}
      </div>
    </div>
  );
}

/** An item's steps: all by quantity (in its base unit) or all by money at the selling price (owner, 2026-10-21). */
function StepsEditor({ target, steps }: { target: Target; steps: QuantityBreak[] }) {
  const { t } = useT();
  const can = useCan();
  const save = useSetQuantityBreaks();
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  const [byAmount, setByAmount] = useState(steps.some((s) => s.minAmount > 0));
  const initial = () =>
    steps.map((s) => ({
      min: String(s.minAmount > 0 ? toMajor(s.minAmount) : s.minQuantity),
      percent: String(s.percentBp / 100),
    }));
  const [rows, setRows] = useState(initial);
  const canManage = can('price_lists:manage');
  const bad = rows.some(
    (r) => !(Number(r.min) >= (byAmount ? 0.01 : 2)) || !(Number(r.percent) > 0),
  );

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">
        <bdi>{target.name}</bdi>
      </h2>
      <label className="block w-56">
        <span className="mb-0.5 block text-xs text-muted">{t('pl.breakBasis')}</span>
        <select
          className={field}
          disabled={!canManage}
          value={byAmount ? 'amount' : 'qty'}
          onChange={(e) => setByAmount(e.target.value === 'amount')}
        >
          <option value="qty">{t('pl.byQuantity')}</option>
          <option value="amount">{t('pl.byAmount')}</option>
        </select>
      </label>
      {/* One step a row, each box with its name over it (owner, 2026-10-21). */}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block w-40">
            <span className="mb-0.5 block text-xs text-muted">
              {byAmount ? (
                `${t('pl.fromAmount')} (${currency})`
              ) : (
                <>
                  {t('pl.fromQty')} (<bdi>{target.baseUnitName}</bdi>)
                </>
              )}
            </span>
            <input
              className={`${field} tnum`}
              inputMode={byAmount ? 'decimal' : 'numeric'}
              disabled={!canManage}
              value={r.min}
              onChange={(e) =>
                setRows(rows.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))
              }
            />
          </label>
          <label className="block w-32">
            <span className="mb-0.5 block text-xs text-muted">{t('pl.percentOff')}</span>
            <input
              className={`${field} tnum`}
              inputMode="decimal"
              disabled={!canManage}
              value={r.percent}
              onChange={(e) =>
                setRows(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))
              }
            />
          </label>
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              icon="close"
              aria-label={t('common.cancel')}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            />
          )}
        </div>
      ))}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => setRows([...rows, { min: '', percent: '' }])}
          >
            {t('pl.addStep')}
          </Button>
          <Button
            size="sm"
            icon="check"
            loading={save.isPending}
            disabled={bad}
            onClick={() =>
              save.mutate({
                productId: target.productId,
                modelId: target.modelId,
                steps: rows.map((r) =>
                  byAmount
                    ? {
                        minQuantity: 0,
                        minAmount: toMinor(Number(r.min)),
                        percent: Number(r.percent),
                      }
                    : { minQuantity: Number(r.min), percent: Number(r.percent) },
                ),
              })
            }
          >
            {t('pl.saveSteps')}
          </Button>
        </div>
      )}
      {save.isSuccess && <p className="text-xs text-positive">{t('staff.saved')}</p>}
      {save.error && <p className="text-xs text-destructive">{errorText(t, save.error)}</p>}
    </Card>
  );
}
