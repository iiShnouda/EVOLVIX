import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatNumber, type Permission, type PriceSide, type TranslationKey } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { NameFields, changedNames, namesFrom, type NameValues } from '../components/NameFields';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ApiError } from '../lib/api';
import {
  useCategories,
  useCreateCatalogEntry,
  usePriceLevels,
  useUnits,
  useUpdateCatalogEntry,
  useVariantOptions,
  type CatalogList,
} from '../lib/queries';

type Tab = 'units' | 'categories' | 'sizes' | 'colors' | 'levels';

const TABS: { key: Tab; label: TranslationKey; permission: Permission }[] = [
  { key: 'units', label: 'setup.units', permission: 'units:manage' },
  { key: 'categories', label: 'setup.categories', permission: 'categories:manage' },
  { key: 'sizes', label: 'setup.sizes', permission: 'variant_options:manage' },
  { key: 'colors', label: 'setup.colors', permission: 'variant_options:manage' },
  { key: 'levels', label: 'setup.priceLevels', permission: 'price_levels:manage' },
];

/** One row of any catalog list, whatever the list. */
interface Entry {
  id: string;
  name: string;
  isActive?: boolean;
  itemCount?: number;
  isDefault?: boolean;
  side?: PriceSide;
}

const EMPTY: NameValues = '';

/**
 * Catalog setup (إعداد الأصناف): the company-wide lists items are built from — units of measure,
 * categories, sizes, colors and price levels. Each list has its own permission; without it the
 * list is read-only. Names are kept exactly as typed.
 */
