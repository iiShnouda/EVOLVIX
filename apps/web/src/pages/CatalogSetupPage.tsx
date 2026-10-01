import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatNumber, type Permission, type TranslationKey } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { NameFields, changedNames, namesFrom, type NameValues } from '../components/NameFields';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ApiError } from '../lib/api';
import {
  useCreateCatalogEntry,
  useCreateSeason,
  useDepartments,
  useSeasons,
  useUnits,
  useUpdateCatalogEntry,
  useVariantOptions,
  useWarehouses,
  type CatalogList,
} from '../lib/queries';

type Tab = 'departments' | 'units' | 'sizes' | 'colors' | 'seasons';

/**
 * The lists items are built from (owner decision 2026-10-01): departments (no separate groups),
 * units with how many pieces each holds, sizes, colors with their swatch, and seasons. No price
 * levels: an item has one sale price per unit.
 */
const TABS: { key: Tab; label: TranslationKey; permission: Permission }[] = [
  { key: 'departments', label: 'setup.departments', permission: 'categories:manage' },
  { key: 'units', label: 'setup.units', permission: 'units:manage' },
  { key: 'sizes', label: 'setup.sizes', permission: 'variant_options:manage' },
  { key: 'colors', label: 'setup.colors', permission: 'variant_options:manage' },
  { key: 'seasons', label: 'setup.seasons', permission: 'seasons:manage' },
];

/** One row of any of the lists. */
interface Entry {
  id: string;
  name: string;
  isActive?: boolean;
  itemCount?: number;
  prefix?: string | null;
  pieces?: number;
  hex?: string | null;
  warehouseIds?: string[];
  isCurrent?: boolean;
}

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

export function CatalogSetupPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((x) => x.key === params.get('tab'))?.key ?? 'departments') as Tab;

  const units = useUnits();
  const departments = useDepartments();
  const options = useVariantOptions();
  const seasons = useSeasons();
  const warehouses = useWarehouses(true);
  const warehouseName = new Map((warehouses.data ?? []).map((w) => [w.id, w.name]));

  const current = TABS.find((x) => x.key === tab)!;
  const canManage = can(current.permission);
  const list: CatalogList =
    tab === 'units' ? 'units' : tab === 'departments' ? 'departments' : 'variant-options';
  const loading =
    (tab === 'units' && units.isLoading) ||
    (tab === 'departments' && departments.isLoading) ||
    (tab === 'seasons' && seasons.isLoading) ||
    ((tab === 'sizes' || tab === 'colors') && options.isLoading);
  const entries: Entry[] =
    tab === 'units'
      ? (units.data ?? [])
      : tab === 'departments'
        ? (departments.data ?? [])
        : tab === 'seasons'
          ? (seasons.data ?? [])
          : (options.data ?? []).filter((o) => o.kind === (tab === 'sizes' ? 'SIZE' : 'COLOR'));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('setup.title')}
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

      {canManage &&
        (tab === 'seasons' ? <AddSeason /> : <AddEntry key={tab} tab={tab} list={list} />)}

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
              <EntryRow
                key={e.id}
                entry={e}
                tab={tab}
                list={list}
                canManage={canManage && tab !== 'seasons'}
                warehouseName={warehouseName}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const LABELS: Record<
  Exclude<Tab, 'seasons'>,
  { name: TranslationKey; placeholder: TranslationKey }
> = {
  units: { name: 'setup.unitName', placeholder: 'setup.unitPlaceholder' },
  departments: { name: 'setup.departmentName', placeholder: 'setup.departmentPlaceholder' },
  sizes: { name: 'setup.sizeName', placeholder: 'setup.sizePlaceholder' },
  colors: { name: 'setup.colorName', placeholder: 'setup.colorPlaceholder' },
};

function AddEntry({ tab, list }: { tab: Exclude<Tab, 'seasons'>; list: CatalogList }) {
  const { t } = useT();
  const create = useCreateCatalogEntry(list);
  const [names, setNames] = useState<NameValues>('');
  const [prefix, setPrefix] = useState('');
  const [pieces, setPieces] = useState('1');
  const [hex, setHex] = useState('#1d4ed8');
  const typed = changedNames(names);
  const error = create.error as ApiError | null;

  async function add() {
    try {
      const input =
        tab === 'sizes' || tab === 'colors'
          ? {
              ...typed,
              kind: tab === 'sizes' ? ('SIZE' as const) : ('COLOR' as const),
              ...(tab === 'colors' ? { hex } : {}),
            }
          : tab === 'departments'
            ? { ...typed, prefix: prefix.trim() || undefined }
            : { ...typed, pieces: Math.max(1, Math.floor(Number(pieces) || 1)) };
      await create.mutateAsync(input);
      setNames('');
      setPrefix('');
      setPieces('1');
    } catch {
      /* shown below */
    }
  }

  const extra = tab === 'departments' || tab === 'units' || tab === 'colors';
  return (
    <Card className="space-y-2">
      <div
        className={`grid gap-2 sm:items-end ${extra ? 'sm:grid-cols-[1fr_160px_auto]' : 'sm:grid-cols-[1fr_auto]'}`}
      >
        <NameFields
          values={names}
          onChange={setNames}
          label={t(LABELS[tab].name)}
          placeholder={t(LABELS[tab].placeholder)}
        />
        {tab === 'departments' && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('setup.prefix')}</span>
            <input
              className={`${field} uppercase`}
              dir="ltr"
              maxLength={10}
              placeholder="MEN"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </label>
        )}
        {tab === 'units' && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('setup.pieces')}</span>
            <input
              type="number"
              min={1}
              className={`${field} tnum`}
              value={pieces}
              onChange={(e) => setPieces(e.target.value)}
            />
          </label>
        )}
        {tab === 'colors' && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('setup.swatch')}</span>
            <input
              type="color"
              className="h-9 w-full cursor-pointer rounded-[var(--radius-app)] border border-line bg-surface p-1"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
            />
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

