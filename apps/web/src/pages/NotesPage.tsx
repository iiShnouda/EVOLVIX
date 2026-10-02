import { useDeferredValue, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  type Note,
  type NoteDirection,
  type NoteStatus,
  type Party,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { PartyPicker } from '../components/PartyPicker';
import { useNotePhoto } from '../components/NotePhoto';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import {
  useDepositNotes,
  useMoneyAccounts,
  useNotes,
  useNotesSummary,
  useNoteStep,
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
  'LOST',
  'CANCELLED',
];
const PAYABLE_STATUSES: NoteStatus[] = ['ISSUED', 'PAID', 'BOUNCED', 'LOST', 'CANCELLED'];
const TONE: Record<NoteStatus, Tone> = {
  IN_HAND: 'brand',
  UNDER_COLLECTION: 'info',
  COLLECTED: 'positive',
  BOUNCED: 'destructive',
  ENDORSED: 'neutral',
  CANCELLED: 'neutral',
  ISSUED: 'warning',
  PAID: 'positive',
  LOST: 'destructive',
};

const input =
  'h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand disabled:opacity-60';
const small =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';

/**
 * Cheques & promissory notes (الأوراق المالية): what we hold (receivable) and what we issued
 * (payable), their steps, and the portfolios lodged at banks. The server checks every step again.
 */
export function NotesPage() {
  const { t } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((x) => x.key === params.get('tab'))?.key ?? 'receivable') as Tab;
  // `?receiveFor=<party>&amount=<minor>` (e.g. after approving an invoice) opens the receive page
  // for that customer.
  const receiveFor = params.get('receiveFor');
  useEffect(() => {
    if (receiveFor && can('notes:receive'))
      navigate(
        `/notes/receive?party=${receiveFor}${params.get('amount') ? `&amount=${params.get('amount')}` : ''}`,
        { replace: true },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiveFor]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('notes.title')}
        subtitle={t('notes.subtitle')}
        action={
          <div className="flex flex-wrap gap-2">
            {can('notes:receive') && (
              <Button size="sm" icon="plus" onClick={() => navigate('/notes/receive')}>
                {t('notes.receive')}
              </Button>
            )}
            {can('notes:issue') && (
              <Button
                size="sm"
                variant="secondary"
                icon="plus"
                onClick={() => navigate('/notes/issue')}
              >
                {t('notes.issue')}
              </Button>
            )}
          </div>
        }
      />
      <Summary />
      <FindCheque />
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
    </div>
  );
}

/**
 * Find a cheque in hand (owner, 2026-10-02: "I'm at the factory with a cheque — what do I do?"):
 * by its number, bank, drawer or the party, across both sides; each one found opens with what it
 * is now and the steps it can take.
 */
