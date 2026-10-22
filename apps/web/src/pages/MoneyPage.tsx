import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  METHOD_ACCOUNT_KINDS,
  formatDate,
  formatDateTime,
  formatMoney,
  toMajor,
  toMinor,
  type MoneyAccount,
  type MoneyAccountKind,
  type PaymentMethod,
  type TranslationKey,
  type Voucher,
  type VoucherType,
  companyToday,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { DocumentDateField, dayToSend } from '../components/DocumentDate';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { confirm } from '../lib/confirm';
import { useReportTools } from '../lib/report';
import { ReportActions } from '../components/ReportActions';
import { useAuth } from '../stores/auth';
import { useWorkBranch } from '../stores/workBranch';
import { codeName } from '../components/CodeName';
import {
  useAccountStatement,
  useCancelVoucher,
  useCreateMoneyAccount,
  useCreateCashTransfer,
  useCreateVoucher,
  useExpenseCategories,
  useMoneyAccounts,
  useOpenInvoices,
  useParties,
  useReps,
  useSaveExpenseCategory,
  useDeleteExpenseCategory,
  useUpdateMoneyAccount,
  useDeleteMoneyAccount,
  useVouchers,
  useWarehouses,
  type VoucherKind,
} from '../lib/queries';

type Tab = 'accounts' | 'vouchers' | 'categories';
const TABS: { key: Tab; label: TranslationKey }[] = [
  { key: 'accounts', label: 'money.tabAccounts' },
  { key: 'vouchers', label: 'money.tabVouchers' },
  { key: 'categories', label: 'money.tabCategories' },
];
const KINDS: MoneyAccountKind[] = ['CASH_BOX', 'CUSTODY', 'BANK', 'WALLET', 'POST'];
const METHODS: PaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'INSTAPAY', 'MOBILE_WALLET', 'POST'];
const VOUCHER_TYPES: VoucherType[] = ['RECEIPT', 'PAYMENT', 'EXPENSE', 'TRANSFER'];
const TYPE_TONE: Record<VoucherType, Tone> = {
  RECEIPT: 'positive',
  PAYMENT: 'warning',
  EXPENSE: 'destructive',
  TRANSFER: 'info',
  DISCOUNT: 'neutral',
  DISCOUNT_RECEIVED: 'neutral',
};
type NewForm = 'receipt' | 'payment' | 'expense' | 'transfer';
const FORM_KIND: Record<'receipt' | 'payment' | 'expense', VoucherKind> = {
  receipt: 'receipts',
  payment: 'payments',
  expense: 'expenses',
};

const input =
  'h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand disabled:opacity-60';
const small =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand disabled:opacity-60';

const today = companyToday;
const minor = (v: string) => (v.trim() === '' ? 0 : toMinor(Number(v) || 0));

/**
 * Cash & Banks (الخزينة والبنوك): the money accounts and their statements, vouchers (receipts,
 * payments, expenses, transfers) and expense categories. The server enforces every rule again.
 */
