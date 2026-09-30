import { useState } from 'react';
import { formatMoney, formatNumber, type BranchWithWarehouses, type Warehouse } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { NameFields, changedNames, namesFrom, type NameValues } from '../components/NameFields';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ApiError } from '../lib/api';
import { useAuth } from '../stores/auth';
import {
  useBranches,
  useCompanySettings,
  useCreateBranch,
  useCreateWarehouse,
  useUpdateBranch,
  useUpdateWarehouse,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

const EMPTY: NameValues = '';

/**
 * Branches & warehouses (الفروع والمخازن): every branch with the warehouses that hold its stock.
 * Managers add and rename branches, add, rename, close or reopen warehouses and pick each branch's
 * default. Names are kept exactly as typed. The server refuses closing a warehouse that still holds stock or is the default.
 */
export function BranchesPage() {
  const { t } = useT();
  const branches = useBranches();
  const canManage = useAuth((s) => s.user?.permissions ?? []).includes('branches:manage');
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('branches.title')}
        subtitle={t('branches.subtitle')}
        action={
          canManage && !adding ? (
            <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
              {t('branches.add')}
            </Button>
          ) : undefined
        }
      />
      {adding && <NewBranch onDone={() => setAdding(false)} />}
      {branches.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : (branches.data ?? []).length === 0 ? (
        <Card>
          <EmptyState title={t('common.empty')} icon="branches" />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {(branches.data ?? []).map((b) => (
            <BranchCard key={b.id} branch={b} canManage={canManage} currency={currency} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Add a branch: its name (as typed) and where it is. */
function NewBranch({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const create = useCreateBranch();
  const [names, setNames] = useState<NameValues>(EMPTY);
  const [location, setLocation] = useState('');
  const [code, setCode] = useState('');
  const error = create.error as ApiError | null;
  const typed = changedNames(names);

  async function save() {
    try {
      await create.mutateAsync({
        ...typed,
        location: location.trim() || undefined,
        code: code.trim() || undefined,
      });
      onDone();
    } catch {
      /* shown below */
    }
  }

  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px]">
        <NameFields values={names} onChange={setNames} label={t('branches.name')} autoFocus />
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('branches.location')}</span>
          <input className={field} value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('warehouse.code')}</span>
          <input
            className={`${field} uppercase placeholder:normal-case`}
            placeholder={t('warehouse.auto')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-faint">{t('branches.newHint')}</p>
      {error && <p className="text-xs text-destructive">{error.message}</p>}
      <div className="flex gap-2">
        <Button icon="check" loading={create.isPending} disabled={!typed.name} onClick={save}>
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </Card>
  );
}

function BranchCard({
  branch,
  canManage,
  currency,
}: {
  branch: BranchWithWarehouses;
  canManage: boolean;
  currency: string;
}) {
  const { t } = useT();
  const create = useCreateWarehouse();
  const update = useUpdateBranch();
  const [names, setNames] = useState<NameValues>(EMPTY);
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState(false);
  const [branchNames, setBranchNames] = useState<NameValues>(namesFrom(branch.name));
  const [location, setLocation] = useState(branch.location ?? '');
  const error = create.error as ApiError | null;
  const editError = update.error as ApiError | null;
  const typed = changedNames(names);

  async function add() {
    try {
      await create.mutateAsync({
        branchId: branch.id,
        ...typed,
        code: code.trim() || undefined,
        isDefault: false,
      });
      setNames(EMPTY);
      setCode('');
    } catch {
      /* shown below */
    }
  }

  async function saveBranch() {
    try {
      await update.mutateAsync({
        id: branch.id,
        input: {
          ...changedNames(branchNames, branch.name),
          location: location.trim() || undefined,
        },
      });
      setEditing(false);
    } catch {
      /* shown below */
    }
  }

  return (
    <Card padded={false} className="h-fit overflow-hidden">
      <div className="border-b border-line p-4">
        {editing ? (
          <div className="space-y-3">
            <NameFields values={branchNames} onChange={setBranchNames} autoFocus />
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('branches.location')}</span>
              <input
                className={field}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>
            {editError && <p className="text-xs text-destructive">{editError.message}</p>}
            <div className="flex gap-2">
              <Button size="sm" icon="check" loading={update.isPending} onClick={saveBranch}>
                {t('common.save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
                <span className="truncate">{branch.name}</span>
              </h2>
              <p className="text-xs text-muted">
                {branch.code}
                {branch.location ? ` · ${branch.location}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!branch.isActive && <Badge>{t('warehouse.closed')}</Badge>}
              {canManage && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setBranchNames(namesFrom(branch.name));
                    setLocation(branch.location ?? '');
                    setEditing(true);
                  }}
                >
                  {t('branches.edit')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {branch.warehouses.length === 0 ? (
        <EmptyState title={t('warehouse.none')} icon="inventory" />
      ) : (
        <ul className="divide-y divide-[var(--c-line)]">
          {branch.warehouses.map((w) => (
            <WarehouseRow key={w.id} warehouse={w} canManage={canManage} currency={currency} />
          ))}
        </ul>
      )}

      {canManage && (
        <div className="space-y-2 border-t border-line bg-surface-2 p-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto] sm:items-end">
            <NameFields
              values={names}
              onChange={setNames}
              label={t('warehouse.name')}
              placeholder={t('warehouse.namePlaceholder')}
            />
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('warehouse.code')}</span>
              <input
                className={`${field} uppercase placeholder:normal-case`}
                placeholder={t('warehouse.auto')}
                title={t('warehouse.codeHint')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <Button
              icon="plus"
              size="md"
              loading={create.isPending}
              disabled={!typed.name}
              onClick={add}
            >
              {t('warehouse.add')}
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error.message}</p>}
          <p className="text-xs text-faint">
            {t('warehouse.defaultHint')} {t('warehouse.closeHint')}
          </p>
        </div>
      )}
    </Card>
  );
}

function WarehouseRow({
  warehouse: w,
  canManage,
  currency,
}: {
  warehouse: Warehouse;
  canManage: boolean;
  currency: string;
}) {
  const { t, locale } = useT();
  // A warehouse's stock value (at cost) is the owner's unless given (costs:view).
  const seeCosts = useCan()('costs:view');
  const update = useUpdateWarehouse();
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<NameValues>(namesFrom(w.name));
  const error = update.error as ApiError | null;

  async function run(input: Parameters<typeof update.mutateAsync>[0]['input']) {
    try {
      await update.mutateAsync({ id: w.id, input });
      setEditing(false);
    } catch {
      /* shown below */
    }
  }

  return (
    <li className={`p-4 ${w.isActive ? '' : 'opacity-60'}`}>
      {editing ? (
        <NameFields values={names} onChange={setNames} autoFocus />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{w.name}</span>
          <span className="text-xs text-muted tnum">{w.code}</span>
          {w.isDefault && <Badge tone="brand">{t('warehouse.default')}</Badge>}
          {!w.isActive && <Badge>{t('warehouse.closed')}</Badge>}
        </div>
      )}

      <dl className={`mt-2 grid gap-2 text-xs ${seeCosts ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <Stat label={t('warehouse.items')} value={formatNumber(w.itemCount, locale)} />
        <Stat label={t('warehouse.units')} value={formatNumber(w.quantity, locale)} />
        {seeCosts && (
          <Stat label={t('warehouse.value')} value={formatMoney(w.value, currency, locale)} />
        )}
      </dl>

      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                icon="check"
                loading={update.isPending}
                onClick={() => run(changedNames(names, w.name))}
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
                  setNames(namesFrom(w.name));
                  setEditing(true);
                }}
              >
                {t('warehouse.rename')}
              </Button>
              {w.isActive && !w.isDefault && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={update.isPending}
                  onClick={() => run({ isDefault: true })}
                >
                  {t('warehouse.makeDefault')}
                </Button>
              )}
              {w.isActive && !w.isDefault && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={update.isPending}
                  onClick={() => run({ isActive: false })}
                >
                  {t('warehouse.close')}
                </Button>
              )}
              {!w.isActive && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={update.isPending}
                  onClick={() => run({ isActive: true })}
                >
                  {t('warehouse.reopen')}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tnum">{value}</dd>
    </div>
  );
}
