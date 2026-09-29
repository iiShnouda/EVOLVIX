import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ROLES,
  type Permission,
  type PermissionInfo,
  type Role,
  type RoleInfo,
  type StaffMember,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ApiError } from '../lib/api';
import { useAuth } from '../stores/auth';
import {
  useBranches,
  useCreateStaff,
  usePermissionCatalog,
  useResetRole,
  useRoles,
  useSetStaffPermissions,
  useStaff,
  useUpdateRole,
  useUpdateStaff,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:opacity-60';

/** Screen sections that permissions are shown in (the API groups by the part before the colon). */
const SECTION_OF: Record<string, string> = {
  products: 'catalog',
  prices: 'catalog',
  price_levels: 'catalog',
  categories: 'catalog',
  units: 'catalog',
  variant_options: 'catalog',
  roles: 'staff',
  payments: 'receipts',
  expenses: 'receipts',
  cash: 'receipts',
  vouchers: 'receipts',
  money_accounts: 'receipts',
  expense_categories: 'receipts',
  audit: 'system',
  presence: 'system',
};
const SECTIONS = [
  'dashboard',
  'sales',
  'purchases',
  'receipts',
  'parties',
  'delivery',
  'inventory',
  'catalog',
  'ledger',
  'branches',
  'staff',
  'analytics',
  'settings',
  'system',
];

type Tab = 'people' | 'roles';

const NO_PERMISSIONS: Permission[] = [];

/**
 * Staff & permissions (الموظفون والصلاحيات): who can sign in, their role and branch, and exactly
 * what each person may do (owner decision 2026-09-29: every action has its own permission).
 * People: add, edit, reset a password, deactivate, and tick or untick single permissions against
 * their role. Roles: change what a whole role may do. The server enforces the same safety rules
 * (no one grants what they don't hold, owners are protected, no self-lockout).
 */
export function StaffPage() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'roles' ? 'roles' : 'people';

  return (
    <div className="space-y-5">
      <PageHeader title={t('staff.title')} subtitle={t('staff.subtitle')} />
      <div
        role="tablist"
        className="inline-flex rounded-[var(--radius-app)] border border-line bg-surface p-1"
      >
        {(['people', 'roles'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setParams(k === 'roles' ? { tab: 'roles' } : {}, { replace: true })}
            className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
              tab === k ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
            }`}
          >
            {t(k === 'people' ? 'staff.people' : 'staff.roles')}
          </button>
        ))}
      </div>
      {tab === 'people' ? <PeopleTab /> : <RolesTab />}
    </div>
  );
}

// ------------------------------------------------------------------ people

function PeopleTab() {
  const { t } = useT();
  const can = useCan();
  const staff = useStaff();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const person = staff.data?.find((s) => s.id === selected) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="min-w-0 space-y-3">
        {can('staff:manage') &&
          (adding ? (
            <AddPerson
              onDone={(id) => {
                setAdding(false);
                if (id) setSelected(id);
              }}
            />
          ) : (
            <Button icon="plus" size="sm" onClick={() => setAdding(true)}>
              {t('staff.add')}
            </Button>
          ))}
        <Card padded={false} className="overflow-hidden">
          {staff.isLoading ? (
            <div className="grid place-items-center py-16 text-muted">
              <Spinner size={26} />
            </div>
          ) : (staff.data ?? []).length === 0 ? (
            <EmptyState title={t('common.empty')} icon="staff" />
          ) : (
            <ul className="divide-y divide-[var(--c-line)]">
              {(staff.data ?? []).map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => setSelected(s.id)}
                    className={`flex w-full items-center gap-3 p-3 text-start hover:bg-surface-2 ${
                      selected === s.id ? 'bg-brand-soft' : ''
                    } ${s.isActive ? '' : 'opacity-60'}`}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
                      <Icon name="staff" size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.fullName}</span>
                      <span className="block truncate text-xs text-muted" dir="ltr">
                        {s.email}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <Badge tone="brand">{t(`role.${s.role}`)}</Badge>
                      {!s.isActive && <Badge>{t('staff.inactive')}</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="min-w-0">
        {person ? (
          <PersonPanel key={person.id} person={person} />
        ) : (
          <Card>
            <EmptyState title={t('staff.pick')} icon="staff" />
          </Card>
        )}
      </div>
    </div>
  );
}

/** Roles the signed-in user may hand out (only an owner makes owners). */
function useAssignableRoles(): Role[] {
  const myRole = useAuth((s) => s.user?.role);
  return ROLES.filter((r) => r !== 'OWNER' || myRole === 'OWNER');
}

function AddPerson({ onDone }: { onDone: (id?: string) => void }) {
  const { t } = useT();
  const create = useCreateStaff();
  const branches = useBranches();
  const roles = useAssignableRoles();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: 'SALES' as Role,
    branchId: '',
  });
  const error = create.error as ApiError | null;
  const branchId = form.branchId || branches.data?.[0]?.id || '';

  async function save() {
    try {
      const created = await create.mutateAsync({
        ...form,
        branchId,
        phone: form.phone.trim() || undefined,
      });
      onDone(created.id);
    } catch {
      /* shown below */
    }
  }

  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('staff.name')}>
          <input
            className={field}
            autoFocus
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </Field>
        <Field label={t('staff.email')}>
          <input
            className={field}
            dir="ltr"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label={t('staff.role')}>
          <select
            className={field}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('staff.branch')}>
          <select
            className={field}
            value={branchId}
            onChange={(e) => setForm({ ...form, branchId: e.target.value })}
          >
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('staff.phone')}>
          <input
            className={field}
            dir="ltr"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>
        <Field label={t('staff.password')} hint={t('staff.passwordHint')}>
          <input
            className={field}
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
      </div>
      {error && <p className="text-xs text-destructive">{error.message}</p>}
      <div className="flex gap-2">
        <Button
          icon="check"
          loading={create.isPending}
          disabled={
            !form.fullName.trim() || !form.email.trim() || form.password.length < 8 || !branchId
          }
          onClick={save}
        >
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={() => onDone()}>
          {t('common.cancel')}
        </Button>
      </div>
    </Card>
  );
}

function PersonPanel({ person }: { person: StaffMember }) {
  const { t } = useT();
  const can = useCan();
  const myId = useAuth((s) => s.user?.id);
  const myRole = useAuth((s) => s.user?.role);
  const isMe = person.id === myId;
  const canManage = can('staff:manage') && (person.role !== 'OWNER' || myRole === 'OWNER');
  const update = useUpdateStaff();
  const branches = useBranches();
  const roles = useAssignableRoles();
  const [form, setForm] = useState({
    fullName: person.fullName,
    email: person.email,
    phone: person.phone ?? '',
    role: person.role,
    branchId: person.branchId,
  });
  const [password, setPassword] = useState('');
  const error = update.error as ApiError | null;

  async function run(input: Parameters<typeof update.mutateAsync>[0]['input']) {
    try {
      await update.mutateAsync({ id: person.id, input });
      setPassword('');
    } catch {
      /* shown below */
    }
  }

  const changed: Parameters<typeof update.mutateAsync>[0]['input'] = {};
  if (form.fullName.trim() !== person.fullName) changed.fullName = form.fullName.trim();
  if (form.email.trim().toLowerCase() !== person.email) changed.email = form.email.trim();
  if (form.phone.trim() !== (person.phone ?? '')) changed.phone = form.phone.trim();
  if (form.role !== person.role) changed.role = form.role;
  if (form.branchId !== person.branchId) changed.branchId = form.branchId;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{person.fullName}</h2>
          {isMe && <Badge tone="info">{t('staff.you')}</Badge>}
          {!person.isActive && <Badge>{t('staff.inactive')}</Badge>}
        </div>
        <fieldset disabled={!canManage} className="grid gap-3 sm:grid-cols-2">
          <Field label={t('staff.name')}>
            <input
              className={field}
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </Field>
          <Field label={t('staff.email')}>
            <input
              className={field}
              dir="ltr"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label={t('staff.role')}>
            <select
              className={field}
              value={form.role}
              disabled={isMe}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              {(roles.includes(person.role) ? roles : [person.role, ...roles]).map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('staff.branch')}>
            <select
              className={field}
              value={form.branchId}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
            >
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('staff.phone')}>
            <input
              className={field}
              dir="ltr"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
        </fieldset>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon="check"
              loading={update.isPending}
              disabled={Object.keys(changed).length === 0}
              onClick={() => run(changed)}
            >
              {t('common.save')}
            </Button>
            {!isMe && (
              <Button
                size="sm"
                variant={person.isActive ? 'ghost' : 'secondary'}
                loading={update.isPending}
                onClick={() => run({ isActive: !person.isActive })}
              >
                {person.isActive ? t('staff.deactivate') : t('staff.reactivate')}
              </Button>
            )}
          </div>
        )}
        {canManage && (
          <div className="grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label={t('staff.newPassword')} hint={t('staff.passwordHint')}>
              <input
                className={field}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button
              size="md"
              variant="secondary"
              loading={update.isPending}
              disabled={password.length < 8}
              onClick={() => run({ password })}
            >
              {t('staff.setPassword')}
            </Button>
          </div>
        )}
        {!canManage && <p className="text-xs text-muted">{t('staff.readonly')}</p>}
        {error && <p className="text-xs text-destructive">{error.message}</p>}
      </Card>
      <PersonPermissions person={person} />
    </div>
  );
}

/** Tick or untick single permissions for one person, against their role's set. */
function PersonPermissions({ person }: { person: StaffMember }) {
  const { t } = useT();
  const can = useCan();
  const myId = useAuth((s) => s.user?.id);
  const roles = useRoles();
  const catalog = usePermissionCatalog();
  const save = useSetStaffPermissions();
  const roleSet = useMemo(
    () => new Set<string>(roles.data?.find((r) => r.role === person.role)?.permissions ?? []),
    [roles.data, person.role],
  );
  const [granted, setGranted] = useState<Set<string>>(new Set(person.granted));
  const [revoked, setRevoked] = useState<Set<string>>(new Set(person.revoked));
  useEffect(() => {
    setGranted(new Set(person.granted));
    setRevoked(new Set(person.revoked));
  }, [person.granted, person.revoked]);

  const isOwner = person.role === 'OWNER';
  const editable = can('roles:manage') && !isOwner && person.id !== myId;
  const error = save.error as ApiError | null;
  const allowed = (p: string) => (roleSet.has(p) && !revoked.has(p)) || granted.has(p);
  const dirty =
    [...granted].sort().join() !== [...person.granted].sort().join() ||
    [...revoked].sort().join() !== [...person.revoked].sort().join();

  function toggle(p: string) {
    const g = new Set(granted);
    const r = new Set(revoked);
    if (allowed(p)) {
      if (roleSet.has(p)) r.add(p);
      g.delete(p);
    } else {
      if (roleSet.has(p)) r.delete(p);
      else g.add(p);
    }
    setGranted(g);
    setRevoked(r);
  }

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {t('staff.permissions')}
      </h2>
      {isOwner ? (
        <p className="text-sm text-muted">{t('staff.ownerAll')}</p>
      ) : (
        <>
          <p className="text-xs text-faint">{t('staff.permissionsHint')}</p>
          <PermissionChecklist
            catalog={catalog.data ?? []}
            isChecked={allowed}
            onToggle={toggle}
            disabled={!editable}
            mark={(p) => (granted.has(p) ? 'added' : revoked.has(p) ? 'removed' : null)}
          />
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                icon="check"
                loading={save.isPending}
                disabled={!dirty}
                onClick={() =>
                  save.mutate({
                    id: person.id,
                    input: { granted: [...granted], revoked: [...revoked] },
                  })
                }
              >
                {t('staff.savePermissions')}
              </Button>
              {save.isSuccess && !dirty && (
                <span className="text-xs text-positive">{t('staff.saved')}</span>
              )}
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error.message}</p>}
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ roles

function RolesTab() {
  const { t } = useT();
  const roles = useRoles();
  const [role, setRole] = useState<Role>('ACCOUNTANT');
  const info = roles.data?.find((r) => r.role === role);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {(roles.data ?? []).map((r) => (
          <button
            key={r.role}
            onClick={() => setRole(r.role)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
              role === r.role
                ? 'border-brand bg-brand text-brand-fg'
                : 'border-line bg-surface text-muted hover:text-fg'
            }`}
          >
            {t(`role.${r.role}`)}
            <span className="tnum text-xs opacity-80">{r.staff}</span>
          </button>
        ))}
      </div>
      {roles.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : info ? (
        <RoleEditor key={`${info.role}:${info.permissions.join()}`} info={info} />
      ) : null}
    </div>
  );
}