export function MoneyPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((x) => x.key === params.get('tab'))?.key ?? 'accounts') as Tab;
  const form = params.get('new') as NewForm | null;
  const presetParty = params.get('party') ?? '';

  const open = (next: NewForm | null) => {
    const p = new URLSearchParams(params);
    if (next) p.set('new', next);
    else {
      p.delete('new');
      p.delete('party');
    }
    setParams(p, { replace: true });
  };

  const actions: { key: NewForm; label: TranslationKey; perm: Parameters<typeof can>[0] }[] = [
    { key: 'receipt', label: 'money.voucher.RECEIPT', perm: 'receipts:create' },
    { key: 'payment', label: 'money.voucher.PAYMENT', perm: 'payments:create' },
    { key: 'expense', label: 'money.voucher.EXPENSE', perm: 'expenses:create' },
    { key: 'transfer', label: 'money.voucher.TRANSFER', perm: 'cash:transfer' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('money.title')}
        subtitle={t('money.subtitle')}
        action={
          <div className="flex flex-wrap gap-2">
            {/* The old program's withdraw / deposit: one screen for receipts, payments and transfers. */}
            {(can('receipts:create') || can('payments:create') || can('cash:transfer')) && (
              <Button size="sm" icon="receipts" onClick={() => navigate('/receipts/move')}>
                {t('move.button')}
              </Button>
            )}
            {actions
              .filter((a) => can(a.perm))
              .map((a) => (
                <Button
                  key={a.key}
                  size="sm"
                  variant="secondary"
                  icon="plus"
                  onClick={() => open(a.key)}
                >
                  {t(a.label)}
                </Button>
              ))}
          </div>
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
            onClick={() => {
              const p = new URLSearchParams(params);
              p.set('tab', x.key);
              setParams(p, { replace: true });
            }}
            className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
              tab === x.key ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
            }`}
          >
            {t(x.label)}
          </button>
        ))}
      </div>

      {tab === 'accounts' && <AccountsTab />}
      {tab === 'vouchers' && <VouchersTab />}
      {tab === 'categories' && <CategoriesTab />}

      {(form === 'receipt' || form === 'payment' || form === 'expense') && (
        <VoucherFormSheet kind={form} presetParty={presetParty} onClose={() => open(null)} />
      )}
      {form === 'transfer' && <TransferSheet onClose={() => open(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- shared */

function Loading() {
  return (
    <div className="grid place-items-center py-16 text-muted">
      <Spinner size={26} />
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

function AccountSelect({
  accounts,
  value,
  onChange,
  method,
  placeholder,
}: {
  accounts: MoneyAccount[];
  value: string;
  onChange: (id: string) => void;
  method?: PaymentMethod;
  placeholder: string;
}) {
  const { t, locale } = useT();
  const kinds = method ? METHOD_ACCOUNT_KINDS[method] : null;
  const list = accounts.filter((a) => a.isActive && (!kinds || kinds.includes(a.kind)));
  return (
    <select className={small} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} · {t(`money.kind.${a.kind}`)} · {formatMoney(a.balance, a.currency, locale)}
        </option>
      ))}
    </select>
  );
}

/* -------------------------------------------------------------- accounts */

function AccountsTab() {
  const { t } = useT();
  const can = useCan();
  const { data, isLoading } = useMoneyAccounts();
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MoneyAccount | null>(null);
  const [statement, setStatement] = useState<MoneyAccount | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, MoneyAccount[]>();
    for (const a of data ?? []) {
      if (!a.isActive && !showClosed) continue;
      m.set(a.branchName, [...(m.get(a.branchName) ?? []), a]);
    }
    return [...m.entries()];
  }, [data, showClosed]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          {t('money.showClosed')}
        </label>
        {can('money_accounts:manage') && (
          <Button icon="plus" size="sm" onClick={() => setAdding(true)}>
            {t('money.addAccount')}
          </Button>
        )}
      </div>
      {isLoading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState title={t('money.noAccounts')} icon="receipts" />
        </Card>
      ) : (
        groups.map(([branch, accounts]) => (
          <section key={branch} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted">{branch}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {accounts.map((a) => (
                <AccountCard
                  key={a.id}
                  a={a}
                  onStatement={() => setStatement(a)}
                  onEdit={can('money_accounts:manage') ? () => setEditing(a) : undefined}
                />
              ))}
            </div>
          </section>
        ))
      )}
      {adding && <AddAccountSheet accounts={data ?? []} onClose={() => setAdding(false)} />}
      {editing && (
        <EditAccountSheet key={editing.id} a={editing} onClose={() => setEditing(null)} />
      )}
      {statement && <StatementSheet a={statement} onClose={() => setStatement(null)} />}
    </div>
  );
}

function AccountCard({
  a,
  onStatement,
  onEdit,
}: {
  a: MoneyAccount;
  onStatement: () => void;
  onEdit?: () => void;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const detail = [a.bankName, a.number, a.custodianName].filter(Boolean).join(' · ');
  return (
    <Card className={a.isActive ? '' : 'opacity-70'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{a.name}</p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            <Badge tone="brand">{t(`money.kind.${a.kind}`)}</Badge>
            {a.isMain && <Badge tone="info">{t('money.main')}</Badge>}
            {a.isDefault && <Badge tone="positive">{t('money.default')}</Badge>}
            {a.warehouseName && <Badge tone="neutral">{a.warehouseName}</Badge>}
            {!a.isActive && <Badge tone="warning">{t('money.closed')}</Badge>}
          </div>
          {detail && (
            <p className="mt-1 truncate text-xs text-muted" dir="auto">
              {detail}
            </p>
          )}
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
          <Icon name="receipts" size={20} />
        </span>
      </div>
      <p className="mt-3 text-xl font-semibold tnum">
        {formatMoney(a.balance, a.currency, locale)}
      </p>
      {!!a.held && (
        <p className="text-xs text-warning tnum">
          {t('money.held')}: {formatMoney(a.held, a.currency, locale)}
        </p>
      )}
      {a.upToName && (
        <p className="mt-1 truncate text-xs text-muted">
          {t('money.upTo')}: {a.upToName}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onStatement}>
          {t('money.statement')}
        </Button>
        {a.upToId && a.isActive && can('cash:handover_send') && (
          <Button size="sm" variant="ghost" onClick={() => navigate(`/handovers?from=${a.id}`)}>
            {t('hand.send')}
          </Button>
        )}
        {a.upToId && a.isActive && a.balance > 0 && can('cash:transfer') && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/receipts/move?from=${a.id}&to=${a.upToId}`)}
          >
            {t('hand.pull')}
          </Button>
        )}
        {onEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            {t('common.edit')}
          </Button>
        )}
      </div>
    </Card>
  );
}

