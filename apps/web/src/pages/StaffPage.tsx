import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ROLES,
  formatNumber,
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
import {
  PhoneInput,
  PhoneList,
  anyIdProblem,
  useCompanyCountry,
  type NamedPhone,
} from '../components/PhoneFields';
import { useCan } from '../lib/can';
import { ApiError, api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useAuth } from '../stores/auth';
import {
  useBranches,
  useCreateStaff,
  useDepartments,
  useMoneyAccounts,
  useSetStaffAccess,
  usePermissionCatalog,
  useResetRole,
  useRoles,
  useSetStaffPermissions,
  useStaff,
  useCreateRole,
  useDeleteCustomRole,
  useUpdateCustomRole,
  useUpdateRole,
  useUpdateStaff,
  useDeleteStaff,
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
  backup: 'system',
  costs: 'system',
  payroll: 'payroll',
  employees: 'payroll',
  attendance: 'payroll',
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
  'notes',
  'ledger',
  'branches',
  'staff',
  'analytics',
  'payroll',
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
  const { t, locale } = useT();
  const can = useCan();
  const staff = useStaff();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const person = staff.data?.find((s) => s.id === selected) ?? null;

  // Where each person works: every branch, or how many; and whether their warehouses or cash boxes are narrowed.
  const accessSummary = (s: StaffMember) =>
    [
      s.seesAllBranches
        ? t('access.summaryAll')
        : s.branchIds.length === 0
          ? t('access.summaryOne')
          : `${t('access.summarySome')} ${formatNumber(s.branchIds.length + 1, locale)}`,
      s.warehouseIds.length > 0 &&
        `${t('access.limitedWarehouses')} ${formatNumber(s.warehouseIds.length, locale)}`,
      s.moneyAccountIds.length > 0 &&
        `${t('access.limitedAccounts')} ${formatNumber(s.moneyAccountIds.length, locale)}`,
    ]
      .filter(Boolean)
      .join(' · ');

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
                      <span className="block truncate font-medium">
                        {s.fullName}
                        <span className="ms-1.5 text-xs font-normal text-muted tnum">
                          ({s.code})
                        </span>
                      </span>
                      <span className="block truncate text-xs text-muted" dir="ltr">
                        {s.email}
                      </span>
                      <span className="block truncate text-xs text-faint">{accessSummary(s)}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <Badge tone="brand">{s.customRoleName ?? t(`role.${s.role}`)}</Badge>
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

/** A role picked in a form: a built-in one ("SALES") or one the company made ("custom:<id>"). */
const CUSTOM = 'custom:';
const roleKeyOf = (p: { role: Role; customRoleId?: string | null }) =>
  p.customRoleId ? `${CUSTOM}${p.customRoleId}` : p.role;

/** What a role key means for the API: the role it works like and the made role, if any. */
function useRoleKeys() {
  const roles = useRoles();
  const made = (roles.data ?? []).filter((r) => !!r.id);
  return {
    made,
    resolve: (key: string): { role: Role; customRoleId: string } => {
      if (!key.startsWith(CUSTOM)) return { role: key as Role, customRoleId: '' };
      const id = key.slice(CUSTOM.length);
      return { role: made.find((r) => r.id === id)?.role ?? 'VIEWER', customRoleId: id };
    },
  };
}

/** The built-in roles and the company's own, as one list. */
function RoleOptions({ builtIn, made }: { builtIn: Role[]; made: RoleInfo[] }) {
  const { t } = useT();
  return (
    <>
      {builtIn.map((r) => (
        <option key={r} value={r}>
          {t(`role.${r}`)}
        </option>
      ))}
      {made.length > 0 && (
        <optgroup label={t('staff.madeRole')}>
          {made.map((r) => (
            <option key={r.id} value={`${CUSTOM}${r.id}`}>
              {r.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

function AddPerson({ onDone }: { onDone: (id?: string) => void }) {
  const { t } = useT();
  const create = useCreateStaff();
  const branches = useBranches();
  const roles = useAssignableRoles();
  const keys = useRoleKeys();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: 'SALES' as string,
    branchId: '',
  });
  const [others, setOthers] = useState<NamedPhone[]>([]);
  const [remember, setRemember] = useState(false);
  const country = useCompanyCountry();
  const canKeep = useCan()('staff:password_note');
  const error = create.error as ApiError | null;
  const branchId = form.branchId || branches.data?.[0]?.id || '';
  const filled = others.filter((x) => x.phone.trim());
  const idBad = anyIdProblem(country, [form.phone, ...filled.map((x) => x.phone)]);

  async function save() {
    try {
      const created = await create.mutateAsync({
        ...form,
        ...keys.resolve(form.role),
        branchId,
        phone: form.phone.trim() || undefined,
        otherPhones: filled.map((x) => x.phone.trim()),
        otherPhoneLabels: filled.map((x) => x.label.trim()),
        rememberPassword: remember || undefined,
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
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <RoleOptions builtIn={roles} made={keys.made} />
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
        <PhoneInput
          value={form.phone}
          onChange={(phone) => setForm({ ...form, phone })}
          label={t('staff.phone')}
        />
        <Field label={t('staff.password')} hint={t('staff.passwordHint')}>
          <input
            className={field}
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <PhoneList value={others} onChange={setOthers} listId="staff-new-phone-kinds" />
        {canKeep && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            {t('staff.rememberPassword')}
          </label>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error.message}</p>}
      <div className="flex gap-2">
        <Button
          icon="check"
          loading={create.isPending}
          disabled={
            !form.fullName.trim() ||
            !form.email.trim() ||
            form.password.length < 8 ||
            !branchId ||
            idBad
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
  const keys = useRoleKeys();
  const [form, setForm] = useState({
    fullName: person.fullName,
    email: person.email,
    phone: person.phone ?? '',
    role: roleKeyOf(person) as string,
    branchId: person.branchId,
  });
  const [password, setPassword] = useState('');
  const [others, setOthers] = useState<NamedPhone[]>(
    (person.otherPhones ?? []).map((phone, i) => ({
      phone,
      label: person.otherPhoneLabels?.[i] ?? '',
    })),
  );
  const [remember, setRemember] = useState(!!person.hasPasswordNote);
  const [shown, setShown] = useState<string | null>(null);
  const country = useCompanyCountry();
  const canKeep = can('staff:password_note');
  const remove = useDeleteStaff();
  const error = (update.error ?? remove.error) as ApiError | null;
  const filled = others.filter((x) => x.phone.trim());
  const idBad = anyIdProblem(country, [form.phone, ...filled.map((x) => x.phone)]);

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
  if (form.role !== roleKeyOf(person)) Object.assign(changed, keys.resolve(form.role));
  if (form.branchId !== person.branchId) changed.branchId = form.branchId;
  const othersNow = filled.map((x) => `${x.phone.trim()}|${x.label.trim()}`).join();
  const othersBefore = (person.otherPhones ?? [])
    .map((p, i) => `${p}|${person.otherPhoneLabels?.[i] ?? ''}`)
    .join();
  if (othersNow !== othersBefore) {
    changed.otherPhones = filled.map((x) => x.phone.trim());
    changed.otherPhoneLabels = filled.map((x) => x.label.trim());
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{person.fullName}</h2>
          <span className="text-sm text-muted tnum">
            {t('common.code')} {person.code}
          </span>
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
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <RoleOptions
                builtIn={roles.includes(person.role) ? roles : [person.role, ...roles]}
                made={keys.made}
              />
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
          <PhoneInput
            value={form.phone}
            onChange={(phone) => setForm({ ...form, phone })}
            label={t('staff.phone')}
          />
          <PhoneList
            value={others}
            onChange={setOthers}
            listId={`staff-${person.id}-phone-kinds`}
          />
        </fieldset>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon="check"
              loading={update.isPending}
              disabled={Object.keys(changed).length === 0 || idBad}
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
            {!isMe && person.role !== 'OWNER' && (
              <Button
                size="sm"
                variant="ghost"
                icon="close"
                loading={remove.isPending}
                onClick={async () => {
                  if (!window.confirm(t('staff.deleteAsk'))) return;
                  try {
                    await remove.mutateAsync(person.id);
                  } catch {
                    /* shown below */
                  }
                }}
              >
                {t('staff.delete')}
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
              onClick={() => run({ password, ...(canKeep ? { rememberPassword: remember } : {}) })}
            >
              {t('staff.setPassword')}
            </Button>
            {canKeep && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                {t('staff.rememberPassword')}
              </label>
            )}
          </div>
        )}
        {/* The kept password, read on demand (and logged), shown until hidden (owner, 2026-10-02). */}
        {canKeep && person.hasPasswordNote && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button
              size="sm"
              variant="ghost"
              icon={shown ? 'eyeOff' : 'eye'}
              onClick={async () => {
                if (shown) return setShown(null);
                try {
                  setShown(
                    (await api.get<{ password: string }>(`/staff/${person.id}/password-note`))
                      .password,
                  );
                } catch {
                  setShown(null);
                }
              }}
            >
              {shown ? t('staff.hidePassword') : t('staff.showPassword')}
            </Button>
            {shown && (
              <code dir="ltr" className="rounded bg-surface-2 px-2 py-1 font-mono">
                {shown}
              </code>
            )}
          </div>
        )}
        {!canManage && <p className="text-xs text-muted">{t('staff.readonly')}</p>}
        {error && <p className="text-xs text-destructive">{error.message}</p>}
      </Card>
      <PersonAccess person={person} />
      <PersonPermissions person={person} />
    </div>
  );
}

type BranchMode = 'role' | 'all' | 'some';

/**
 * Which branches one person works in and, within them, which warehouses and money accounts they
 * may use (DOMAIN.md §2.1). The server refuses anything the editor doesn't have themselves.
 */
function PersonAccess({ person }: { person: StaffMember }) {
  const { t } = useT();
  const can = useCan();
  const myId = useAuth((s) => s.user?.id);
  const branchList = useBranches();
  const accountList = useMoneyAccounts(can('receipts:view'));
  const departmentList = useDepartments();
  const save = useSetStaffAccess();

  const initial = () => ({
    mode: (person.allBranches == null ? 'role' : person.allBranches ? 'all' : 'some') as BranchMode,
    branches: new Set(person.branchIds),
    warehouses: new Set(person.warehouseIds),
    accounts: new Set(person.moneyAccountIds),
    someWarehouses: person.warehouseIds.length > 0,
    someAccounts: person.moneyAccountIds.length > 0,
    departments: new Set(person.departmentIds ?? []),
    someDepartments: (person.departmentIds ?? []).length > 0,
    maxDiscount: person.maxDiscountPercent == null ? '' : String(person.maxDiscountPercent),
  });
  const [f, setF] = useState(initial);
  useEffect(() => {
    setF(initial());
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    person.id,
    person.allBranches,
    person.branchIds,
    person.warehouseIds,
    person.moneyAccountIds,
    person.departmentIds,
    person.maxDiscountPercent,
  ]);

  const isOwner = person.role === 'OWNER';
  const editable = can('staff:access') && !isOwner && person.id !== myId;
  const roleAll = person.role === 'ADMIN' || person.role === 'ACCOUNTANT';
  const all = f.mode === 'all' || (f.mode === 'role' && roleAll);
  const branches = (branchList.data ?? []).filter(
    (b) => all || b.id === person.branchId || f.branches.has(b.id),
  );
  const inTheirs = new Set(branches.map((b) => b.id));
  const stores = branches.flatMap((b) =>
    b.warehouses.filter((w) => w.kind === 'STORE').map((w) => ({ ...w, branchName: b.name })),
  );
  const accounts = (accountList.data ?? []).filter((a) => inTheirs.has(a.branchId));
  const showBranch = branches.length > 1;

  const pickedWarehouses = stores.filter((w) => f.warehouses.has(w.id)).map((w) => w.id);
  const pickedAccounts = accounts.filter((a) => f.accounts.has(a.id)).map((a) => a.id);
  const departments = (departmentList.data ?? []).filter(
    (d) => d.isActive || f.departments.has(d.id),
  );
  const pickedDepartments = departments.filter((d) => f.departments.has(d.id)).map((d) => d.id);
  const maxDiscount = f.maxDiscount.trim() === '' ? null : Number(f.maxDiscount);
  const badDiscount =
    maxDiscount !== null &&
    !(Number.isInteger(maxDiscount) && maxDiscount >= 0 && maxDiscount <= 100);
  const input = {
    allBranches: f.mode === 'role' ? null : f.mode === 'all',
    branchIds: f.mode === 'some' ? [...f.branches].filter((id) => id !== person.branchId) : [],
    warehouseIds: f.someWarehouses ? pickedWarehouses : [],
    moneyAccountIds: f.someAccounts ? pickedAccounts : [],
    departmentIds: f.someDepartments ? pickedDepartments : [],
    maxDiscountPercent: badDiscount ? null : maxDiscount,
  };
  const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
  const dirty =
    input.allBranches !== (person.allBranches ?? null) ||
    !same(input.branchIds, person.branchIds) ||
    !same(input.warehouseIds, person.warehouseIds) ||
    !same(input.moneyAccountIds, person.moneyAccountIds) ||
    !same(input.departmentIds, person.departmentIds ?? []) ||
    input.maxDiscountPercent !== (person.maxDiscountPercent ?? null);
  const missing =
    (f.someWarehouses && pickedWarehouses.length === 0) ||
    (f.someAccounts && pickedAccounts.length === 0) ||
    (f.someDepartments && pickedDepartments.length === 0);

  const toggle = (key: 'branches' | 'warehouses' | 'accounts' | 'departments', id: string) =>
    setF((s) => {
      const next = new Set(s[key]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...s, [key]: next };
    });

  const box = 'flex items-center gap-2 py-1 text-sm';
  const radio = (checked: boolean, onChange: () => void, label: string) => (
    <label className={box}>
      <input type="radio" checked={checked} disabled={!editable} onChange={onChange} />
      <span>{label}</span>
    </label>
  );

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {t('access.title')}
      </h2>
      {isOwner ? (
        <p className="text-sm text-muted">{t('access.ownerAll')}</p>
      ) : (
        <>
          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs font-medium text-muted">{t('access.branches')}</legend>
            {radio(
              f.mode === 'role',
              () => setF((s) => ({ ...s, mode: 'role' })),
              roleAll ? t('access.byRoleAll') : t('access.byRoleOwn'),
            )}
            {radio(f.mode === 'all', () => setF((s) => ({ ...s, mode: 'all' })), t('access.all'))}
            {radio(
              f.mode === 'some',
              () => setF((s) => ({ ...s, mode: 'some' })),
              t('access.some'),
            )}
            {f.mode === 'some' && (
              <div className="ms-6 grid gap-x-4 sm:grid-cols-2">
                {(branchList.data ?? []).map((b) => (
                  <label key={b.id} className={box}>
                    <input
                      type="checkbox"
                      disabled={!editable || b.id === person.branchId}
                      checked={b.id === person.branchId || f.branches.has(b.id)}
                      onChange={() => toggle('branches', b.id)}
                    />
                    <span className="min-w-0 truncate">
                      <bdi>{b.name}</bdi>
                      {b.id === person.branchId ? ` (${t('access.own')})` : ''}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs font-medium text-muted">
              {t('access.warehouses')}
            </legend>
            {radio(
              !f.someWarehouses,
              () => setF((s) => ({ ...s, someWarehouses: false })),
              t('access.everyOne'),
            )}
            {radio(
              f.someWarehouses,
              () => setF((s) => ({ ...s, someWarehouses: true })),
              t('access.onlyTicked'),
            )}
            {f.someWarehouses && (
              <div className="ms-6 grid gap-x-4 sm:grid-cols-2">
                {stores.map((w) => (
                  <label key={w.id} className={box}>
                    <input
                      type="checkbox"
                      disabled={!editable}
                      checked={f.warehouses.has(w.id)}
                      onChange={() => toggle('warehouses', w.id)}
                    />
                    <span className="min-w-0 truncate">
                      <bdi>{w.name}</bdi>
                      {showBranch && (
                        <>
                          {' · '}
                          <bdi>{w.branchName}</bdi>
                        </>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {can('receipts:view') && (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-xs font-medium text-muted">
                {t('access.moneyAccounts')}
              </legend>
              {radio(
                !f.someAccounts,
                () => setF((s) => ({ ...s, someAccounts: false })),
                t('access.everyOne'),
              )}
              {radio(
                f.someAccounts,
                () => setF((s) => ({ ...s, someAccounts: true })),
                t('access.onlyTicked'),
              )}
              {f.someAccounts && (
                <div className="ms-6 grid gap-x-4 sm:grid-cols-2">
                  {accounts.map((a) => (
                    <label key={a.id} className={box}>
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={f.accounts.has(a.id)}
                        onChange={() => toggle('accounts', a.id)}
                      />
                      <span className="min-w-0 truncate">
                        <bdi>{a.name}</bdi>
                        {showBranch && (
                          <>
                            {' · '}
                            <bdi>{a.branchName}</bdi>
                          </>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          {departments.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-xs font-medium text-muted">
                {t('access.departments')}
              </legend>
              {radio(
                !f.someDepartments,
                () => setF((s) => ({ ...s, someDepartments: false })),
                t('access.everyDepartment'),
              )}
              {radio(
                f.someDepartments,
                () => setF((s) => ({ ...s, someDepartments: true })),
                t('access.onlyTicked'),
              )}
              {f.someDepartments && (
                <div className="ms-6 grid gap-x-4 sm:grid-cols-2">
                  {departments.map((d) => (
                    <label key={d.id} className={box}>
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={f.departments.has(d.id)}
                        onChange={() => toggle('departments', d.id)}
                      />
                      <span className="min-w-0 truncate">
                        <bdi>{d.name}</bdi>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          <label className="block max-w-xs">
            <span className="mb-0.5 block text-xs font-medium text-muted">
              {t('access.maxDiscount')}
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              disabled={!editable}
              value={f.maxDiscount}
              onChange={(e) => setF((s) => ({ ...s, maxDiscount: e.target.value }))}
              className="h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand tnum"
            />
            {badDiscount && (
              <span className="mt-0.5 block text-xs text-destructive">
                {t('error.bad_percent')}
              </span>
            )}
          </label>

          {missing && <p className="text-xs text-warning">{t('access.pickOne')}</p>}
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                icon="check"
                loading={save.isPending}
                disabled={!dirty || missing || badDiscount}
                onClick={() => save.mutate({ id: person.id, input })}
              >
                {t('common.save')}
              </Button>
              {save.isSuccess && !dirty && (
                <span className="text-xs text-positive">{t('access.saved')}</span>
              )}
            </div>
          )}
          {save.error && <p className="text-xs text-destructive">{errorText(t, save.error)}</p>}
        </>
      )}
    </Card>
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
    () =>
      new Set<string>(
        (person.customRoleId
          ? roles.data?.find((r) => r.id === person.customRoleId)
          : roles.data?.find((r) => r.role === person.role && !r.id)
        )?.permissions ?? [],
      ),
    [roles.data, person.role, person.customRoleId],
  );
  const [granted, setGranted] = useState<Set<string>>(new Set(person.granted));
  const [revoked, setRevoked] = useState<Set<string>>(new Set(person.revoked));
  useEffect(() => {
    setGranted(new Set(person.granted));
    setRevoked(new Set(person.revoked));
  }, [person.granted, person.revoked]);

  const isOwner = person.role === 'OWNER' || (person.role === 'ADMIN' && !person.customRoleId);
  const editable = can('roles:manage') && !isOwner && person.id !== myId;
  const error = save.error as ApiError | null;
  const allowed = (p: string) => (roleSet.has(p) && !revoked.has(p)) || granted.has(p);
  const dirty =
    [...granted].sort().join() !== [...person.granted].sort().join() ||
    [...revoked].sort().join() !== [...person.revoked].sort().join();

  function toggle(p: string) {
    setMany([p], !allowed(p));
  }
  /** Give (on) or take (off) several at once, e.g. the supply-price switch. */
  function setMany(keys: string[], on: boolean) {
    const g = new Set(granted);
    const r = new Set(revoked);
    for (const p of keys) {
      if (on) {
        if (roleSet.has(p)) r.delete(p);
        else g.add(p);
      } else {
        if (roleSet.has(p)) r.add(p);
        g.delete(p);
      }
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
          <PermissionChecklist
            catalog={catalog.data ?? []}
            isChecked={allowed}
            onToggle={toggle}
            onSetMany={setMany}
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
  const can = useCan();
  const roles = useRoles();
  // A built-in role by name, a made one by id, or "new".
  const [pick, setPick] = useState<string>('ACCOUNTANT');
  const keyOf = (r: RoleInfo) => r.id ?? r.role;
  const info = roles.data?.find((r) => keyOf(r) === pick);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {(roles.data ?? []).map((r) => (
          <button
            key={keyOf(r)}
            onClick={() => setPick(keyOf(r))}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
              pick === keyOf(r)
                ? 'border-brand bg-brand text-brand-fg'
                : r.id
                  ? 'border-dashed border-brand/50 bg-surface text-fg hover:border-brand'
                  : 'border-line bg-surface text-muted hover:text-fg'
            }`}
          >
            {r.name ?? t(`role.${r.role}`)}
            <span className="tnum text-xs opacity-80">{r.staff}</span>
          </button>
        ))}
        {can('roles:manage') && (
          <Button size="sm" icon="plus" variant="secondary" onClick={() => setPick('new')}>
            {t('staff.newRole')}
          </Button>
        )}
      </div>
      {roles.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : pick === 'new' ? (
        <NewRole roles={roles.data ?? []} onDone={(id) => setPick(id ?? 'ACCOUNTANT')} />
      ) : info ? (
        <RoleEditor
          key={`${keyOf(info)}:${info.permissions.join()}:${info.name ?? ''}`}
          info={info}
          onDeleted={() => setPick('ACCOUNTANT')}
        />
      ) : null}
    </div>
  );
}

/** Make a role: its name, the built-in role it works like, and what it may do. */
function NewRole({ roles, onDone }: { roles: RoleInfo[]; onDone: (id?: string) => void }) {
  const { t } = useT();
  const catalog = usePermissionCatalog();
  const create = useCreateRole();
  const builtIn = useAssignableRoles().filter((r) => r !== 'OWNER');
  const [name, setName] = useState('');
  const [base, setBase] = useState<Role>('SALES');
  const [set, setSet] = useState<Set<string>>(
    () => new Set(roles.find((r) => r.role === 'SALES' && !r.id)?.permissions ?? []),
  );
  const mine = useAuth((s) => s.user?.permissions ?? NO_PERMISSIONS);
  const error = create.error as ApiError | null;

  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('staff.roleName')}>
          <input
            className={field}
            autoFocus
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t('staff.basedOn')} hint={t('staff.basedOnHint')}>
          <select className={field} value={base} onChange={(e) => setBase(e.target.value as Role)}>
            {builtIn.map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('staff.copyFrom')}>
          <select
            className={field}
            defaultValue=""
            onChange={(e) => {
              const from = roles.find((r) => (r.id ?? r.role) === e.target.value);
              // Only what the maker holds can go in it.
              if (from) setSet(new Set(from.permissions.filter((p) => mine.includes(p))));
            }}
          >
            <option value="" disabled>
              —
            </option>
            {roles
              .filter((r) => r.role !== 'OWNER' || r.id)
              .map((r) => (
                <option key={r.id ?? r.role} value={r.id ?? r.role}>
                  {r.name ?? t(`role.${r.role}`)}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setSet(
              new Set(
                (catalog.data ?? [])
                  .map((p) => p.key)
                  .filter((p) => mine.includes(p as Permission)),
              ),
            )
          }
        >
          {t('staff.selectAll')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSet(new Set())}>
          {t('staff.selectNone')}
        </Button>
      </div>
      <PermissionChecklist
        catalog={catalog.data ?? []}
        isChecked={(p) => set.has(p)}
        onToggle={(p) =>
          setSet((cur) => {
            const next = new Set(cur);
            if (next.has(p)) next.delete(p);
            else next.add(p);
            return next;
          })
        }
        disabled={false}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          icon="check"
          loading={create.isPending}
          disabled={!name.trim()}
          onClick={async () => {
            try {
              const made = await create.mutateAsync({
                name: name.trim(),
                baseRole: base,
                permissions: [...set],
              });
              onDone(made.id ?? undefined);
            } catch {
              /* shown below */
            }
          }}
        >
          {t('staff.createRole')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone()}>
          {t('common.cancel')}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </Card>
  );
}

function RoleEditor({ info, onDeleted }: { info: RoleInfo; onDeleted: () => void }) {
  const { t } = useT();
  const can = useCan();
  const me = useAuth((s) => s.user);
  const catalog = usePermissionCatalog();
  const update = useUpdateRole();
  const reset = useResetRole();
  const updateMade = useUpdateCustomRole();
  const remove = useDeleteCustomRole();
  const made = !!info.id;
  const [set, setSet] = useState<Set<string>>(new Set(info.permissions));
  const [name, setName] = useState(info.name ?? '');
  const mine = made ? me?.roleName === info.name : info.role === me?.role && !me?.roleName;
  const editable = info.editable && can('roles:manage') && !mine;
  const dirty =
    [...set].sort().join() !== [...info.permissions].sort().join() ||
    (made && name.trim() !== info.name);
  const error = (update.error ??
    reset.error ??
    updateMade.error ??
    remove.error) as ApiError | null;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {made && editable ? (
          <input
            className={`${field} max-w-60 font-semibold`}
            aria-label={t('staff.roleName')}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          <h2 className="text-base font-semibold">{info.name ?? t(`role.${info.role}`)}</h2>
        )}
        {made && (
          <Badge tone="brand">
            {t('staff.basedOn')}: {t(`role.${info.role}`)}
          </Badge>
        )}
        {!made && info.custom && <Badge tone="warning">{t('staff.custom')}</Badge>}
        <span className="text-xs text-muted tnum">
          {t('staff.members')}: {info.staff}
        </span>
      </div>
      {!info.editable && <p className="text-xs text-faint">{t('staff.ownerAll')}</p>}
      <PermissionChecklist
        catalog={catalog.data ?? []}
        isChecked={(p) => set.has(p)}
        onToggle={(p) =>
          setSet((cur) => {
            const next = new Set(cur);
            if (next.has(p)) next.delete(p);
            else next.add(p);
            return next;
          })
        }
        disabled={!editable}
      />
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon="check"
            loading={update.isPending || updateMade.isPending}
            disabled={!dirty || (made && !name.trim())}
            onClick={() =>
              made
                ? updateMade.mutate({
                    id: info.id!,
                    input: { name: name.trim(), permissions: [...set] },
                  })
                : update.mutate({ role: info.role, permissions: [...set] })
            }
          >
            {t('staff.saveRole')}
          </Button>
          {!made && info.custom && (
            <Button
              size="sm"
              variant="ghost"
              loading={reset.isPending}
              onClick={() => reset.mutate(info.role)}
            >
              {t('staff.resetRole')}
            </Button>
          )}
          {made && (
            <Button
              size="sm"
              variant="ghost"
              loading={remove.isPending}
              disabled={info.staff > 0}
              onClick={async () => {
                try {
                  await remove.mutateAsync(info.id!);
                  onDeleted();
                } catch {
                  /* shown below */
                }
              }}
            >
              {t('staff.deleteRole')}
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </Card>
  );
}

// ------------------------------------------------------------------ shared

/** Supply prices, profit and what shows them: one switch in the permissions (owner, 2026-10-02). */
const COST_BUNDLE: Permission[] = [
  'costs:view',
  'sales:price_basis',
  'products:card_purchases',
  'products:card_prices',
];

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
  onSetMany,
}: {
  catalog: PermissionInfo[];
  isChecked: (p: string) => boolean;
  onToggle: (p: string) => void;
  /** Turn several on or off together (else each is toggled in turn). */
  onSetMany?: (keys: string[], on: boolean) => void;
  disabled: boolean;
  mark?: (p: string) => 'added' | 'removed' | null;
}) {
  const { t } = useT();
  const mine = useAuth((s) => s.user?.permissions ?? NO_PERMISSIONS);
  const sections = SECTIONS.map((section) => ({
    section,
    items: catalog.filter((p) => (SECTION_OF[p.group] ?? p.group) === section),
  })).filter((s) => s.items.length > 0);

  // Supply prices, profit and everything near them, given or taken in one go (owner, 2026-10-02).
  const bundle = COST_BUNDLE.filter((k) => catalog.some((p) => p.key === k));
  const bundleOn = bundle.filter((k) => isChecked(k)).length;
  const bundleLocked = disabled || bundle.some((k) => !mine.includes(k));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {bundle.length > 0 && (
        <label
          className={`flex items-start gap-2.5 rounded-[var(--radius-app)] border border-brand/40 bg-brand-soft/40 p-3 text-sm md:col-span-2 ${bundleLocked ? 'opacity-70' : 'cursor-pointer'}`}
        >
          <input
            type="checkbox"
            className="mt-0.5"
            checked={bundleOn === bundle.length}
            ref={(el) => {
              if (el) el.indeterminate = bundleOn > 0 && bundleOn < bundle.length;
            }}
            disabled={bundleLocked}
            onChange={() => {
              const on = bundleOn !== bundle.length;
              const change = bundle.filter((k) => isChecked(k) !== on);
              if (onSetMany) onSetMany(change, on);
              else change.forEach((k) => onToggle(k));
            }}
          />
          <span>
            <span className="block font-semibold">{t('staff.costBundle')}</span>
            <span className="block text-xs text-muted">
              {bundle.map((k) => t(`perm.${k}` as TranslationKey)).join(' · ')}
            </span>
          </span>
        </label>
      )}
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