function RoleEditor({ info }: { info: RoleInfo }) {
  const { t } = useT();
  const can = useCan();
  const myRole = useAuth((s) => s.user?.role);
  const catalog = usePermissionCatalog();
  const update = useUpdateRole();
  const reset = useResetRole();
  const [set, setSet] = useState<Set<string>>(new Set(info.permissions));
  const editable = info.editable && can('roles:manage') && info.role !== myRole;
  const dirty = [...set].sort().join() !== [...info.permissions].sort().join();
  const error = (update.error ?? reset.error) as ApiError | null;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{t(`role.${info.role}`)}</h2>
        {info.custom && <Badge tone="warning">{t('staff.custom')}</Badge>}
        <span className="text-xs text-muted tnum">
          {t('staff.members')}: {info.staff}
        </span>
      </div>
      <p className="text-xs text-faint">
        {info.editable ? t('staff.roleHint') : t('staff.ownerAll')}
      </p>
      <PermissionChecklist
        catalog={catalog.data ?? []}
        isChecked={(p) => set.has(p)}
        onToggle={(p) => {
          const next = new Set(set);
          if (next.has(p)) next.delete(p);
          else next.add(p);
          setSet(next);
        }}
        disabled={!editable}
      />
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon="check"
            loading={update.isPending}
            disabled={!dirty}
            onClick={() => update.mutate({ role: info.role, permissions: [...set] })}
          >
            {t('staff.saveRole')}
          </Button>
          {info.custom && (
            <Button
              size="sm"
              variant="ghost"
              loading={reset.isPending}
              onClick={() => reset.mutate(info.role)}
            >
              {t('staff.resetRole')}
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </Card>
  );
}

// ------------------------------------------------------------------ shared

/**
 * Every permission, grouped by screen, as checkboxes. Permissions the signed-in user doesn't hold
 * can't be changed — the server refuses giving or taking what you don't have yourself.
 */
function PermissionChecklist({
  catalog,
  isChecked,
  onToggle,
  disabled,
  mark,
}: {
  catalog: PermissionInfo[];
  isChecked: (p: string) => boolean;
  onToggle: (p: string) => void;
  disabled: boolean;
  mark?: (p: string) => 'added' | 'removed' | null;
}) {
  const { t } = useT();
  const mine = useAuth((s) => s.user?.permissions ?? NO_PERMISSIONS);
  const sections = SECTIONS.map((section) => ({
    section,
    items: catalog.filter((p) => (SECTION_OF[p.group] ?? p.group) === section),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {sections.map(({ section, items }) => (
        <fieldset key={section} className="rounded-[var(--radius-app)] border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {t(`permGroup.${section}` as TranslationKey)}
          </legend>
          <ul className="space-y-1.5">
            {items.map((p) => {
              const flag = mark?.(p.key);
              const locked = disabled || !mine.includes(p.key as Permission);
              return (
                <li key={p.key}>
                  <label
                    className={`flex items-start gap-2 text-sm ${locked ? 'opacity-70' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={isChecked(p.key)}
                      disabled={locked}
                      title={!disabled && locked ? t('staff.cantGrant') : undefined}
                      onChange={() => onToggle(p.key)}
                    />
                    <span className="min-w-0 flex-1">
                      {t(`perm.${p.key}` as TranslationKey)}
                      {flag && (
                        <span
                          className={`ms-1.5 text-xs ${flag === 'added' ? 'text-positive' : 'text-destructive'}`}
                        >
                          ({t(flag === 'added' ? 'staff.added' : 'staff.removed')})
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs text-muted">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}
