import { confirm } from '../lib/confirm';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatNumber, type Permission, type TranslationKey, type Warehouse } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { NameFields, changedNames, namesFrom, type NameValues } from '../components/NameFields';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ApiError } from '../lib/api';
import {
  useCreateCatalogEntry,
  useCreateSeason,
  useDeleteCatalogEntry,
  useDepartments,
  useGroups,
  useSeasons,
  useUnits,
  useUpdateCatalogEntry,
  useVariantOptions,
  useWarehouses,
  type CatalogList,
} from '../lib/queries';
import { errorText } from '../lib/errors';
import { GroupsSetup } from '../components/GroupTree';

type Tab = 'departments' | 'groups' | 'units' | 'sizes' | 'colors' | 'seasons';

/**
 * The lists items are built from (owner decision 2026-10-01): departments (no separate groups),
 * units with how many pieces each holds, sizes, colors with their swatch, and seasons. No price
 * levels: an item has one sale price per unit. A department is added in the branches' warehouses
 * chosen, shows where it is, and one with nothing recorded can be deleted (owner, 2026-10-11).
 */
const TABS: { key: Tab; label: TranslationKey; permission: Permission }[] = [
  { key: 'departments', label: 'setup.departments', permission: 'categories:manage' },
  { key: 'groups', label: 'groups.tab', permission: 'categories:manage' },
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
  /** A season's kind: only one added by hand (CUSTOM) is renamed; "no season" stays. */
  kind?: string;
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
  const groups = useGroups();
  const options = useVariantOptions();
  const seasons = useSeasons();
  const warehouses = useWarehouses(true);
  const stores = (warehouses.data ?? []).filter((w) => w.kind === 'STORE');

  const current = TABS.find((x) => x.key === tab)!;
  const canManage = can(current.permission);
  const list: CatalogList =
    tab === 'units'
      ? 'units'
      : tab === 'departments'
        ? 'departments'
        : tab === 'seasons'
          ? 'seasons'
          : 'variant-options';
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

      {tab === 'groups' ? (
        departments.isLoading || groups.isLoading ? (
          <div className="grid place-items-center py-16 text-muted">
            <Spinner size={26} />
          </div>
        ) : (
          <GroupsSetup
            departments={departments.data ?? []}
            groups={groups.data ?? []}
            canManage={canManage}
          />
        )
      ) : (
        <>
          {canManage &&
            (tab === 'seasons' ? (
              <AddSeason />
            ) : (
              <AddEntry key={tab} tab={tab} list={list} stores={stores} />
            ))}

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
                    canManage={canManage}
                    stores={stores}
                  />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

const LABELS: Record<
  Exclude<Tab, 'seasons' | 'groups'>,
  { name: TranslationKey; placeholder: TranslationKey }
> = {
  units: { name: 'setup.unitName', placeholder: 'setup.unitPlaceholder' },
  departments: { name: 'setup.departmentName', placeholder: 'setup.departmentPlaceholder' },
  sizes: { name: 'setup.sizeName', placeholder: 'setup.sizePlaceholder' },
  colors: { name: 'setup.colorName', placeholder: 'setup.colorPlaceholder' },
};

/**
 * The warehouses a department is in, grouped by branch (owner, 2026-10-11: "it should say which
 * branch it is in"). With a single warehouse it is simply chosen.
 */
function PlacePicker({
  stores,
  value,
  onChange,
}: {
  stores: Warehouse[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useT();
  const branches = [...new Map(stores.map((w) => [w.branchId, w.branchName])).entries()];
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-xs text-muted">{t('setup.departmentPlace')}</legend>
      {branches.map(([branchId, branchName]) => (
        <div key={branchId} className="flex flex-wrap items-center gap-1.5">
          <span className="me-1 inline-flex items-center gap-1 text-xs font-semibold">
            <Icon name="branches" size={14} className="text-muted" />
            {branchName}
          </span>
          {stores
            .filter((w) => w.branchId === branchId)
            .map((w) => {
              const on = value.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(w.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                    on
                      ? 'border-brand bg-brand-soft text-brand'
                      : 'border-line bg-surface text-muted hover:text-fg'
                  }`}
                >
                  <Icon name={on ? 'check' : 'inventory'} size={14} />
                  {w.name}
                </button>
              );
            })}
        </div>
      ))}
    </fieldset>
  );
}

/** Where a department is: the warehouses that offer it (one with no departments picked offers every one). */
function placesOf(departmentId: string, stores: Warehouse[]): string[] {
  return stores
    .filter((w) => !w.departmentIds?.length || w.departmentIds.includes(departmentId))
    .map((w) => w.id);
}

function AddEntry({
  tab,
  list,
  stores,
}: {
  tab: Exclude<Tab, 'seasons' | 'groups'>;
  list: CatalogList;
  stores: Warehouse[];
}) {
  const { t } = useT();
  const create = useCreateCatalogEntry(list);
  const [names, setNames] = useState<NameValues>('');
  const [prefix, setPrefix] = useState('');
  const only = stores.length === 1 ? [stores[0]!.id] : [];
  const [places, setPlaces] = useState<string[]>(only);
  const placed = tab !== 'departments' || places.length > 0 || stores.length === 0;
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
            ? {
                ...typed,
                prefix: prefix.trim() || undefined,
                ...(stores.length ? { warehouseIds: places } : {}),
              }
            : { ...typed, pieces: Math.max(1, Math.floor(Number(pieces) || 1)) };
      await create.mutateAsync(input);
      setNames('');
      setPrefix('');
      setPieces('1');
      setPlaces(only);
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
        <Button
          icon="plus"
          loading={create.isPending}
          disabled={!typed.name || !placed}
          onClick={add}
        >
          {t('common.add')}
        </Button>
      </div>
      {tab === 'departments' && stores.length > 0 && (
        <PlacePicker stores={stores} value={places} onChange={setPlaces} />
      )}
      {error && <p className="text-xs text-destructive">{errorText(t, error)}</p>}
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
      {error && <p className="text-xs text-destructive">{errorText(t, error)}</p>}
    </Card>
  );
}

function EntryRow({
  entry,
  tab,
  list,
  canManage,
  stores,
}: {
  entry: Entry;
  tab: Tab;
  list: CatalogList;
  canManage: boolean;
  stores: Warehouse[];
}) {
  const { t, locale } = useT();
  const can = useCan();
  const update = useUpdateCatalogEntry(list);
  const remove = useDeleteCatalogEntry(list);
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<NameValues>(namesFrom(entry.name));
  const [prefix, setPrefix] = useState(entry.prefix ?? '');
  const [pieces, setPieces] = useState(String(entry.pieces ?? 1));
  const isDepartment = tab === 'departments';
  const isSeason = tab === 'seasons';
  const canRename = !isSeason || entry.kind === 'CUSTOM';
  const canDelete = isDepartment
    ? can('departments:delete')
    : can('setup:delete') && !(isSeason && entry.kind === 'NONE');
  const where = isDepartment ? placesOf(entry.id, stores) : [];
  const [places, setPlaces] = useState<string[]>(where);
  const error = (update.error ?? remove.error) as ApiError | null;

  async function del() {
    const ask = isDepartment ? t('setup.deleteDepartmentAsk') : t('setup.deleteEntryAsk');
    if (!(await confirm({ message: ask, danger: true }))) return;
    try {
      await remove.mutateAsync(entry.id);
    } catch {
      /* shown below */
    }
  }

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
    if (isDepartment && stores.length && [...places].sort().join() !== [...where].sort().join())
      input.warehouseIds = places;
    void run(input);
  }

  return (
    <li className={`p-4 ${entry.isActive === false ? 'opacity-60' : ''}`}>
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
          {isDepartment && stores.length > 0 && (
            <div className="sm:col-span-2 sm:row-start-2">
              <PlacePicker stores={stores} value={places} onChange={setPlaces} />
            </div>
          )}
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
          {isDepartment && where.length > 0 && (
            <span className="flex basis-full flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
              {[...new Set(stores.filter((w) => where.includes(w.id)).map((w) => w.branchId))].map(
                (branchId) => {
                  const inBranch = stores.filter(
                    (w) => w.branchId === branchId && where.includes(w.id),
                  );
                  return (
                    <span key={branchId} className="inline-flex items-center gap-1">
                      <Icon name="branches" size={13} />
                      <span className="font-medium text-fg">{inBranch[0]!.branchName}:</span>
                      <span>{inBranch.map((w) => w.name).join('، ')}</span>
                    </span>
                  );
                },
              )}
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
              {canRename && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="edit"
                  onClick={() => {
                    setNames(namesFrom(entry.name));
                    setPrefix(entry.prefix ?? '');
                    setPieces(String(entry.pieces ?? 1));
                    setPlaces(where);
                    setEditing(true);
                  }}
                >
                  {t('common.edit')}
                </Button>
              )}
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
              {entry.isActive && !isSeason && (
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
              {canDelete && (
                <Button
                  size="sm"
                  variant="dangerGhost"
                  icon="trash"
                  loading={remove.isPending}
                  onClick={() => void del()}
                >
                  {t('common.delete')}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{errorText(t, error)}</p>}
    </li>
  );
}
