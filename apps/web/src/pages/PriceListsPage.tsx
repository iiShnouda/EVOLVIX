import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  formatMoney,
  formatNumber,
  toMajor,
  toMinor,
  type PriceList,
  type PriceListItem,
  type Product,
  type QuantityBreak,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import {
  useCompanySettings,
  useDeletePriceList,
  usePriceLevels,
  usePriceList,
  usePriceLists,
  useProductSearch,
  useQuantityBreaks,
  useSavePriceList,
  useSetPriceListItems,
  useSetQuantityBreaks,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:opacity-60';

type Tab = 'lists' | 'breaks';

/**
 * Price lists (special prices for chosen items, for the parties given them or for everyone while
 * they run) and quantity discounts (a percent off from a quantity) — DOMAIN.md §2.2. Anyone who sees
 * stock can look; changing them needs price_lists:manage. Invoices use them on their own.
 */
export function PriceListsPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'breaks' ? 'breaks' : 'lists';

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('pl.title')}
        action={
          <Button variant="ghost" size="sm" icon="close" onClick={() => navigate('/inventory')}>
            {t('itemCard.back')}
          </Button>
        }
      />
      <div
        role="tablist"
        className="flex max-w-full flex-wrap gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1"
      >
        {(['lists', 'breaks'] as const).map((x) => (
          <button
            key={x}
            role="tab"
            aria-selected={tab === x}
            onClick={() => setParams(x === 'lists' ? {} : { tab: x }, { replace: true })}
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
        <p className="text-sm text-muted">{t('pl.intro')}</p>
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
                      <Badge tone="brand">{t(l.side === 'SALE' ? 'pl.sideSale' : 'pl.sidePurchase')}</Badge>
                      {l.forEveryone && <Badge tone="info">{t('pl.forEveryone')}</Badge>}
                      <Badge tone={l.current ? 'positive' : 'neutral'}>
                        {t(!l.isActive ? 'pl.closed' : l.current ? 'pl.current' : 'pl.notCurrent')}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted">
                      {t('pl.itemsCount')} {formatNumber(l.items, locale)}
                      {!l.forEveryone && ` · ${t('pl.partiesCount')} ${formatNumber(l.parties, locale)}`}
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

/** A new list, or a list's name, side, dates and whether it's for everyone. */
function ListSettings({ list, onDone }: { list?: PriceList; onDone: (id?: string) => void }) {
  const { t } = useT();
  const can = useCan();
  const save = useSavePriceList();
  const [f, setF] = useState({
    name: list?.name ?? '',
    side: list?.side ?? ('SALE' as 'SALE' | 'PURCHASE'),
    forEveryone: list?.forEveryone ?? false,
    validFrom: list?.validFrom ?? '',
    validTo: list?.validTo ?? '',
    isActive: list?.isActive ?? true,
    notes: list?.notes ?? '',
  });
  const disabled = !can('price_lists:manage');

  async function submit() {
    try {
      const saved = await save.mutateAsync({
        id: list?.id,
        input: {
          name: f.name,
          ...(list ? {} : { side: f.side }),
          forEveryone: f.forEveryone,
          validFrom: f.validFrom,
          validTo: f.validTo,
          isActive: f.isActive,
          notes: f.notes,
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
          <span className="mb-0.5 block text-xs text-muted">{t('pl.side')}</span>
          <select
            className={field}
            disabled={disabled || !!list}
            value={f.side}
            onChange={(e) => setF({ ...f, side: e.target.value as 'SALE' | 'PURCHASE' })}
          >
            <option value="SALE">{t('pl.sideSale')}</option>
            <option value="PURCHASE">{t('pl.sidePurchase')}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">&nbsp;</span>
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
          <span className="mb-0.5 block text-xs text-muted">{t('pl.from')}</span>
          <input
            type="date"
            className={`${field} tnum`}
            disabled={disabled}
            value={f.validFrom}
            onChange={(e) => setF({ ...f, validFrom: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('pl.to')}</span>
          <input
            type="date"
            className={`${field} tnum`}
            disabled={disabled}
            value={f.validTo}
            min={f.validFrom || undefined}
            onChange={(e) => setF({ ...f, validTo: e.target.value })}
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
          <Button size="sm" icon="check" loading={save.isPending} disabled={!f.name.trim()} onClick={submit}>
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
    JSON.stringify(rows.map((r) => [r.key, r.price])) !== JSON.stringify(saved.map((r) => [r.key, r.price]));
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
      <ListSettings key={`${list.id}:${list.name}:${list.validFrom}:${list.validTo}:${list.isActive}`} list={list} onDone={() => undefined} />
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('pl.items')}</h2>
        {canManage && (
          <div className="space-y-2">
            <ItemPicker onPick={add} />
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={wholeModel} onChange={(e) => setWholeModel(e.target.checked)} />
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
                  className={`${field} tnum w-28`}
                  inputMode="decimal"
                  aria-label={t('pl.listPrice')}
                  disabled={!canManage}
                  value={r.price}
                  onChange={(e) =>
                    setRows(rows.map((x) => (x.key === r.key ? { ...x, price: e.target.value } : x)))
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
                if (!window.confirm(t('pl.deleteConfirm'))) return;
                await remove.mutateAsync(list.id);
                onGone();
              }}
            >
              {t('pl.delete')}
            </Button>
          </div>
        )}
        {(saveItems.error || remove.error) && (
          <p className="text-xs text-destructive">{errorText(t, saveItems.error ?? remove.error)}</p>
        )}
      </Card>
    </div>
  );
}

/** Search the catalog and pick an item (in one of its units). */
function ItemPicker({ onPick }: { onPick: (p: Product, unitId: string) => void }) {
  const { t, locale } = useT();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const found = useProductSearch(debounced);
  const results = debounced ? (found.data ?? []).slice(0, 8) : [];

  return (
    <div className="space-y-1">
      <input
        className={field}
        dir="auto"
        placeholder={t('pl.pickItem')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="max-h-60 overflow-auto rounded-[var(--radius-app)] border border-line">
          {results.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-1 border-b border-line p-2 last:border-0">
              <bdi className="min-w-0 flex-1 truncate text-sm">{p.name}</bdi>
              {p.units.map((u) => (
                <Button
                  key={u.unitId}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onPick(p, u.unitId);
                    setSearch('');
                  }}
                >
                  <bdi>{u.name}</bdi>
                  {u.factor > 1 ? ` × ${formatNumber(u.factor, locale)}` : ''}
                </Button>
              ))}
            </li>
          ))}
        </ul>
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
        <p className="text-sm text-muted">{t('pl.breaksIntro')}</p>
        {canManage && (
          <Card className="space-y-2">
            <ItemPicker
              onPick={(p) => {
                const base = p.units.find((u) => u.factor === 1) ?? p.units[0];
                setTarget(
                  wholeModel && p.modelId
                    ? { modelId: p.modelId, name: `${p.name.split(' — ')[0]} (${t('pl.model')})`, baseUnitName: base?.name ?? '' }
                    : { productId: p.id, name: p.name, baseUnitName: base?.name ?? '' },
                );
              }}
            />
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={wholeModel} onChange={(e) => setWholeModel(e.target.checked)} />
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
                            `${formatNumber(s.minQuantity, locale)}+ → ${formatNumber(s.percentBp / 100, locale)}%`,
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
              (b) => (b.productId ?? undefined) === target.productId && (b.modelId ?? undefined) === target.modelId,
            )}
          />
        )}
      </div>
    </div>
  );
}

function StepsEditor({ target, steps }: { target: Target; steps: QuantityBreak[] }) {
  const { t } = useT();
  const can = useCan();
  const save = useSetQuantityBreaks();
  const initial = () => steps.map((s) => ({ min: String(s.minQuantity), percent: String(s.percentBp / 100) }));
  const [rows, setRows] = useState(initial);
  const canManage = can('price_lists:manage');
  const bad = rows.some((r) => !(Number(r.min) >= 2) || !(Number(r.percent) > 0));

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">
        <bdi>{target.name}</bdi>
      </h2>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{t('pl.from1')}</span>
          <input
            className={`${field} tnum w-24`}
            inputMode="numeric"
            disabled={!canManage}
            value={r.min}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))}
          />
          <bdi className="text-muted">{target.baseUnitName}</bdi>
          <input
            className={`${field} tnum w-20`}
            inputMode="decimal"
            disabled={!canManage}
            value={r.percent}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
          />
          <span className="text-muted">{t('pl.percentOff')}</span>
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
          <Button size="sm" variant="secondary" icon="plus" onClick={() => setRows([...rows, { min: '', percent: '' }])}>
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
                steps: rows.map((r) => ({ minQuantity: Number(r.min), percent: Number(r.percent) })),
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