function AddSeason() {
  const { t } = useT();
  const create = useCreateSeason();
  const [name, setName] = useState('');
  const error = create.error as ApiError | null;
  return (
    <Card className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('setup.seasonName')}</span>
          <input
            className={field}
            maxLength={60}
            placeholder={t('setup.seasonPlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button
          icon="plus"
          loading={create.isPending}
          disabled={!name.trim()}
          onClick={() => create.mutate(name.trim(), { onSuccess: () => setName('') })}
        >
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
  warehouseName,
}: {
  entry: Entry;
  tab: Tab;
  list: CatalogList;
  canManage: boolean;
  warehouseName: Map<string, string>;
}) {
  const { t, locale } = useT();
  const update = useUpdateCatalogEntry(list);
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<NameValues>(namesFrom(entry.name));
  const [prefix, setPrefix] = useState(entry.prefix ?? '');
  const [pieces, setPieces] = useState(String(entry.pieces ?? 1));
  const error = update.error as ApiError | null;

  async function run(input: Record<string, unknown>) {
    try {
      await update.mutateAsync({ id: entry.id, input });
      setEditing(false);
    } catch {
      /* shown below */
    }
  }

  function save() {
    const input: Record<string, unknown> = { ...changedNames(names, entry.name) };
    if (tab === 'departments' && prefix.trim() !== (entry.prefix ?? ''))
      input.prefix = prefix.trim();
    if (tab === 'units') input.pieces = Math.max(1, Math.floor(Number(pieces) || 1));
    void run(input);
  }

  return (
    <li className={`p-4 ${entry.isActive === false ? 'opacity-60' : ''}`}>
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
          <NameFields values={names} onChange={setNames} autoFocus />
          {tab === 'departments' && (
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('setup.prefix')}</span>
              <input
                className={`${field} uppercase`}
                dir="ltr"
                maxLength={10}
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
              />
            </label>
          )}
          {tab === 'units' && (
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('setup.pieces')}</span>
              <input
                type="number"
                min={1}
                className={`${field} tnum`}
                value={pieces}
                onChange={(e) => setPieces(e.target.value)}
              />
            </label>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {tab === 'colors' && (
            <span
              className="h-5 w-5 shrink-0 rounded-full border border-line"
              style={{ background: entry.hex ?? 'transparent' }}
              aria-hidden="true"
            />
          )}
          <span className="font-medium">{entry.name}</span>
          {entry.prefix && (
            <Badge tone="info">
              <span dir="ltr">{entry.prefix}</span>
            </Badge>
          )}
          {entry.isCurrent && <Badge tone="brand">{t('setup.currentSeason')}</Badge>}
          {entry.isActive === false && <Badge>{t('setup.closed')}</Badge>}
          {tab === 'units' && (
            <span className="text-xs text-muted tnum">
              {t('setup.pieces')}: {formatNumber(entry.pieces ?? 1, locale)}
            </span>
          )}
          {entry.itemCount !== undefined && tab !== 'seasons' && (
            <span className="text-xs text-muted tnum">
              {t('setup.itemCount')}: {formatNumber(entry.itemCount, locale)}
            </span>
          )}
          {tab === 'departments' && (entry.warehouseIds?.length ?? 0) > 0 && (
            <span className="text-xs text-muted">
              {t('setup.inWarehouses')}:{' '}
              {entry.warehouseIds!.map((id) => warehouseName.get(id) ?? '').join('، ')}
            </span>
          )}
        </div>
      )}

      {canManage && (
        <div className="mt-2 flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" icon="check" loading={update.isPending} onClick={save}>
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
                  setPrefix(entry.prefix ?? '');
                  setPieces(String(entry.pieces ?? 1));
                  setEditing(true);
                }}
              >
                {t('setup.rename')}
              </Button>
              {tab === 'colors' && (
                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2 text-xs">
                  {t('setup.swatch')}
                  <input
                    type="color"
                    className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                    value={entry.hex ?? '#000000'}
                    onChange={(e) => void run({ hex: e.target.value })}
                  />
                </label>
              )}
              {entry.isActive && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={update.isPending}
                  onClick={() => run({ isActive: false })}
                >
                  {t('setup.close')}
                </Button>
              )}
              {entry.isActive === false && (
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
