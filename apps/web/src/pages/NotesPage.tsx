import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  toMajor,
  toMinor,
  type Note,
  type NoteDirection,
  type NoteKind,
  type NoteStatus,
  type TranslationKey,
  companyToday,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import {
  useCreateNote,
  useDepositNotes,
  useMoneyAccounts,
  useNotes,
  useNotesSummary,
  useNoteStep,
  useOpenInvoices,
  useParties,
  usePortfolios,
  type NoteStep,
} from '../lib/queries';

type Tab = 'receivable' | 'payable' | 'portfolios';
const TABS: { key: Tab; label: TranslationKey }[] = [
  { key: 'receivable', label: 'notes.tabReceivable' },
  { key: 'payable', label: 'notes.tabPayable' },
  { key: 'portfolios', label: 'notes.tabPortfolios' },
];
const RECEIVABLE_STATUSES: NoteStatus[] = [
  'IN_HAND',
  'UNDER_COLLECTION',
  'COLLECTED',
  'BOUNCED',
  'ENDORSED',
  'CANCELLED',
];
const PAYABLE_STATUSES: NoteStatus[] = ['ISSUED', 'PAID', 'BOUNCED', 'CANCELLED'];
const TONE: Record<NoteStatus, Tone> = {
  IN_HAND: 'brand',
  UNDER_COLLECTION: 'info',
  COLLECTED: 'positive',
  BOUNCED: 'destructive',
  ENDORSED: 'neutral',
  CANCELLED: 'neutral',
  ISSUED: 'warning',
  PAID: 'positive',
};

const input =
  'h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand disabled:opacity-60';
const small =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';
const minor = (v: string) => (v.trim() === '' ? 0 : toMinor(Number(v) || 0));
const today = companyToday;

/**
 * Cheques & promissory notes (الأوراق المالية): what we hold (receivable) and what we issued
 * (payable), their steps, and the portfolios lodged at banks. The server checks every step again.
 */