export function CatalogSetupPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((x) => x.key === params.get('tab'))?.key ?? 'units') as Tab;

  const units = useUnits();
  const categories = useCategories();
  const options = useVariantOptions();
  const levels = usePriceLevels();

  const current = TABS.find((x) => x.key === tab)!;
  const canManage = can(current.permission);
  const list: CatalogList =
    tab === 'units'
      ? 'units'
      : tab === 'categories'
        ? 'categories'
        : tab === 'levels'
          ? 'price-levels'
          : 'variant-options';
  const loading =
    (tab === 'units' && units.isLoading) ||
    (tab === 'categories' && categories.isLoading) ||
    ((tab === 'sizes' || tab === 'colors') && options.isLoading) ||
    (tab === 'levels' && levels.isLoading);
  const entries: Entry[] =
    tab === 'units'
      ? (units.data ?? [])
      : tab === 'categories'
        ? (categories.data ?? []).map((c) => ({ ...c, isActive: undefined }))
        : tab === 'levels'
          ? (levels.data ?? [])
          : (options.data ?? []).filter((o) => o.kind === (tab === 'sizes' ? 'SIZE' : 'COLOR'));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('setup.title')}
        subtitle={t('setup.subtitle')}
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
        {TABS.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => setParams({ tab: x.key }, { replace: true })}
            className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
              tab === x.key ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
            }`}
          >
            {t(x.label)}
          </button>
        ))}
      </div>

      {canManage ? (
        <AddEntry key={tab} tab={tab} list={list} />
      ) : (
        <p className="text-sm text-muted">{t('setup.readonly')}</p>
      )}

      <Card padded={false} className="overflow-hidden">
        {loading ? (
          <div className="grid place-items-center py-16 text-muted">
            <Spinner size={26} />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState title={t('common.empty')} icon="inventory" />
        ) : (
          <ul className="divide-y divide-[var(--c-line)]">
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} tab={tab} list={list} canManage={canManage} />
            ))}
          </ul>
        )}
      </Card>
      {tab === 'levels' && <p className="text-xs text-faint">{t('setup.levelsHint')}</p>}
    </div>
  );
}

const LABELS: Record<Tab, { name: TranslationKey; placeholder: TranslationKey }> = {
  units: { name: 'setup.unitName', placeholder: 'setup.unitPlaceholder' },
  categories: { name: 'setup.categoryName', placeholder: 'setup.categoryPlaceholder' },
  sizes: { name: 'setup.sizeName', placeholder: 'setup.sizePlaceholder' },
  colors: { name: 'setup.colorName', placeholder: 'setup.colorPlaceholder' },
  levels: { name: 'setup.levelName', placeholder: 'setup.levelPlaceholder' },
};

function AddEntry({ tab, list }: { tab: Tab; list: CatalogList }) {
  const { t } = useT();
  const create = useCreateCatalogEntry(list);
  const [names, setNames] = useState<NameValues>(EMPTY);
  const [side, setSide] = useState<PriceSide>('SALE');
  const typed = changedNames(names);
  const error = create.error as ApiError | null;

  async function add() {
    try {
      const input =
        tab === 'levels'
          ? { ...typed, side }
          : tab === 'sizes' || tab === 'colors'
            ? { ...typed, kind: tab === 'sizes' ? ('SIZE' as const) : ('COLOR' as const) }
            : typed;
      await create.mutateAsync(input);
      setNames(EMPTY);
    } catch {
      /* shown below */
    }
  }

  return (
    <Card className="space-y-2">
      <div
        className={`grid gap-2 sm:items-end ${tab === 'levels' ? 'sm:grid-cols-[1fr_200px_auto]' : 'sm:grid-cols-[1fr_auto]'}`}
      >
        <NameFields
          values={names}
          onChange={setNames}
          label={t(LABELS[tab].name)}
          placeholder={t(LABELS[tab].placeholder)}
        />
        {tab === 'levels' && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('setup.side')}</span>
            <select
              className="h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand"
              value={side}
              onChange={(e) => setSide(e.target.value as PriceSide)}
            >
              <option value="SALE">{t('setup.sideSALE')}</option>
              <option value="PURCHASE">{t('setup.sidePURCHASE')}</option>
            </select>
          </label>
        )}
        <Button icon="plus" loading={create.isPending} disabled={!typed.name} onClick={add}>
          {t('common.add')}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </Card>
  );
}

function EntryRow({
  entry,
  tab,
  list,
  canManage,
}: {
  entry: Entry;
  tab: Tab;
  list: CatalogList;
  canManage: boolean;
}) {
  const { t, locale } = useT();
  const update = useUpdateCatalogEntry(list);
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<NameValues>(namesFrom(entry.name));
  const error = update.error as ApiError | null;
  const closable = tab !== 'categories';

  async function run(input: Parameters<typeof update.mutateAsync>[0]['input']) {
    try {
      await update.mutateAsync({ id: entry.id, input });
      setEditing(false);
    } catch {
      /* shown below */
    }
  }

  return (
    <li className={`p-4 ${entry.isActive === false ? 'opacity-60' : ''}`}>
      {editing ? (
        <NameFields values={names} onChange={setNames} autoFocus />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{entry.name}</span>
          {entry.side && (
            <Badge tone="info">
              {t(entry.side === 'SALE' ? 'setup.sideSALE' : 'setup.sidePURCHASE')}
            </Badge>
          )}
          {entry.isDefault && <Badge tone="brand">{t('setup.default')}</Badge>}
          {entry.isActive === false && <Badge>{t('setup.closed')}</Badge>}
          {entry.itemCount !== undefined && (
            <span className="text-xs text-muted tnum">
              {t('setup.itemCount')}: {formatNumber(entry.itemCount, locale)}
            </span>
          )}
        </div>
      )}

      {canManage && (
        <div className="mt-2 flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                icon="check"
                loading={update.isPending}
                onClick={() => run(changedNames(names, entry.name))}
              >
                {t('common.save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setNames(namesFrom(entry.name));
                  setEditing(true);
                }}
              >
                {t('setup.rename')}
              </Button>
              {tab === 'levels' && entry.isActive && !entry.isDefault && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={update.isPending}
                  onClick={() => run({ isDefault: true })}
                >
                  {t('setup.makeDefault')}
                </Button>
              )}
              {closable && entry.isActive && !entry.isDefault && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={update.isPending}
                  onClick={() => run({ isActive: false })}
                >
                  {t('setup.close')}
                </Button>
              )}
              {closable && entry.isActive === false && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={update.isPending}
                  onClick={() => run({ isActive: true })}
                >
                  {t('setup.reopen')}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error.message}</p>}
    </li>
  );
}
