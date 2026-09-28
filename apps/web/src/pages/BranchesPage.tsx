import { useState } from 'react';
import { formatMoney, formatNumber, type BranchWithWarehouses, type Warehouse } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { useT } from '../lib/i18n';
import { ApiError } from '../lib/api';
import { useAuth } from '../stores/auth';
import {
  useBranches,
  useCompanySettings,
  useCreateWarehouse,
  useUpdateWarehouse,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/**
 * Branches & warehouses (الفروع والمخازن): every branch with the warehouses that hold its stock.
 * Managers add, rename, close or reopen warehouses and pick each branch's default. The server
 * refuses closing a warehouse that still holds stock or is the default.
 */
export function BranchesPage() {
  const { t } = useT();
  const branches = useBranches();
  const canManage = useAuth((s) => s.user?.permissions ?? []).includes('branches:manage');
  const currency = useCompanySettings().data?.currency ?? 'EGP';

  return (
    <div className="space-y-5">
      <PageHeader title={t('branches.title')} subtitle={t('branches.subtitle')} />
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
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const error = create.error as ApiError | null;

  async function add() {
    try {
      await create.mutateAsync({
        branchId: branch.id,
        name: name.trim(),
        code: code.trim() || undefined,
        isDefault: false,
      });
      setName('');
      setCode('');
    } catch {
      /* shown below */
    }
  }

  return (
    <Card padded={false} className="h-fit overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{branch.name}</h2>
          <p className="text-xs text-muted">
            {branch.code}
            {branch.location ? ` · ${branch.location}` : ''}
          </p>
        </div>
        {!branch.isActive && <Badge>{t('warehouse.closed')}</Badge>}
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
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('warehouse.name')}</span>
              <input
                className={field}
                placeholder={t('warehouse.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
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
              disabled={!name.trim()}
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
  const update = useUpdateWarehouse();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(w.name);
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
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <input
            className={`${field} max-w-64`}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) void run({ name: name.trim() });
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <span className="font-medium">{w.name}</span>
        )}
        <span className="text-xs text-muted tnum">{w.code}</span>
        {w.isDefault && <Badge tone="brand">{t('warehouse.default')}</Badge>}
        {!w.isActive && <Badge>{t('warehouse.closed')}</Badge>}
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <Stat label={t('warehouse.items')} value={formatNumber(w.itemCount, locale)} />
        <Stat label={t('warehouse.units')} value={formatNumber(w.quantity, locale)} />
        <Stat label={t('warehouse.value')} value={formatMoney(w.value, currency, locale)} />
      </dl>

      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                icon="check"
                loading={update.isPending}
                disabled={!name.trim()}
                onClick={() => run({ name: name.trim() })}
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
                  setName(w.name);
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