export function NotesPage() {
  const { t } = useT();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((x) => x.key === params.get('tab'))?.key ?? 'receivable') as Tab;
  const [creating, setCreating] = useState<NoteDirection | null>(null);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('notes.title')}
        subtitle={t('notes.subtitle')}
        action={
          <div className="flex flex-wrap gap-2">
            {can('notes:receive') && (
              <Button size="sm" icon="plus" onClick={() => setCreating('RECEIVABLE')}>
                {t('notes.receive')}
              </Button>
            )}
            {can('notes:issue') && (
              <Button
                size="sm"
                variant="secondary"
                icon="plus"
                onClick={() => setCreating('PAYABLE')}
              >
                {t('notes.issue')}
              </Button>
            )}
          </div>
        }
      />
      <Summary />
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
      {tab === 'receivable' && <NotesTab direction="RECEIVABLE" />}
      {tab === 'payable' && <NotesTab direction="PAYABLE" />}
      {tab === 'portfolios' && <PortfoliosTab />}
      {creating && <CreateSheet direction={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

function Loading() {
  return (
    <div className="grid place-items-center py-16 text-muted">
      <Spinner size={26} />
    </div>
  );
}

function Summary() {
  const { t, locale } = useT();
  const { data } = useNotesSummary();
  if (!data) return null;
  const m = (v: number) => formatMoney(v, data.currency, locale);
  const card = (title: TranslationKey, open: number, overdue: number, week: number) => (
    <Card className="!p-3">
      <p className="text-xs text-muted">{t(title)}</p>
      <p className="text-lg font-semibold tnum">{m(open)}</p>
      <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
        <span className={overdue > 0 ? 'text-destructive' : 'text-muted'}>
          {t('notes.overdue')}: <span className="tnum">{m(overdue)}</span>
        </span>
        <span className="text-muted">
          {t('notes.dueWeek')}: <span className="tnum">{m(week)}</span>
        </span>
      </p>
    </Card>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {card(
        'notes.tabReceivable',
        data.receivableOpen,
        data.receivableOverdue,
        data.receivableDueWeek,
      )}
      {card('notes.tabPayable', data.payableOpen, data.payableOverdue, data.payableDueWeek)}
    </div>
  );
}

/* ------------------------------------------------------------ lists */

function NotesTab({ direction }: { direction: NoteDirection }) {
  const { t, locale } = useT();
  const can = useCan();
  const [status, setStatus] = useState<NoteStatus | ''>('');
  const { data, isLoading } = useNotes({ direction, status: status || undefined });
  const [open, setOpen] = useState<Note | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [depositing, setDepositing] = useState(false);
  const statuses = direction === 'RECEIVABLE' ? RECEIVABLE_STATUSES : PAYABLE_STATUSES;
  const canDeposit = direction === 'RECEIVABLE' && can('notes:deposit');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(['', ...statuses] as (NoteStatus | '')[]).map((s) => (
            <button
              key={s || 'all'}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
                status === s
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-line text-muted hover:text-fg'
              }`}
            >
              {s ? t(`notes.status.${s}`) : t('notes.all')}
            </button>
          ))}
        </div>
        {canDeposit && picked.length > 0 && (
          <Button size="sm" onClick={() => setDepositing(true)}>
            {t('notes.depositSelected')} ({picked.length})
          </Button>
        )}
      </div>
      {isLoading ? (
        <Loading />
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('notes.empty')} icon="notes" />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {data.items.map((n) => (
              <li key={n.id} className="flex items-center gap-2 px-3 hover:bg-surface-2">
                {canDeposit && (
                  <input
                    type="checkbox"
                    aria-label={n.ref}
                    disabled={n.status !== 'IN_HAND'}
                    checked={picked.includes(n.id)}
                    onChange={() =>
                      setPicked((cur) =>
                        cur.includes(n.id) ? cur.filter((x) => x !== n.id) : [...cur, n.id],
                      )
                    }
                  />
                )}
                <button
                  type="button"
                  onClick={() => setOpen(n)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 text-start"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={TONE[n.status]}>{t(`notes.status.${n.status}`)}</Badge>
                      {n.overdue && <Badge tone="destructive">{t('notes.overdue')}</Badge>}
                      <span className="text-xs text-muted tnum">
                        {n.ref} · {t(`notes.kind.${n.kind}`)} {n.serialNumber}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm font-medium">{n.partyName}</p>
                    <p className="text-xs text-faint">
                      {t('notes.due')}: {formatDate(n.dueDate, locale)}
                      {n.bankName ? ` · ${n.bankName}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tnum">
                    {formatMoney(n.amount, n.currency, locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {open && <NoteSheet n={open} onClose={() => setOpen(null)} />}
      {depositing && (
        <DepositSheet
          noteIds={picked}
          onClose={(done) => {
            setDepositing(false);
            if (done) setPicked([]);
          }}
        />
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  );
}

/** A note, its history, and the steps it can take next. */
function NoteSheet({ n, onClose }: { n: Note; onClose: () => void }) {
  const { t, locale } = useT();
  const can = useCan();
  const step = useNoteStep();
  const accounts = useMoneyAccounts();
  const parties = useParties({ page: 1, pageSize: 100, active: true });
  const [action, setAction] = useState<NoteStep | null>(null);
  const [accountId, setAccountId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [remark, setRemark] = useState('');
  const receivable = n.direction === 'RECEIVABLE';
  const money = (v: number) => formatMoney(v, n.currency, locale);

  const steps: { key: NoteStep; label: TranslationKey; show: boolean; tone?: 'danger' }[] = [
    {
      key: 'collect',
      label: 'notes.collect',
      show:
        receivable && ['IN_HAND', 'UNDER_COLLECTION'].includes(n.status) && can('notes:collect'),
    },
    {
      key: 'pay',
      label: 'notes.pay',
      show: !receivable && n.status === 'ISSUED' && can('notes:pay'),
    },
    {
      key: 'endorse',
      label: 'notes.endorse',
      show: receivable && n.status === 'IN_HAND' && can('notes:endorse'),
    },
    {
      key: 'bounce',
      label: 'notes.bounce',
      show: ['IN_HAND', 'UNDER_COLLECTION', 'ISSUED'].includes(n.status) && can('notes:bounce'),
      tone: 'danger',
    },
    {
      key: 'cancel',
      label: 'notes.cancel',
      show: ['IN_HAND', 'ISSUED'].includes(n.status) && can('notes:cancel'),
      tone: 'danger',
    },
  ];

  async function run() {
    if (!action) return;
    try {
      await step.mutateAsync({
        id: n.id,
        step: action,
        input: {
          accountId: accountId || undefined,
          partyId: action === 'endorse' ? partyId : undefined,
          remark: remark.trim() || undefined,
        },
      });
      onClose();
    } catch {
      /* shown below */
    }
  }

  const needsAccount = action === 'pay' || (action === 'collect' && n.status === 'IN_HAND');
  const ready = action && (!needsAccount || accountId) && (action !== 'endorse' || partyId);

  return (
    <Sheet
      title={`${t(`notes.kind.${n.kind}`)} ${n.serialNumber}`}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={TONE[n.status]}>{t(`notes.status.${n.status}`)}</Badge>
          {n.overdue && <Badge tone="destructive">{t('notes.overdue')}</Badge>}
          <span className="text-xs text-muted tnum">{n.ref}</span>
        </div>
        <p className="text-2xl font-semibold tnum">{money(n.amount)}</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fact label={t('notes.party')}>{n.partyName}</Fact>
          <Fact label={t('notes.due')}>{formatDate(n.dueDate, locale)}</Fact>
          <Fact label={t('notes.bank')}>{n.bankName ?? '—'}</Fact>
          {n.drawer && <Fact label={t('notes.drawer')}>{n.drawer}</Fact>}
          {n.guarantor && <Fact label={t('notes.guarantor')}>{n.guarantor}</Fact>}
          {n.accountName && <Fact label={t('money.account')}>{n.accountName}</Fact>}
          {n.portfolioNumber && <Fact label={t('notes.portfolio')}>{n.portfolioNumber}</Fact>}
          {n.endorsedToName && <Fact label={t('notes.endorsedTo')}>{n.endorsedToName}</Fact>}
        </dl>
        {n.allocations.length > 0 && (
          <div>
            <p className="mb-1 text-xs text-muted">{t('money.invoices')}</p>
            <ul className="space-y-1">
              {n.allocations.map((a) => (
                <li key={a.documentId} className="flex justify-between tnum">
                  <span>{a.number}</span>
                  <span>{money(a.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <p className="mb-1 text-xs text-muted">{t('notes.history')}</p>
          <ol className="space-y-1 border-s border-line ps-3">
            {n.events.map((e, i) => (
              <li key={i} className="text-xs">
                <span className="font-medium">{t(`notes.status.${e.toStatus}`)}</span>
                <span className="text-muted">
                  {' '}
                  · {formatDateTime(e.createdAt, locale)} · {e.staffName}
                  {e.accountName ? ` · ${e.accountName}` : ''}
                  {e.partyName ? ` · ${e.partyName}` : ''}
                  {e.remark ? ` · ${e.remark}` : ''}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {steps.some((s) => s.show) && (
          <div className="space-y-3 border-t border-line pt-3">
            <div className="flex flex-wrap gap-2">
              {steps
                .filter((s) => s.show)
                .map((s) => (
                  <Button
                    key={s.key}
                    size="sm"
                    variant={
                      action === s.key ? (s.tone === 'danger' ? 'danger' : 'primary') : 'secondary'
                    }
                    onClick={() => setAction(s.key)}
                  >
                    {t(s.label)}
                  </Button>
                ))}
            </div>
            {action && (
              <div className="grid gap-3 sm:grid-cols-2">
                {(action === 'collect' || action === 'pay') && (
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted">
                      {action === 'pay' ? t('notes.payFrom') : t('notes.collectInto')}
                    </span>
                    <select
                      className={input}
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                    >
                      <option value="">
                        {action === 'collect' && n.status === 'UNDER_COLLECTION'
                          ? t('notes.depositBank')
                          : t('money.pickAccount')}
                      </option>
                      {(accounts.data ?? [])
                        .filter((a) => a.isActive)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} · {formatMoney(a.balance, a.currency, locale)}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {action === 'endorse' && (
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted">{t('notes.endorseTo')}</span>
                    <select
                      className={input}
                      value={partyId}
                      onChange={(e) => setPartyId(e.target.value)}
                    >
                      <option value="">{t('money.pickParty')}</option>
                      {(parties.data?.items ?? [])
                        .filter((p) => p.id !== n.partyId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label className="block">
                  <span className="mb-1 block text-xs text-muted">{t('notes.remark')}</span>
                  <input
                    className={input}
                    value={remark}
                    maxLength={500}
                    onChange={(e) => setRemark(e.target.value)}
                  />
                </label>
                {(action === 'bounce' || action === 'cancel') && (
                  <p className="text-xs text-muted sm:col-span-2">
                    {action === 'bounce' ? t('notes.bounceHint') : t('notes.cancelHint')}
                  </p>
                )}
                <div className="sm:col-span-2">
                  <Button
                    icon="check"
                    variant={action === 'bounce' || action === 'cancel' ? 'danger' : 'primary'}
                    loading={step.isPending}
                    disabled={!ready}
                    onClick={() => void run()}
                  >
                    {t('notes.confirm')}
                  </Button>
                </div>
              </div>
            )}
            {step.error && <p className="text-destructive">{errorText(t, step.error)}</p>}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function DepositSheet({
  noteIds,
  onClose,
}: {
  noteIds: string[];
  onClose: (done: boolean) => void;
}) {
  const { t, locale } = useT();
  const accounts = useMoneyAccounts();
  const deposit = useDepositNotes();
  const [accountId, setAccountId] = useState('');
  const banks = (accounts.data ?? []).filter((a) => a.isActive && a.kind === 'BANK');
  return (
    <Sheet
      title={`${t('notes.deposit')} (${noteIds.length})`}
      onClose={() => onClose(false)}
      closeLabel={t('common.close')}
    >
      <label className="block">
        <span className="mb-1 block text-xs text-muted">{t('notes.bankAccount')}</span>
        <select className={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">{t('money.pickAccount')}</option>
          {banks.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {formatMoney(a.balance, a.currency, locale)}
            </option>
          ))}
        </select>
      </label>
      {deposit.error && (
        <p className="mt-3 text-sm text-destructive">{errorText(t, deposit.error)}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onClose(false)}>
          {t('common.cancel')}
        </Button>
        <Button
          icon="check"
          loading={deposit.isPending}
          disabled={!accountId}
          onClick={async () => {
            try {
              await deposit.mutateAsync({ noteIds, accountId });
              onClose(true);
            } catch {
              /* shown above */
            }
          }}
        >
          {t('notes.deposit')}
        </Button>
      </div>
    </Sheet>
  );
}

function PortfoliosTab() {
  const { t, locale } = useT();
  const { data, isLoading } = usePortfolios();
  if (isLoading) return <Loading />;
  if (!data || data.length === 0)
    return (
      <Card>
        <EmptyState title={t('notes.noPortfolios')} icon="notes" />
      </Card>
    );
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {data.map((p) => (
        <Card key={p.id}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium tnum">{p.number}</p>
              <p className="text-xs text-muted">
                {p.accountName} · {formatDate(p.createdAt, locale)} · {p.createdByName}
              </p>
            </div>
            <span className="font-semibold tnum">{formatMoney(p.total, p.currency, locale)}</span>
          </div>
          <p className="mt-2 text-xs text-muted tnum">{p.refs.join('، ')}</p>
        </Card>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- create */

function CreateSheet({ direction, onClose }: { direction: NoteDirection; onClose: () => void }) {
  const { t, locale } = useT();
  const receivable = direction === 'RECEIVABLE';
  const parties = useParties({ page: 1, pageSize: 100, active: true });
  const create = useCreateNote();
  const [partyId, setPartyId] = useState('');
  const [kind, setKind] = useState<NoteKind>('CHEQUE');
  const [serial, setSerial] = useState('');
  const [bank, setBank] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState(today());
  const [drawer, setDrawer] = useState('');
  const [guarantor, setGuarantor] = useState('');
  const [remark, setRemark] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const open = useOpenInvoices(partyId, receivable ? 'sales' : 'purchases');
  const invoices = (open.data ?? []).filter((o) => !receivable || !o.onCodParcel);
  const total = minor(amount);
  const allocated = Object.values(alloc).reduce((s, v) => s + minor(v), 0);
  const over =
    allocated > total || invoices.some((o) => minor(alloc[o.documentId] ?? '') > o.outstanding);
  const valid = partyId && serial.trim() && total > 0 && due && !over;

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

  async function save() {
    try {
      await create.mutateAsync({
        direction,
        input: {
          partyId,
          kind,
          serialNumber: serial.trim(),
          amount: total,
          dueDate: due,
          bankName: bank.trim() || undefined,
          drawer: drawer.trim() || undefined,
          guarantor: guarantor.trim() || undefined,
          remark: remark.trim() || undefined,
          allocations: Object.entries(alloc)
            .map(([documentId, v]) => ({ documentId, amount: minor(v) }))
            .filter((a) => a.amount > 0),
        },
      });
      onClose();
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet
      title={receivable ? t('notes.receive') : t('notes.issue')}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs text-muted">{t('notes.party')}</span>
            <select
              className={input}
              value={partyId}
              onChange={(e) => {
                setPartyId(e.target.value);
                setAlloc({});
              }}
            >
              <option value="">{t('money.pickParty')}</option>
              {(parties.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('notes.kind')}</span>
            <select
              className={input}
              value={kind}
              onChange={(e) => setKind(e.target.value as NoteKind)}
            >
              <option value="CHEQUE">{t('notes.kind.CHEQUE')}</option>
              <option value="PROMISSORY_NOTE">{t('notes.kind.PROMISSORY_NOTE')}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('notes.serial')}</span>
            <input
              className={input}
              dir="ltr"
              value={serial}
              maxLength={40}
              onChange={(e) => setSerial(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('notes.amount')}</span>
            <input
              className={`${input} tnum`}
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('notes.due')}</span>
            <input
              className={input}
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('notes.bank')}</span>
            <input
              className={input}
              value={bank}
              maxLength={100}
              onChange={(e) => setBank(e.target.value)}
            />
          </label>
          {receivable && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">{t('notes.drawer')}</span>
                <input
                  className={input}
                  value={drawer}
                  maxLength={100}
                  onChange={(e) => setDrawer(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">{t('notes.guarantor')}</span>
                <input
                  className={input}
                  value={guarantor}
                  maxLength={100}
                  onChange={(e) => setGuarantor(e.target.value)}
                />
              </label>
            </>
          )}
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs text-muted">{t('notes.remark')}</span>
            <input
              className={input}
              value={remark}
              maxLength={500}
              onChange={(e) => setRemark(e.target.value)}
            />
          </label>
        </div>

        {partyId && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs text-muted">{t('money.invoices')}</p>
              {invoices.length > 0 && total > 0 && (
                <Button variant="ghost" size="sm" onClick={autoAllocate}>
                  {t('money.autoAllocate')}
                </Button>
              )}
            </div>
            {invoices.length === 0 ? (
              <p className="rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm text-muted">
                {t('money.noOpenInvoices')}
              </p>
            ) : (
              <ul className="max-h-52 space-y-1 overflow-auto rounded-[var(--radius-app)] border border-line p-2">
                {invoices.map((o) => (
                  <li
                    key={o.documentId}
                    className="grid grid-cols-[1fr_7rem] items-center gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      <span className="tnum">{o.number}</span>
                      <span className="text-xs text-muted">
                        {' '}
                        · {t('money.outstanding')} {formatMoney(o.outstanding, 'EGP', locale)}
                      </span>
                    </span>
                    <input
                      className={`${small} tnum`}
                      type="number"
                      min={0}
                      step="0.01"
                      aria-label={o.number}
                      value={alloc[o.documentId] ?? ''}
                      onChange={(e) =>
                        setAlloc((cur) => ({ ...cur, [o.documentId]: e.target.value }))
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            {over && <p className="mt-1 text-xs text-destructive">{t('money.overAllocated')}</p>}
          </div>
        )}

        {create.error && <p className="text-sm text-destructive">{errorText(t, create.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon="check"
            loading={create.isPending}
            disabled={!valid}
            onClick={() => void save()}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