function FindCheque() {
  const { t, locale } = useT();
  const [text, setText] = useState('');
  const term = useDeferredValue(text.trim());
  const found = useNotes({ search: term });
  const [open, setOpen] = useState<Note | null>(null);
  const rows = term.length >= 2 ? (found.data?.items ?? []) : [];
  return (
    <Card className="space-y-2">
      <label className="block">
        <span className="mb-0.5 block text-xs text-muted">{t('cheque.find')}</span>
        <span className="relative block">
          <span className="pointer-events-none absolute inset-y-0 start-2.5 grid place-items-center text-faint">
            <Icon name="search" size={16} />
          </span>
          <input
            className={`${input} ps-8`}
            placeholder={t('cheque.findHint')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </span>
      </label>
      {term.length >= 2 &&
        (found.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">{t('cheque.notFound')}</p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-app)] border border-line">
            {rows.slice(0, 8).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setOpen(n)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={TONE[n.status]}>{t(`notes.status.${n.status}`)}</Badge>
                      {n.overdue && <Badge tone="destructive">{t('notes.overdue')}</Badge>}
                      <span className="text-xs text-muted tnum">
                        {t(n.direction === 'RECEIVABLE' ? 'cheque.received' : 'cheque.issued')} ·{' '}
                        {n.serialNumber}
                      </span>
                    </span>
                    <span className="block truncate text-sm">{n.partyName}</span>
                  </span>
                  <span className="shrink-0 font-semibold tnum">
                    {formatMoney(n.amount, n.currency, locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      {open && <NoteSheet n={open} onClose={() => setOpen(null)} />}
    </Card>
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
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search);
  const { data, isLoading } = useNotes({ direction, status: status || undefined, search: term });
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
        <input
          className={`${small} w-56`}
          placeholder={t('cheque.findHint')}
          aria-label={t('cheque.find')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
                    <p className="mt-0.5 truncate text-sm font-medium">
                      {n.partyName}
                      {n.partyCode != null && (
                        <span className="ms-1 text-xs text-muted tnum">({n.partyCode})</span>
                      )}
                      {n.hasPhoto && (
                        <Icon name="camera" size={13} className="ms-1.5 inline text-muted" />
                      )}
                    </p>
                    <p className="text-xs text-faint">
                      {t('notes.due')}: {formatDate(n.dueDate, locale)}
                      {n.bankName ? ` · ${n.bankName}` : ''}
                      {n.receivedOn
                        ? ` · ${t(n.direction === 'RECEIVABLE' ? 'cheque.receivedOn' : 'cheque.handedOn')} ${formatDate(n.receivedOn, locale)}`
                        : ''}
                      {n.broughtBy ? ` · ${n.broughtBy}` : ''}
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
  const [action, setAction] = useState<NoteStep | null>(null);
  const [accountId, setAccountId] = useState('');
  const [endorseTo, setEndorseTo] = useState<Party | null>(null);
  const photo = useNotePhoto(n.hasPhoto ? n.id : null);
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
      key: 'lost',
      label: 'notes.lost',
      show: ['IN_HAND', 'UNDER_COLLECTION', 'ISSUED'].includes(n.status) && can('notes:lost'),
      tone: 'danger',
    },
    {
      key: 'cancel',
      label: 'notes.cancel',
      show: ['IN_HAND', 'ISSUED'].includes(n.status) && can('notes:cancel'),
      tone: 'danger',
    },
  ];
  // What to do with it now (owner, 2026-10-02): said plainly, from its state and its date.
  const advice: TranslationKey = n.overdue
    ? receivable
      ? n.status === 'UNDER_COLLECTION'
        ? 'cheque.adviceOverdueBank'
        : 'cheque.adviceOverdueHand'
      : 'cheque.adviceOverdueIssued'
    : (`cheque.advice.${n.status}` as TranslationKey);

  async function run() {
    if (!action) return;
    try {
      await step.mutateAsync({
        id: n.id,
        step: action,
        input: {
          accountId: accountId || undefined,
          partyId: action === 'endorse' ? endorseTo?.id : undefined,
          remark: remark.trim() || undefined,
        },
      });
      onClose();
    } catch {
      /* shown below */
    }
  }

  const needsAccount = action === 'pay' || (action === 'collect' && n.status === 'IN_HAND');
  const ready = action && (!needsAccount || accountId) && (action !== 'endorse' || endorseTo);

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
        <p className="rounded-[var(--radius-app)] border border-brand/40 bg-brand-soft/40 p-2.5 text-sm">
          <b>{t('cheque.whatNow')}</b> {t(advice)}
        </p>
        {photo && (
          <a href={photo} target="_blank" rel="noreferrer">
            <img
              src={photo}
              alt={t('cheque.photo')}
              className="max-h-56 w-full rounded-[var(--radius-app)] border border-line object-contain"
            />
          </a>
        )}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fact label={t('notes.party')}>
            {n.partyName}
            {n.partyCode != null && <span className="ms-1 text-muted tnum">({n.partyCode})</span>}
          </Fact>
          {n.receivedOn && (
            <Fact label={t(receivable ? 'cheque.receivedOn' : 'cheque.handedOn')}>
              {formatDate(n.receivedOn, locale)}
            </Fact>
          )}
          {n.broughtBy && (
            <Fact label={t(receivable ? 'cheque.broughtBy' : 'cheque.takenBy')}>{n.broughtBy}</Fact>
          )}
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
                  <div className="sm:col-span-2">
                    <PartyPicker
                      type="SUPPLIER"
                      withCode
                      value={endorseTo}
                      onChange={setEndorseTo}
                      label={t('notes.endorseTo')}
                      placeholder={t('money.pickParty')}
                    />
                  </div>
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
                {(action === 'bounce' || action === 'cancel' || action === 'lost') && (
                  <p className="text-xs text-muted sm:col-span-2">
                    {action === 'cancel' ? t('notes.cancelHint') : t('notes.bounceHint')}
                  </p>
                )}
                <div className="sm:col-span-2">
                  <Button
                    icon="check"
                    variant={
                      action === 'bounce' || action === 'cancel' || action === 'lost'
                        ? 'danger'
                        : 'primary'
                    }
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