function AddAccountSheet({ accounts, onClose }: { accounts: MoneyAccount[]; onClose: () => void }) {
  const { t } = useT();
  const user = useAuth((s) => s.user);
  const create = useCreateMoneyAccount();
  const reps = useReps();
  const workBranch = useWorkBranch();
  const branches = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.branchId, a.branchName);
    return [...m.entries()];
  }, [accounts]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<MoneyAccountKind>('CASH_BOX');
  const [branchId, setBranchId] = useState(workBranch || user?.branchId || branches[0]?.[0] || '');
  const [custodianId, setCustodianId] = useState('');
  const [number, setNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [opening, setOpening] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [isMain, setIsMain] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const can = useCan();
  const warehouses = useWarehouses(true);
  const branchStores = (warehouses.data ?? []).filter((w) => w.branchId === branchId);

  async function save() {
    try {
      await create.mutateAsync({
        name: name.trim(),
        kind,
        branchId,
        custodianId: kind === 'CUSTODY' ? custodianId || undefined : undefined,
        number: number.trim() || undefined,
        bankName: kind === 'BANK' ? bankName.trim() || undefined : undefined,
        openingBalance: minor(opening),
        isDefault: kind === 'CASH_BOX' ? isDefault : undefined,
        isMain: kind === 'CASH_BOX' && isMain ? true : undefined,
        warehouseId: kind === 'CASH_BOX' && warehouseId ? warehouseId : undefined,
      });
      onClose();
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet title={t('money.addAccount')} onClose={onClose} closeLabel={t('common.close')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t('common.name')}>
            <input
              className={input}
              value={name}
              maxLength={200}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('money.kind')}>
          <select
            className={input}
            value={kind}
            onChange={(e) => setKind(e.target.value as MoneyAccountKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`money.kind.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('money.branch')}>
          <select className={input} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        {kind === 'CUSTODY' && (
          <Field label={t('money.custodian')}>
            <select
              className={input}
              value={custodianId}
              onChange={(e) => setCustodianId(e.target.value)}
            >
              <option value="">{t('money.pickParty')}</option>
              {(reps.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {codeName(r.code, r.name)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {kind === 'BANK' && (
          <Field label={t('money.bankName')}>
            <input
              className={input}
              value={bankName}
              maxLength={100}
              onChange={(e) => setBankName(e.target.value)}
            />
          </Field>
        )}
        {kind !== 'CASH_BOX' && kind !== 'CUSTODY' && (
          <Field label={t('money.number')}>
            <input
              className={input}
              dir="ltr"
              value={number}
              maxLength={40}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
        )}
        <Field label={t('money.opening')}>
          <input
            className={`${input} tnum`}
            type="number"
            min={0}
            step="0.01"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
          />
        </Field>
        {kind === 'CASH_BOX' && (
          <Field label={t('money.ofWarehouse')}>
            <select
              className={input}
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">{t('money.noWarehouse')}</option>
              {branchStores.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {kind === 'CASH_BOX' && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            {t('money.makeDefault')}
          </label>
        )}
        {kind === 'CASH_BOX' && can('money_accounts:main') && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={isMain} onChange={(e) => setIsMain(e.target.checked)} />
            {t('money.makeMain')}
          </label>
        )}
      </div>
      {create.error && (
        <p className="mt-3 text-sm text-destructive">{errorText(t, create.error)}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          icon="check"
          loading={create.isPending}
          disabled={!name.trim() || !branchId || minor(opening) < 0}
          onClick={() => void save()}
        >
          {t('common.save')}
        </Button>
      </div>
    </Sheet>
  );
}

function EditAccountSheet({ a, onClose }: { a: MoneyAccount; onClose: () => void }) {
  const { t } = useT();
  const update = useUpdateMoneyAccount();
  const remove = useDeleteMoneyAccount();
  const [name, setName] = useState(a.name);
  const [number, setNumber] = useState(a.number ?? '');
  const [bankName, setBankName] = useState(a.bankName ?? '');
  const [opening, setOpening] = useState('');
  const [warehouseId, setWarehouseId] = useState(a.warehouseId ?? '');
  const can = useCan();
  const warehouses = useWarehouses(true);
  const branchStores = (warehouses.data ?? []).filter((w) => w.branchId === a.branchId);

  async function run(input: Parameters<typeof update.mutateAsync>[0]['input']) {
    try {
      await update.mutateAsync({ id: a.id, input });
      onClose();
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet title={t('money.editAccount')} onClose={onClose} closeLabel={t('common.close')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t('common.name')}>
            <input
              className={input}
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
        {a.kind === 'BANK' && (
          <Field label={t('money.bankName')}>
            <input
              className={input}
              value={bankName}
              maxLength={100}
              onChange={(e) => setBankName(e.target.value)}
            />
          </Field>
        )}
        {a.kind !== 'CASH_BOX' && a.kind !== 'CUSTODY' && (
          <Field label={t('money.number')}>
            <input
              className={input}
              dir="ltr"
              value={number}
              maxLength={40}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
        )}
        {a.kind === 'CASH_BOX' && !a.isDefault && !a.isMain && (
          <Field label={t('money.ofWarehouse')}>
            <select
              className={input}
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">{t('money.noWarehouse')}</option>
              {branchStores.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {!a.hasMovements && a.isActive && (
        <div className="mt-3">
          <Field label={t('money.opening')}>
            <input
              className={`${input} tnum`}
              type="number"
              min={0}
              step="0.01"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
          </Field>
        </div>
      )}
      {update.error && (
        <p className="mt-3 text-sm text-destructive">{errorText(t, update.error)}</p>
      )}
      {remove.error && (
        <p className="mt-3 text-sm text-destructive">{errorText(t, remove.error)}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {a.kind === 'CASH_BOX' && a.isActive && !a.isDefault && (
            <Button
              size="sm"
              variant="secondary"
              disabled={update.isPending}
              onClick={() => void run({ isDefault: true })}
            >
              {t('money.makeDefault')}
            </Button>
          )}
          {a.kind === 'CASH_BOX' && a.isActive && !a.isMain && can('money_accounts:main') && (
            <Button
              size="sm"
              variant="secondary"
              disabled={update.isPending}
              onClick={() => void run({ isMain: true })}
            >
              {t('money.makeMain')}
            </Button>
          )}
          {a.isActive ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={update.isPending || a.balance !== 0 || a.isDefault || !!a.isMain}
              title={t('money.closeHint')}
              onClick={() => void run({ isActive: false })}
            >
              {t('money.close')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={update.isPending}
              onClick={() => void run({ isActive: true })}
            >
              {t('money.reopen')}
            </Button>
          )}
          {/* Delete an account that no money has gone through yet (owner, 2026-10-14: moved here from
              the cash-move screen). The default and main boxes can't be deleted. */}
          {can('money_accounts:manage') && !a.isDefault && !a.isMain && !a.hasMovements && (
            <Button
              size="sm"
              variant="dangerGhost"
              disabled={remove.isPending}
              onClick={async () => {
                if (!(await confirm({ message: t('move.deleteAccountAsk'), danger: true }))) return;
                try {
                  await remove.mutateAsync(a.id);
                  onClose();
                } catch {
                  /* shown below */
                }
              }}
            >
              {t('move.deleteAccount')}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon="check"
            loading={update.isPending}
            disabled={!name.trim()}
            onClick={() =>
              void run({
                name: name.trim(),
                number: a.kind !== 'CASH_BOX' && a.kind !== 'CUSTODY' ? number : undefined,
                bankName: a.kind === 'BANK' ? bankName : undefined,
                openingBalance: !a.hasMovements && minor(opening) > 0 ? minor(opening) : undefined,
                warehouseId:
                  a.kind === 'CASH_BOX' && warehouseId !== (a.warehouseId ?? '')
                    ? warehouseId
                    : undefined,
              })
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function StatementSheet({ a, onClose }: { a: MoneyAccount; onClose: () => void }) {
  const { t } = useT();
  return (
    <Sheet
      title={`${t('money.statement')} — ${a.name}`}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide
    >
      <MoneyStatementBody a={a} />
    </Sheet>
  );
}

/** A cash box's or bank's statement between two days; also on the statement page (كشف الحساب). */
export function MoneyStatementBody({ a }: { a: MoneyAccount }) {
  const { t, locale } = useT();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const { data, isLoading, error } = useAccountStatement(a.id, from, to);
  const money = (v: number) => formatMoney(v, a.currency, locale);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="order-last ms-auto">
          <ReportActions
            disabled={!data}
            onPrint={() =>
              report.print(
                paper.current,
                `${t('money.statement')} — ${a.name}`,
                `${formatDate(from, locale)} – ${formatDate(to, locale)}`,
              )
            }
          />
        </div>
        <Field label={t('money.from')}>
          <input
            className={small}
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label={t('money.to')}>
          <input
            className={small}
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{errorText(t, error)}</p>}
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div ref={paper}>
          <dl className="mt-4 grid grid-cols-2 gap-2 rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm sm:grid-cols-4">
            {(
              [
                ['money.openingBal', data.opening, ''],
                ['money.in', data.totalIn, 'text-positive'],
                ['money.out', data.totalOut, 'text-destructive'],
                ['money.closing', data.closing, 'font-semibold'],
              ] as const
            ).map(([k, v, cls]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted">{t(k)}</dt>
                <dd className={`tnum ${cls}`}>{money(v)}</dd>
              </div>
            ))}
          </dl>
          {data.movements.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t('money.noMovements')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {data.movements.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t(`money.move.${m.kind}`)}
                      {m.method && m.kind !== 'OPENING' && (
                        <span className="text-xs font-normal text-muted">
                          {' '}
                          · {t(`money.method.${m.method}`)}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[m.reference, m.partyName, m.methodReference, m.notes]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="text-xs text-faint">
                      {formatDateTime(m.createdAt, locale)} · {m.createdByName}
                    </p>
                  </div>
                  <div className="shrink-0 text-end tnum">
                    <p className={m.amount >= 0 ? 'text-positive' : 'text-destructive'}>
                      <span aria-hidden="true">{m.amount >= 0 ? '+' : '−'}</span>
                      <bdi>{money(Math.abs(m.amount))}</bdi>
                    </p>
                    <p className="text-xs text-muted">{money(m.balanceAfter)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------- vouchers */

function VouchersTab() {
  const { t, locale, rtl } = useT();
  const [type, setType] = useState<VoucherType | ''>('');
  const [branchId, setBranchId] = useState('');
  const myBranches = useAuth((s) => s.user?.branches ?? []);
  const { data, isLoading } = useVouchers({
    type: type || undefined,
    branchId: branchId || undefined,
  });
  const [open, setOpen] = useState<Voucher | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {myBranches.length > 1 && (
          <label className="block shrink-0">
            <span className="mb-0.5 block text-xs text-muted">{t('list.branch')}</span>
            <select
              className="h-8 rounded-full border border-line bg-surface px-3 text-xs"
              aria-label={t('list.branch')}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">{t('common.all')}</option>
              {myBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {(['', ...VOUCHER_TYPES] as (VoucherType | '')[]).map((x) => (
          <button
            key={x || 'all'}
            type="button"
            aria-pressed={type === x}
            onClick={() => setType(x)}
            className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
              type === x
                ? 'border-brand bg-brand-soft text-brand'
                : 'border-line text-muted hover:text-fg'
            }`}
          >
            {x ? t(`money.voucher.${x}`) : t('money.all')}
          </button>
        ))}
      </div>
      {isLoading ? (
        <Loading />
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('money.noVouchers')} icon="receipts" />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {data.items.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setOpen(v)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={TYPE_TONE[v.type]}>{t(`money.voucher.${v.type}`)}</Badge>
                      {v.status === 'CANCELLED' && (
                        <Badge tone="neutral">{t('money.status.CANCELLED')}</Badge>
                      )}
                      <span className="text-xs text-muted tnum">{v.number}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm font-medium">{voucherTitle(v, rtl)}</p>
                    <p className="text-xs text-faint">
                      {formatDate(v.createdAt, locale)} · {v.createdByName}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-semibold tnum ${v.status === 'CANCELLED' ? 'text-faint line-through' : ''}`}
                  >
                    {formatMoney(v.amount, v.currency, locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {open && <VoucherSheet v={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Who or what a voucher is for; a transfer reads "from → to" in the screen's direction. */
function voucherTitle(v: Voucher, rtl: boolean): string {
  const iso = (x: string | null) => `⁨${x ?? ''}⁩`; // keep each name's own direction
  if (v.type === 'TRANSFER')
    return `${iso(v.fromAccountName)} ${rtl ? '←' : '→'} ${iso(v.toAccountName)}`;
  if (v.type === 'EXPENSE') return v.categoryName ?? '';
  return v.partyName ? codeName(v.partyCode, v.partyName) : '';
}

function VoucherSheet({ v, onClose }: { v: Voucher; onClose: () => void }) {
  const { t, locale, rtl } = useT();
  const can = useCan();
  const cancel = useCancelVoucher();
  const money = (x: number) => formatMoney(x, v.currency, locale);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const formal = t(`voucher.print.${v.type}` as TranslationKey);

  return (
    <Sheet
      title={`${t(`money.voucher.${v.type}`)} ${v.number}`}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <div ref={paper} className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={v.status === 'CANCELLED' ? 'neutral' : 'positive'}>
              {t(`money.status.${v.status}`)}
            </Badge>
            <Badge tone="brand">{v.branchName}</Badge>
          </div>
          <ReportActions
            onPrint={() =>
              report.print(
                paper.current,
                `${formal} ${v.number}`,
                formatDateTime(v.createdAt, locale),
              )
            }
          />
        </div>
        <p className="font-medium">{voucherTitle(v, rtl)}</p>
        <p className="text-2xl font-semibold tnum">{money(v.amount)}</p>
        {v.lines.length > 0 && (
          <ul className="divide-y divide-line rounded-[var(--radius-app)] border border-line">
            {v.lines.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">
                  {t(`money.method.${l.method}`)} · {l.accountName}
                  {l.reference && <span className="text-xs text-muted"> · {l.reference}</span>}
                </span>
                <span className="tnum">{money(l.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {v.allocations.length > 0 && (
          <div>
            <p className="mb-1 text-xs text-muted">{t('money.invoices')}</p>
            <ul className="space-y-1">
              {v.allocations.map((a) => (
                <li key={a.documentId} className="flex justify-between tnum">
                  <span>{a.number}</span>
                  <span>{money(a.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(v.type === 'RECEIPT' || v.type === 'PAYMENT') && v.unallocated > 0 && (
          <p className="text-muted">
            {t('money.onAccount')}: <span className="tnum">{money(v.unallocated)}</span>
          </p>
        )}
        {v.notes && <p className="text-muted">{v.notes}</p>}
        <p className="text-xs text-faint">
          {formatDateTime(v.createdAt, locale)} · {t('money.createdBy')} {v.createdByName}
          {v.cancelledAt && (
            <>
              {' '}
              · {t('money.status.CANCELLED')} {formatDateTime(v.cancelledAt, locale)}{' '}
              {v.cancelledByName}
            </>
          )}
        </p>
        {/* Signatures: only on paper. */}
        <div className="hidden grid-cols-2 gap-8 pt-10 text-xs print:grid">
          <p className="border-t border-line pt-1 text-center">
            {v.type === 'RECEIPT'
              ? t('voucher.signPayer')
              : v.type === 'TRANSFER'
                ? t('voucher.signReceiver')
                : t('voucher.signPayee')}
          </p>
          <p className="border-t border-line pt-1 text-center">{t('voucher.signCashier')}</p>
        </div>
        {cancel.error && <p className="text-destructive">{errorText(t, cancel.error)}</p>}
        {v.status === 'POSTED' && can('vouchers:cancel') && (
          <div data-noprint className="border-t border-line pt-3">
            <p className="mb-2 text-xs text-muted">{t('money.cancelHint')}</p>
            <Button
              variant="danger"
              size="sm"
              loading={cancel.isPending}
              onClick={async () => {
                try {
                  await cancel.mutateAsync(v.id);
                  onClose();
                } catch {
                  /* shown above */
                }
              }}
            >
              {t('money.cancelVoucher')}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

interface LineDraft {
  method: PaymentMethod;
  accountId: string;
  amount: string;
  reference: string;
}

/** A receipt, a payment or an expense: who / what for, how it was paid, and the invoices it settles. */
function VoucherFormSheet({
  kind,
  presetParty,
  onClose,
}: {
  kind: 'receipt' | 'payment' | 'expense';
  presetParty: string;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const accounts = useMoneyAccounts();
  const parties = useParties({ page: 1, pageSize: 100, active: true, enabled: kind !== 'expense' });
  const categories = useExpenseCategories(kind === 'expense');
  const create = useCreateVoucher();
  const [partyId, setPartyId] = useState(presetParty);
  const [categoryId, setCategoryId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([
    { method: 'CASH', accountId: '', amount: '', reference: '' },
  ]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  // The oldest invoices are settled first by themselves (owner, 2026-10-02: no button needed);
  // typing an amount on an invoice takes over until "back to oldest first".
  const [allocTouched, setAllocTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [docDate, setDocDate] = useState(companyToday);
  const side = kind === 'payment' ? 'purchases' : 'sales';
  const open = useOpenInvoices(partyId, side, kind !== 'expense');

  const list = accounts.data ?? [];
  const defaultBox = list.find((a) => a.isDefault && a.isActive);
  // Cash goes to the branch's cash box unless another is picked.
  useEffect(() => {
    if (defaultBox)
      setLines((cur) =>
        cur.map((l, i) =>
          i === 0 && l.method === 'CASH' && !l.accountId ? { ...l, accountId: defaultBox.id } : l,
        ),
      );
  }, [defaultBox]);
  const total = lines.reduce((s, l) => s + minor(l.amount), 0);
  const allocated = Object.values(alloc).reduce((s, v) => s + minor(v), 0);
  const invoices = (open.data ?? []).filter((o) => kind === 'payment' || !o.onCodParcel);
  const overAllocated = allocated > total;
  const overInvoice = invoices.some((o) => minor(alloc[o.documentId] ?? '') > o.outstanding);
  const currency = list[0]?.currency ?? 'EGP';
  const money = (v: number) => formatMoney(v, currency, locale);
  const linesOk = lines.every((l) => l.accountId && minor(l.amount) > 0);
  const canSave =
    linesOk &&
    total > 0 &&
    (kind === 'expense' ? !!categoryId : !!partyId) &&
    !overAllocated &&
    !overInvoice;

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function autoAllocate() {
    let left = total;
    const next: Record<string, string> = {};
    for (const o of invoices) {
      if (left <= 0) break;
      const take = Math.min(left, o.outstanding);
      next[o.documentId] = String(toMajor(take));
      left -= take;
    }
    setAlloc(next);
  }

  const openKey = invoices.map((o) => `${o.documentId}:${o.outstanding}`).join();
  useEffect(() => {
    if (!allocTouched) autoAllocate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, openKey, allocTouched]);

  async function save() {
    try {
      await create.mutateAsync({
        kind: FORM_KIND[kind],
        input: {
          partyId: kind === 'expense' ? undefined : partyId,
          categoryId: kind === 'expense' ? categoryId : undefined,
          lines: lines.map((l) => ({
            method: l.method,
            accountId: l.accountId,
            amount: minor(l.amount),
            reference: l.reference.trim() || undefined,
          })),
          allocations:
            kind === 'expense'
              ? undefined
              : Object.entries(alloc)
                  .map(([documentId, v]) => ({ documentId, amount: minor(v) }))
                  .filter((a) => a.amount > 0),
          notes: notes.trim() || undefined,
          documentDate: dayToSend(docDate),
        },
      });
      onClose();
    } catch {
      /* shown below */
    }
  }

  const title = t(
    kind === 'receipt'
      ? 'money.voucher.RECEIPT'
      : kind === 'payment'
        ? 'money.voucher.PAYMENT'
        : 'money.voucher.EXPENSE',
  );

  return (
    <Sheet title={title} onClose={onClose} closeLabel={t('common.close')} wide>
      <div className="space-y-4">
        {kind === 'expense' ? (
          <Field label={t('money.category')}>
            <select
              className={input}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{t('money.pickCategory')}</option>
              {(categories.data ?? [])
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentName ? `${c.parentName} › ${c.name}` : c.name}
                  </option>
                ))}
            </select>
          </Field>
        ) : (
          <Field label={t('money.party')}>
            <select
              className={input}
              value={partyId}
              onChange={(e) => {
                setPartyId(e.target.value);
                setAlloc({});
                setAllocTouched(false);
              }}
            >
              <option value="">{t('money.pickParty')}</option>
              {(parties.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {codeName(p.code, p.name)}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div>
          <p className="mb-1 text-xs text-muted">{t('money.lines')}</p>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div
                key={i}
                className="grid gap-2 rounded-[var(--radius-app)] border border-line p-2 sm:grid-cols-[9rem_1fr_8rem]"
              >
                <select
                  className={small}
                  aria-label={t('money.method')}
                  value={l.method}
                  onChange={(e) =>
                    setLine(i, { method: e.target.value as PaymentMethod, accountId: '' })
                  }
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`money.method.${m}`)}
                    </option>
                  ))}
                </select>
                <AccountSelect
                  accounts={list}
                  method={l.method}
                  value={l.accountId}
                  onChange={(id) => setLine(i, { accountId: id })}
                  placeholder={t('money.pickAccount')}
                />
                <input
                  className={`${small} tnum`}
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label={t('money.amount')}
                  placeholder={t('money.amount')}
                  value={l.amount}
                  onChange={(e) => setLine(i, { amount: e.target.value })}
                />
                {l.method !== 'CASH' && (
                  <input
                    className={`${small} sm:col-span-2`}
                    dir="ltr"
                    maxLength={60}
                    placeholder={t('money.reference')}
                    value={l.reference}
                    onChange={(e) => setLine(i, { reference: e.target.value })}
                  />
                )}
                {lines.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="close"
                    aria-label={t('common.delete')}
                    onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            {lines.length < 10 && (
              <Button
                variant="ghost"
                size="sm"
                icon="plus"
                onClick={() =>
                  setLines((cur) => [
                    ...cur,
                    { method: 'CASH', accountId: '', amount: '', reference: '' },
                  ])
                }
              >
                {t('money.addLine')}
              </Button>
            )}
            <span className="text-sm font-semibold tnum">
              {t('money.total')}: {money(total)}
            </span>
          </div>
        </div>

        {kind !== 'expense' && partyId && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs text-muted">{t('money.invoices')}</p>
              {allocTouched ? (
                <Button variant="ghost" size="sm" onClick={() => setAllocTouched(false)}>
                  {t('cheque.backToOldest')}
                </Button>
              ) : (
                invoices.length > 0 && (
                  <span className="text-xs text-muted">{t('cheque.oldestFirst')}</span>
                )
              )}
            </div>
            {open.isLoading ? (
              <Loading />
            ) : invoices.length === 0 ? (
              <p className="rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm text-muted">
                {t('money.noOpenInvoices')}
              </p>
            ) : (
              <ul className="max-h-60 space-y-1 overflow-auto rounded-[var(--radius-app)] border border-line p-2">
                {invoices.map((o) => (
                  <li
                    key={o.documentId}
                    className="grid grid-cols-[1fr_7rem] items-center gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      <span className="tnum">{o.number}</span>
                      <span className="text-xs text-muted">
                        {' '}
                        · {formatDate(o.issueDate, locale)} · {t('money.outstanding')}{' '}
                        {money(o.outstanding)}
                      </span>
                    </span>
                    <input
                      className={`${small} tnum`}
                      type="number"
                      min={0}
                      step="0.01"
                      aria-label={o.number}
                      aria-invalid={minor(alloc[o.documentId] ?? '') > o.outstanding}
                      value={alloc[o.documentId] ?? ''}
                      onChange={(e) => {
                        setAllocTouched(true);
                        setAlloc((cur) => ({ ...cur, [o.documentId]: e.target.value }));
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
            <p className={`mt-1 text-xs ${overAllocated ? 'text-destructive' : 'text-muted'}`}>
              {overAllocated
                ? t('money.overAllocated')
                : `${t('money.onAccount')}: ${money(Math.max(0, total - allocated))}`}
            </p>
          </div>
        )}

        <DocumentDateField value={docDate} onChange={setDocDate} />
        <Field label={t('invoice.notes')}>
          <input
            className={input}
            value={notes}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {create.error && <p className="text-sm text-destructive">{errorText(t, create.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon="check"
            loading={create.isPending}
            disabled={!canSave}
            onClick={() => void save()}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function TransferSheet({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const accounts = useMoneyAccounts();
  const create = useCreateCashTransfer();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [docDate, setDocDate] = useState(companyToday);
  const list = accounts.data ?? [];

  async function save() {
    try {
      await create.mutateAsync({
        fromAccountId: from,
        toAccountId: to,
        amount: minor(amount),
        notes: notes.trim() || undefined,
        documentDate: dayToSend(docDate),
      });
      onClose();
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet title={t('money.voucher.TRANSFER')} onClose={onClose} closeLabel={t('common.close')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('money.fromAccount')}>
          <AccountSelect
            accounts={list}
            value={from}
            onChange={setFrom}
            placeholder={t('money.pickAccount')}
          />
        </Field>
        <Field label={t('money.toAccount')}>
          <AccountSelect
            accounts={list.filter((a) => a.id !== from)}
            value={to}
            onChange={setTo}
            placeholder={t('money.pickAccount')}
          />
        </Field>
        <Field label={t('money.amount')}>
          <input
            className={`${input} tnum`}
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <DocumentDateField value={docDate} onChange={setDocDate} />
        <Field label={t('invoice.notes')}>
          <input
            className={input}
            value={notes}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
      {create.error && (
        <p className="mt-3 text-sm text-destructive">{errorText(t, create.error)}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          icon="check"
          loading={create.isPending}
          disabled={!from || !to || from === to || minor(amount) <= 0}
          onClick={() => void save()}
        >
          {t('common.save')}
        </Button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ categories */

function CategoriesTab() {
  const { t } = useT();
  const can = useCan();
  const { data, isLoading } = useExpenseCategories();
  const save = useSaveExpenseCategory();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const canManage = can('expense_categories:manage');
  const mains = (data ?? []).filter((c) => !c.parentId);

  async function add() {
    try {
      await save.mutateAsync({ input: { name: name.trim(), parentId: parentId || undefined } });
      setName('');
    } catch {
      /* shown below */
    }
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <Card className="grid gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
          <Field label={t('common.name')}>
            <input
              className={input}
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t('money.subOf')}>
            <select
              className={input}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">{t('money.mainCategory')}</option>
              {mains
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Button
            icon="plus"
            loading={save.isPending}
            disabled={!name.trim()}
            onClick={() => void add()}
          >
            {t('money.addCategory')}
          </Button>
          {save.error && (
            <p className="text-sm text-destructive sm:col-span-3">{errorText(t, save.error)}</p>
          )}
        </Card>
      )}
      {isLoading ? (
        <Loading />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {mains.map((m) => (
              <li key={m.id} className="px-4 py-2">
                <CategoryRow c={m} canManage={canManage} mains={mains} />
                {(data ?? [])
                  .filter((c) => c.parentId === m.id)
                  .map((c) => (
                    <div key={c.id} className="ms-5 border-s border-line ps-3">
                      <CategoryRow c={c} canManage={canManage} mains={mains} />
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** An expense item: renamed, moved under another main item, closed or deleted (owner, 2026-10-22). */
function CategoryRow({
  c,
  canManage,
  mains,
}: {
  c: { id: string; name: string; isActive: boolean; parentId?: string | null };
  canManage: boolean;
  mains: { id: string; name: string; isActive: boolean }[];
}) {
  const { t } = useT();
  const save = useSaveExpenseCategory();
  const remove = useDeleteExpenseCategory();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [parentId, setParentId] = useState(c.parentId ?? '');
  const isMain = !c.parentId;

  async function submit() {
    try {
      await save.mutateAsync({
        id: c.id,
        input: {
          name: name.trim(),
          ...(isMain && !parentId ? {} : { parentId }),
        },
      });
      setEditing(false);
    } catch {
      /* shown below */
    }
  }

  async function del() {
    if (!(await confirm({ message: t('setup.deleteEntryAsk'), danger: true }))) return;
    try {
      await remove.mutateAsync(c.id);
    } catch {
      /* shown below */
    }
  }

  const error = save.error ?? remove.error;
  return (
    <div className="py-1 text-sm">
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
          <Field label={t('common.name')}>
            <input
              className={input}
              value={name}
              maxLength={200}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t('money.subOf')}>
            <select
              className={input}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">{t('money.mainCategory')}</option>
              {mains
                .filter((m) => m.id !== c.id && (m.isActive || m.id === parentId))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              icon="check"
              loading={save.isPending}
              disabled={!name.trim()}
              onClick={() => void submit()}
            >
              {t('common.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={c.isActive ? '' : 'text-faint line-through'}>{c.name}</span>
          {canManage && (
            <span className="flex flex-wrap gap-1">
              <Button
                variant="ghost"
                size="sm"
                icon="edit"
                onClick={() => {
                  setName(c.name);
                  setParentId(c.parentId ?? '');
                  setEditing(true);
                }}
              >
                {t('common.edit')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={save.isPending}
                onClick={() => save.mutate({ id: c.id, input: { isActive: !c.isActive } })}
              >
                {c.isActive ? t('money.stopCategory') : t('money.useCategory')}
              </Button>
              <Button
                variant="dangerGhost"
                size="sm"
                icon="trash"
                loading={remove.isPending}
                onClick={() => void del()}
              >
                {t('common.delete')}
              </Button>
            </span>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{errorText(t, error)}</p>}
    </div>
  );
}
