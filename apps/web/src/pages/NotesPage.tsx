import { useDeferredValue, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatTime,
  type Note,
  type NoteDirection,
  type NoteStatus,
  type Party,
  type Permission,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { PartyPicker } from '../components/PartyPicker';
import { useNotePhoto } from '../components/NotePhoto';
import { useT, joinList } from '../lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDeviceInfo } from '../lib/device';
import { TableColumns } from '../components/TableColumns';
import { Pager } from '../components/Pager';
import {
  Filter,
  FilterPanel,
  RangeFilter,
  filterField,
  minorOf,
  useKeptFilters,
  useSettled,
} from '../components/FilterPanel';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { CodeName } from '../components/CodeName';
import { PartyLink } from '../components/PartyContact';
import {
  useDepositNotes,
  useMoneyAccounts,
  useBanks,
  useNotes,
  useNotesSummary,
  useNoteStep,
  usePortfolios,
  type NoteStep,
} from '../lib/queries';

type Tab = 'receivable' | 'payable' | 'portfolios';
const TABS: { key: Tab; label: TranslationKey; anyOf: Permission[] }[] = [
  {
    key: 'receivable',
    label: 'notes.tabReceivable',
    anyOf: [
      'notes:view_receivable',
      'notes:photos',
      'notes:receive',
      'notes:deposit',
      'notes:collect',
      'notes:bounce',
      'notes:endorse',
      'notes:cancel',
      'notes:lost',
    ],
  },
  {
    key: 'payable',
    label: 'notes.tabPayable',
    anyOf: [
      'notes:view_payable',
      'notes:photos',
      'notes:issue',
      'notes:pay',
      'notes:bounce',
      'notes:cancel',
      'notes:lost',
    ],
  },
  { key: 'portfolios', label: 'notes.tabPortfolios', anyOf: ['notes:portfolios', 'notes:deposit'] },
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
/** What a list of notes remembers while the app is open. */
const NOTE_FILTERS = { search: '', kind: '', dueFrom: '', dueTo: '', bankId: '', min: '', max: '' };

/**
 * Cheques & promissory notes (الأوراق المالية): what we hold (receivable) and what we issued
 * (payable), their steps, and the portfolios lodged at banks. The server checks every step again.
 */
export function NotesPage() {
  const { t } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((x) => x.anyOf.some(can));
  const tab = (tabs.find((x) => x.key === params.get('tab'))?.key ?? tabs[0]?.key) as
    Tab | undefined;
  // `?receiveFor=<party>&amount=<minor>` (e.g. after approving an invoice) opens the receive page
  // for that customer.
  const receiveFor = params.get('receiveFor');
  // `?note=<id>` (a statement line) opens that paper.
  const noteId = params.get('note');
  const linkedNote = useQuery({
    queryKey: ['notes', 'detail', noteId],
    queryFn: () => api.get<Note>(`/notes/${noteId}`),
    enabled: !!noteId,
  });
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
      {tabs.some((x) => x.key !== 'portfolios') && (
        <>
          <Summary />
          <FindCheque />
        </>
      )}
      {tabs.length > 1 && (
        <div
          role="tablist"
          className="flex max-w-full flex-wrap gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1"
        >
          {tabs.map((x) => (
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
      )}
      {tab === 'receivable' && <NotesTab direction="RECEIVABLE" />}
      {tab === 'payable' && <NotesTab direction="PAYABLE" />}
      {tab === 'portfolios' && <PortfoliosTab />}
      {noteId && linkedNote.data && (
        <NoteSheet
          n={linkedNote.data}
          onClose={() => {
            const p = new URLSearchParams(params);
            p.delete('note');
            setParams(p, { replace: true });
          }}
        />
      )}
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
                    <span className="block text-sm">
                      <CodeName code={n.partyCode} name={n.partyName} truncate />
                    </span>
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
  // The detailed search (owner, 2026-11-16), kept while the app is open.
  const [f, keep, clearKept] = useKeptFilters(`skb.list.notes.${direction}`, NOTE_FILTERS);
  const search = f.search;
  const setSearch = (v: string) => keep({ search: v });
  const term = useSettled(search);
  const [party, setParty] = useState<Party | null>(null);
  const [page, setPage] = useState(1);
  const banks = useBanks();
  const amounts = useSettled(`${minorOf(f.min)}\u0001${minorOf(f.max)}`);
  const [min = '', max = ''] = amounts.split('\u0001');
  const filterKey = [term, f.kind, f.dueFrom, f.dueTo, f.bankId, amounts, party?.id].join('|');
  const [lastKey, setLastKey] = useState(filterKey);
  if (lastKey !== filterKey) {
    setLastKey(filterKey);
    setPage(1);
  }
  const { deviceClass } = useDeviceInfo();
  const { data, isLoading } = useNotes({
    direction,
    status: status || undefined,
    search: term,
    kind: f.kind || undefined,
    partyId: party?.id,
    dueFrom: f.dueFrom || undefined,
    dueTo: f.dueTo || undefined,
    bankId: f.bankId || undefined,
    min: min || undefined,
    max: max || undefined,
    page,
  });
  const detailed =
    [f.kind, f.dueFrom || f.dueTo, f.bankId, f.min || f.max].filter(Boolean).length +
    (party ? 1 : 0);
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
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
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
      <FilterPanel
        id={`notes.${direction}`}
        active={detailed}
        onClear={() => {
          clearKept();
          setParty(null);
        }}
        quick={
          <label className="block min-w-48 flex-1 sm:max-w-sm">
            <span className="mb-0.5 block text-xs text-muted">{t('cheque.find')}</span>
            <input
              type="search"
              className={filterField}
              placeholder={t('cheque.findHint')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        }
      >
        <Filter label={t('notes.kindCol')}>
          <select
            className={filterField}
            value={f.kind}
            onChange={(e) => keep({ kind: e.target.value })}
          >
            <option value="">{t('notes.allKinds')}</option>
            {(['CHEQUE', 'PROMISSORY_NOTE'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`notes.kind.${k}`)}
              </option>
            ))}
          </select>
        </Filter>
        <div className="min-w-0 sm:col-span-2">
          <PartyPicker
            type={direction === 'RECEIVABLE' ? 'CUSTOMER' : 'SUPPLIER'}
            withCode
            value={party}
            onChange={setParty}
            label={t('notes.party')}
            placeholder={t('notes.allParties')}
          />
        </div>
        {(banks.data ?? []).length > 0 && (
          <Filter label={t('notes.bank')}>
            <select
              className={filterField}
              value={f.bankId}
              onChange={(e) => keep({ bankId: e.target.value })}
            >
              <option value="">{t('list.all')}</option>
              {(banks.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Filter>
        )}
        <Filter label={t('notes.dueFrom')}>
          <input
            type="date"
            className={`${filterField} tnum`}
            value={f.dueFrom}
            max={f.dueTo || undefined}
            onChange={(e) => keep({ dueFrom: e.target.value })}
          />
        </Filter>
        <Filter label={t('notes.dueTo')}>
          <input
            type="date"
            className={`${filterField} tnum`}
            value={f.dueTo}
            min={f.dueFrom || undefined}
            onChange={(e) => keep({ dueTo: e.target.value })}
          />
        </Filter>
        <RangeFilter
          label={t('notes.amount')}
          from={f.min}
          to={f.max}
          onFrom={(v) => keep({ min: v })}
          onTo={(v) => keep({ max: v })}
        />
      </FilterPanel>
      {isLoading ? (
        <Loading />
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('notes.empty')} icon="notes" />
        </Card>
      ) : deviceClass === 'desktop' ? (
        <NotesTable
          rows={data.items}
          canDeposit={canDeposit}
          picked={picked}
          onPick={(id) =>
            setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
          }
          onOpen={setOpen}
        />
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
                    <p className="mt-0.5 text-sm font-medium">
                      <CodeName code={n.partyCode} name={n.partyName} truncate />
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
      {data && data.total > data.pageSize && (
        <div className="flex justify-end">
          <Pager
            page={page}
            size={data.pageSize}
            pages={Math.ceil(data.total / data.pageSize)}
            onPage={setPage}
            onSize={() => undefined}
          />
        </div>
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

/** When a paper reached a state, and where or to whom (its history). */
function stepOf(n: Note, statuses: NoteStatus[]) {
  const e = [...n.events].reverse().find((x) => statuses.includes(x.toStatus));
  return e ?? null;
}

/**
 * Every paper in columns (owner, 2026-11-10: "more order, every detail, in columns"): our reference,
 * kind and number, bank, party, amount, when it came and when it falls due, its state and each step
 * with its date — deposited where, collected or paid into which account, endorsed to whom,
 * bounced, cancelled or lost — the invoices it settled, the branch, who took it and the remark.
 */
function NotesTable({
  rows,
  canDeposit,
  picked,
  onPick,
  onOpen,
}: {
  rows: Note[];
  canDeposit: boolean;
  picked: string[];
  onPick: (id: string) => void;
  onOpen: (n: Note) => void;
}) {
  const { t, locale } = useT();
  const day = (iso: string | null | undefined) => (iso ? formatDate(iso, locale) : '');
  const at = (iso: string) => `${formatDate(iso, locale)} ${formatTime(iso, locale)}`;
  const step = (n: Note, statuses: NoteStatus[], what: (e: Note['events'][number]) => string) => {
    const e = stepOf(n, statuses);
    if (!e) return '';
    return (
      <span className="block">
        <span className="whitespace-nowrap tnum">{at(e.createdAt)}</span>
        {what(e) && <span className="block text-muted">{what(e)}</span>}
      </span>
    );
  };
  const total = rows.reduce((sum, n) => sum + n.amount, 0);
  const cell = 'p-2 align-top';
  const head = (k: TranslationKey, end = false) => (
    <th className={`${cell} font-medium ${end ? 'text-end' : 'text-start'}`}>{t(k)}</th>
  );
  return (
    <Card padded={false} className="overflow-hidden">
      <TableColumns id="notes.list" className="pt-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[93.75rem] text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                {canDeposit && <th className={cell} />}
                {head('notes.ref')}
                {head('notes.kindCol')}
                {head('notes.number')}
                {head('notes.bank')}
                {head('notes.party')}
                {head('common.amount', true)}
                {head('notes.receivedCol')}
                {head('notes.due')}
                {head('notes.statusCol')}
                {head('notes.depositedCol')}
                {head('notes.collectedCol')}
                {head('notes.endorsedCol')}
                {head('notes.bouncedCol')}
                {head('notes.invoicesCol')}
                {head('notes.drawer')}
                {head('notes.branchCol')}
                {head('notes.byCol')}
                {head('notes.remark')}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {rows.map((n) => (
                <tr key={n.id} className="hover:bg-surface-2/60">
                  {canDeposit && (
                    <td className={cell}>
                      <input
                        type="checkbox"
                        aria-label={n.ref}
                        disabled={n.status !== 'IN_HAND'}
                        checked={picked.includes(n.id)}
                        onChange={() => onPick(n.id)}
                      />
                    </td>
                  )}
                  <td className={`${cell} whitespace-nowrap tnum`}>
                    <button
                      type="button"
                      className="text-brand hover:underline"
                      onClick={() => onOpen(n)}
                    >
                      <bdi>{n.ref}</bdi>
                    </button>
                  </td>
                  <td className={cell}>{t(`notes.kind.${n.kind}`)}</td>
                  <td className={`${cell} whitespace-nowrap tnum`}>
                    <bdi>{n.serialNumber}</bdi>
                    {n.hasPhoto && (
                      <Icon name="camera" size={13} className="ms-1 inline text-muted" />
                    )}
                  </td>
                  <td className={cell}>{n.bankName ?? ''}</td>
                  <td className={cell}>
                    <PartyLink id={n.partyId} code={n.partyCode} name={n.partyName} />
                  </td>
                  <td className={`${cell} whitespace-nowrap text-end font-semibold tnum`}>
                    {formatMoney(n.amount, n.currency, locale)}
                  </td>
                  <td className={`${cell} whitespace-nowrap tnum`}>
                    {day(n.receivedOn ?? n.createdAt)}
                    {n.broughtBy && <span className="block text-muted">{n.broughtBy}</span>}
                  </td>
                  <td className={`${cell} whitespace-nowrap tnum`}>{day(n.dueDate)}</td>
                  <td className={cell}>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={TONE[n.status]}>{t(`notes.status.${n.status}`)}</Badge>
                      {n.overdue && <Badge tone="destructive">{t('notes.overdue')}</Badge>}
                    </span>
                  </td>
                  <td className={cell}>
                    {step(n, ['UNDER_COLLECTION'], (e) =>
                      [e.accountName, n.portfolioNumber].filter(Boolean).join(' · '),
                    )}
                  </td>
                  <td className={cell}>
                    {step(n, ['COLLECTED', 'PAID'], (e) => e.accountName ?? '')}
                  </td>
                  <td className={cell}>
                    {step(n, ['ENDORSED'], (e) => e.partyName ?? n.endorsedToName ?? '')}
                  </td>
                  <td className={cell}>
                    {step(n, ['BOUNCED', 'CANCELLED', 'LOST'], (e) =>
                      [t(`notes.status.${e.toStatus}`), e.remark].filter(Boolean).join(' · '),
                    )}
                  </td>
                  <td className={`${cell} tnum`}>
                    {n.allocations.map((a) => (
                      <span key={a.documentId} className="block whitespace-nowrap">
                        <bdi>{a.number}</bdi> · {formatMoney(a.amount, n.currency, locale)}
                      </span>
                    ))}
                  </td>
                  <td className={cell}>{n.drawer ?? ''}</td>
                  <td className={`${cell} text-muted`}>{n.branchName}</td>
                  <td className={`${cell} text-muted`}>
                    {n.createdByName}
                    <span className="block whitespace-nowrap tnum">{at(n.createdAt)}</span>
                  </td>
                  <td className={`${cell} text-muted`}>
                    <span className="line-clamp-2">{n.remark ?? ''}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-2 font-semibold">
              <tr>
                {canDeposit && <td className={cell} />}
                <td className={cell}>{t('ledger.total')}</td>
                {Array.from({ length: 4 }, (_, i) => (
                  <td key={i} className={cell} />
                ))}
                <td className={`${cell} whitespace-nowrap text-end tnum`}>
                  {rows[0] ? formatMoney(total, rows[0].currency, locale) : ''}
                </td>
                {Array.from({ length: 12 }, (_, i) => (
                  <td key={i} className={cell} />
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </TableColumns>
    </Card>
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
            <PartyLink id={n.partyId} code={n.partyCode} name={n.partyName} />
          </Fact>
          {n.receivedOn && (
            <Fact label={t(receivable ? 'cheque.receivedOn' : 'cheque.handedOn')}>
              {formatDate(n.receivedOn, locale)}
            </Fact>
          )}
          {n.broughtBy && (
            <Fact label={t(receivable ? 'cheque.broughtBy' : 'cheque.takenBy')}>
              {n.broughtBy}
              {n.broughtByParty &&
                ` (${t(receivable ? 'cheque.byCustomer' : 'cheque.bySupplier')})`}
            </Fact>
          )}
          <Fact label={t(receivable ? 'cheque.receivedBy' : 'cheque.handedBy')}>
            {n.createdByName}
          </Fact>
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
                            {a.name}
                            {a.balance != null &&
                              ` · ${formatMoney(a.balance, a.currency, locale)}`}
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
              {a.name}
              {a.balance != null && ` · ${formatMoney(a.balance, a.currency, locale)}`}
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
          <p className="mt-2 text-xs text-muted tnum">{joinList(p.refs)}</p>
        </Card>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- create */
