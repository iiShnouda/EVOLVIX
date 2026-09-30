import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  toMinor,
  type FinancialRow,
  type JournalEntry,
  type LedgerAccount,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { LedgerStatementSheet, SidedMoney, entryTitle } from '../components/LedgerStatementSheet';
import { ReportActions } from '../components/ReportActions';
import { useReportTools, type Cell } from '../lib/report';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import {
  useBalanceSheet,
  useCloseYear,
  useClosedYears,
  useIncomeStatement,
  useJournal,
  useLedgerAccounts,
  useLockDate,
  usePostJournalEntry,
  useReverseJournalEntry,
  useSaveLedgerAccount,
  useSetLockDate,
  useTrialBalance,
} from '../lib/queries';

type Tab = 'accounts' | 'journal' | 'trial' | 'income' | 'balance';
const TABS: { key: Tab; label: TranslationKey }[] = [
  { key: 'accounts', label: 'ledger.tabAccounts' },
  { key: 'journal', label: 'ledger.tabJournal' },
  { key: 'trial', label: 'ledger.tabTrial' },
  { key: 'income', label: 'ledger.tabIncome' },
  { key: 'balance', label: 'ledger.tabBalance' },
];
/** Groups whose accounts come from customers, suppliers, cash boxes and categories. */
const AUTO_GROUPS = ['CASH', 'BANKS', 'CUSTOMERS', 'CARRIERS', 'SUPPLIERS', 'OPERATING_EXPENSES'];
const SOURCES = [
  'MANUAL',
  'SALES_INVOICE',
  'SALES_RETURN',
  'PURCHASE_INVOICE',
  'PURCHASE_RETURN',
  'VOUCHER',
  'VOUCHER_CANCEL',
  'STOCKTAKE',
  'SHIPMENT',
  'CARRIER_SETTLEMENT',
  'MONEY_OPENING',
  'MANUAL_REVERSAL',
  'NOTE',
  'PAYROLL',
  'SALARY_PAYMENT',
  'ADVANCE',
  'ADVANCE_CANCEL',
  'OPENING',
  'YEAR_CLOSE',
];

const input =
  'h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand disabled:opacity-60';
const small =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const yearStart = () => iso(new Date(new Date().getFullYear(), 0, 1));
const today = () => iso(new Date());

/** The general ledger: chart of accounts with balances, the journal and the trial balance. */
export function LedgerPage() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((x) => x.key === params.get('tab'))?.key ?? 'accounts') as Tab;
  return (
    <div className="space-y-5">
      <PageHeader title={t('ledger.title')} subtitle={t('ledger.subtitle')} />
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
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'journal' && <JournalTab />}
      {tab === 'trial' && <TrialTab />}
      {tab === 'income' && <IncomeTab />}
      {tab === 'balance' && <BalanceTab />}
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

function DateRange({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="mb-1 block text-xs text-muted">{t('ledger.from')}</span>
        <input
          className={small}
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted">{t('ledger.to')}</span>
        <input
          className={small}
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
    </div>
  );
}

/* -------------------------------------------------------------- accounts */

function AccountsTab() {
  const { t } = useT();
  const can = useCan();
  const { data, isLoading } = useLedgerAccounts();
  const [showEmpty, setShowEmpty] = useState(false);
  const [statement, setStatement] = useState<LedgerAccount | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LedgerAccount | null>(null);
  const currency = 'EGP';

  const rows = useMemo(() => {
    const list = data ?? [];
    const kids = new Map<string | null, LedgerAccount[]>();
    for (const a of list) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a]);
    const out: { a: LedgerAccount; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const a of (kids.get(parent) ?? []).sort((x, y) => x.code.localeCompare(y.code))) {
        if (showEmpty || a.isGroup || a.debit !== 0 || a.credit !== 0 || a.systemKey)
          out.push({ a, depth });
        walk(a.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [data, showEmpty]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
          />
          {t('ledger.showEmpty')}
        </label>
        {can('ledger:manage') && (
          <Button icon="plus" size="sm" onClick={() => setAdding(true)}>
            {t('ledger.addAccount')}
          </Button>
        )}
      </div>
      {isLoading ? (
        <Loading />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map(({ a, depth }) => (
              <li key={a.id} className={a.isActive ? '' : 'opacity-60'}>
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-surface-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-start"
                    style={{ paddingInlineStart: `${depth * 1}rem` }}
                    onClick={() => setStatement(a)}
                  >
                    <span className="w-16 shrink-0 text-xs text-muted tnum sm:w-20">{a.code}</span>
                    <span className={`truncate ${a.isGroup ? 'font-semibold' : ''}`}>{a.name}</span>
                    {depth === 0 && <Badge tone="brand">{t(`ledger.type.${a.type}`)}</Badge>}
                  </button>
                  <span className="shrink-0 text-end">
                    <SidedMoney value={a.balance} currency={currency} />
                  </span>
                  {can('ledger:manage') &&
                    !a.systemKey &&
                    !a.partyId &&
                    !a.moneyAccountId &&
                    !a.expenseCategoryId && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
                        {t('common.edit')}
                      </Button>
                    )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {statement && (
        <LedgerStatementSheet
          kind="accounts"
          id={statement.id}
          title={`${statement.code} ${statement.name}`}
          onClose={() => setStatement(null)}
        />
      )}
      {adding && <AccountSheet accounts={data ?? []} onClose={() => setAdding(false)} />}
      {editing && (
        <AccountSheet accounts={data ?? []} account={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function AccountSheet({
  accounts,
  account,
  onClose,
}: {
  accounts: LedgerAccount[];
  account?: LedgerAccount;
  onClose: () => void;
}) {
  const { t } = useT();
  const save = useSaveLedgerAccount();
  const groups = accounts.filter(
    (a) => a.isGroup && a.isActive && !AUTO_GROUPS.includes(a.systemKey ?? ''),
  );
  const [name, setName] = useState(account?.name ?? '');
  const [parentId, setParentId] = useState(groups[0]?.id ?? '');
  const [isGroup, setIsGroup] = useState(false);

  async function run(input: Parameters<typeof save.mutateAsync>[0]['input']) {
    try {
      await save.mutateAsync({ id: account?.id, input });
      onClose();
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet
      title={account ? `${account.code} ${account.name}` : t('ledger.addAccount')}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('common.name')}</span>
          <input
            className={input}
            value={name}
            maxLength={200}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {!account && (
          <>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">{t('ledger.parent')}</span>
              <select
                className={input}
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isGroup}
                onChange={(e) => setIsGroup(e.target.checked)}
              />
              {t('ledger.isGroup')}
            </label>
          </>
        )}
        {save.error && <p className="text-sm text-destructive">{errorText(t, save.error)}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {account ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={save.isPending || account.balance !== 0}
              onClick={() => void run({ isActive: !account.isActive })}
            >
              {account.isActive ? t('ledger.close') : t('money.reopen')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              icon="check"
              loading={save.isPending}
              disabled={!name.trim() || (!account && !parentId)}
              onClick={() =>
                void run(account ? { name: name.trim() } : { name: name.trim(), parentId, isGroup })
              }
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------------------- journal */

function JournalTab() {
  const { t, locale } = useT();
  const can = useCan();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [source, setSource] = useState('');
  const { data, isLoading } = useJournal({ from, to, source: source || undefined });
  const [open, setOpen] = useState<JournalEntry | null>(null);
  const [posting, setPosting] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <select
            className={`${small} w-auto`}
            value={source}
            aria-label={t('ledger.allSources')}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">{t('ledger.allSources')}</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`ledger.source.${s}` as TranslationKey)}
              </option>
            ))}
          </select>
        </div>
        {can('ledger:post') && (
          <Button icon="plus" size="sm" onClick={() => setPosting(true)}>
            {t('ledger.newEntry')}
          </Button>
        )}
      </div>
      {isLoading ? (
        <Loading />
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('ledger.noEntries')} icon="ledger" />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {data.items.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-surface-2"
                  onClick={() => setOpen(e)}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={e.sourceType.startsWith('MANUAL') ? 'info' : 'neutral'}>
                        {t(`ledger.source.${e.sourceType}` as TranslationKey)}
                      </Badge>
                      <span className="text-xs text-muted tnum">{e.number}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm font-medium">
                      {entryTitle(t, e.sourceType, e.description)}
                    </p>
                    <p className="text-xs text-faint">
                      {formatDate(e.date, locale)} · {e.createdByName}
                    </p>
                  </div>
                  <span className="shrink-0 tnum">
                    {formatMoney(
                      e.lines.reduce((s, l) => s + l.debit, 0),
                      e.currency,
                      locale,
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {open && <EntrySheet e={open} onClose={() => setOpen(null)} />}
      {posting && <NewEntrySheet onClose={() => setPosting(false)} />}
    </div>
  );
}

function EntrySheet({ e, onClose }: { e: JournalEntry; onClose: () => void }) {
  const { t, locale } = useT();
  const can = useCan();
  const reverse = useReverseJournalEntry();
  const money = (v: number) => formatMoney(v, e.currency, locale);
  return (
    <Sheet
      title={`${e.number} — ${formatDate(e.date, locale)}`}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide
    >
      <p className="font-medium">{entryTitle(t, e.sourceType, e.description)}</p>
      <p className="mb-3 text-xs text-muted">
        {t(`ledger.source.${e.sourceType}` as TranslationKey)} · {e.createdByName}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 text-start font-normal">{t('ledger.account')}</th>
              <th className="py-1 text-end font-normal">{t('ledger.debit')}</th>
              <th className="py-1 text-end font-normal">{t('ledger.credit')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {e.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1.5">
                  <span className="text-xs text-muted tnum">{l.accountCode}</span> {l.accountName}
                  {l.memo && <span className="block text-xs text-faint">{l.memo}</span>}
                </td>
                <td className="py-1.5 text-end tnum">{l.debit ? money(l.debit) : ''}</td>
                <td className="py-1.5 text-end tnum">{l.credit ? money(l.credit) : ''}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5">{t('ledger.total')}</td>
              <td className="py-1.5 text-end tnum">
                {money(e.lines.reduce((s, l) => s + l.debit, 0))}
              </td>
              <td className="py-1.5 text-end tnum">
                {money(e.lines.reduce((s, l) => s + l.credit, 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {reverse.error && (
        <p className="mt-3 text-sm text-destructive">{errorText(t, reverse.error)}</p>
      )}
      {e.reversible && can('ledger:post') && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs text-muted">{t('ledger.reverseHint')}</p>
          <Button
            variant="danger"
            size="sm"
            loading={reverse.isPending}
            onClick={async () => {
              try {
                await reverse.mutateAsync(e.id);
                onClose();
              } catch {
                /* shown above */
              }
            }}
          >
            {t('ledger.reverse')}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

interface LineDraft {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

function NewEntrySheet({ onClose }: { onClose: () => void }) {
  const { t, locale } = useT();
  const accounts = useLedgerAccounts();
  const post = usePostJournalEntry();
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const blank: LineDraft = { accountId: '', debit: '', credit: '', memo: '' };
  const [lines, setLines] = useState<LineDraft[]>([blank, blank]);
  // Money and stock move through their own documents, so they are not offered here.
  const postable = (accounts.data ?? []).filter(
    (a) => !a.isGroup && a.isActive && !a.moneyAccountId && a.systemKey !== 'INVENTORY',
  );
  const minor = (v: string) => (v.trim() === '' ? 0 : toMinor(Number(v) || 0));
  const debit = lines.reduce((s, l) => s + minor(l.debit), 0);
  const credit = lines.reduce((s, l) => s + minor(l.credit), 0);
  const valid =
    description.trim() !== '' &&
    lines.length >= 2 &&
    lines.every((l) => l.accountId && minor(l.debit) > 0 !== minor(l.credit) > 0) &&
    debit === credit &&
    debit > 0;
  const set = (i: number, patch: Partial<LineDraft>) =>
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    try {
      await post.mutateAsync({
        date,
        description: description.trim(),
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: minor(l.debit) || undefined,
          credit: minor(l.credit) || undefined,
          memo: l.memo.trim() || undefined,
        })),
      });
      onClose();
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet title={t('ledger.newEntry')} onClose={onClose} closeLabel={t('common.close')} wide>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('ledger.date')}</span>
            <input
              className={input}
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('ledger.description')}</span>
            <input
              className={input}
              value={description}
              maxLength={300}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
        <p className="text-xs text-faint">{t('ledger.entryHint')}</p>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div
              key={i}
              className="grid gap-2 rounded-[var(--radius-app)] border border-line p-2 sm:grid-cols-[1fr_7rem_7rem]"
            >
              <select
                className={small}
                aria-label={t('ledger.account')}
                value={l.accountId}
                onChange={(e) => set(i, { accountId: e.target.value })}
              >
                <option value="">{t('ledger.account')}</option>
                {postable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
              <input
                className={`${small} tnum`}
                type="number"
                min={0}
                step="0.01"
                placeholder={t('ledger.debit')}
                aria-label={t('ledger.debit')}
                value={l.debit}
                onChange={(e) =>
                  set(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })
                }
              />
              <input
                className={`${small} tnum`}
                type="number"
                min={0}
                step="0.01"
                placeholder={t('ledger.credit')}
                aria-label={t('ledger.credit')}
                value={l.credit}
                onChange={(e) =>
                  set(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })
                }
              />
              <input
                className={`${small} sm:col-span-2`}
                placeholder={t('ledger.memo')}
                maxLength={200}
                value={l.memo}
                onChange={(e) => set(i, { memo: e.target.value })}
              />
              {lines.length > 2 && (
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            onClick={() => setLines((cur) => [...cur, blank])}
          >
            {t('ledger.addLine')}
          </Button>
          <span className={`tnum ${debit !== credit ? 'text-destructive' : 'text-muted'}`}>
            {t('ledger.debit')} {formatMoney(debit, 'EGP', locale)} · {t('ledger.credit')}{' '}
            {formatMoney(credit, 'EGP', locale)}
            {debit !== credit &&
              ` · ${t('ledger.difference')} ${formatMoney(Math.abs(debit - credit), 'EGP', locale)}`}
          </span>
        </div>
        {post.error && <p className="text-sm text-destructive">{errorText(t, post.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon="check"
            loading={post.isPending}
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

/* ---------------------------------------------------------- trial balance */

function TrialTab() {
  const { t, locale } = useT();
  const can = useCan();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const { data, isLoading, error } = useTrialBalance(from, to);
  const lock = useLockDate();
  const setLock = useSetLockDate();
  const [lockTo, setLockTo] = useState('');
  // A closed year stays locked: the lock can't move back before its 31 December.
  const lastClosed = Math.max(0, ...(useClosedYears().data ?? []).map((c) => c.year));
  const lockMin = lastClosed ? `${lastClosed}-12-31` : undefined;
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const period = `${formatDate(from, locale)} – ${formatDate(to, locale)}`;
  const money = (v: number) => (v ? formatMoney(v, data?.currency ?? 'EGP', locale) : '');
  const sum = (
    k:
      | 'openingDebit'
      | 'openingCredit'
      | 'periodDebit'
      | 'periodCredit'
      | 'closingDebit'
      | 'closingCredit',
  ) => (data?.rows ?? []).reduce((s, r) => s + r[k], 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <Card className="flex flex-wrap items-end gap-2 !p-3 text-sm">
          <span className="self-center text-muted">
            {t('ledger.lock')}:{' '}
            <span className="font-medium text-fg">
              {lock.data?.lockDate
                ? `${t('ledger.lockedThrough')} ${formatDate(lock.data.lockDate, locale)}`
                : t('ledger.notLocked')}
            </span>
          </span>
          {can('ledger:lock') && (
            <>
              <input
                className={`${small} w-auto`}
                type="date"
                min={lockMin}
                max={today()}
                value={lockTo}
                onChange={(e) => setLockTo(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!lockTo || setLock.isPending}
                onClick={() => setLock.mutate(lockTo)}
              >
                {t('ledger.setLock')}
              </Button>
              {lock.data?.lockDate && !lastClosed && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={setLock.isPending}
                  onClick={() => setLock.mutate(null)}
                >
                  {t('ledger.unlock')}
                </Button>
              )}
            </>
          )}
          {setLock.error && <span className="text-destructive">{errorText(t, setLock.error)}</span>}
        </Card>
      </div>
      <YearClose />
      {error && <p className="text-sm text-destructive">{errorText(t, error)}</p>}
      <div className="flex justify-end">
        <ReportActions
          disabled={!data}
          onPrint={() => report.print(paper.current, t('ledger.tabTrial'), period)}
          onExcel={() => {
            if (!data) return;
            const m = (v: number): Cell => (v ? { money: v } : null);
            const keys = [
              'openingDebit',
              'openingCredit',
              'periodDebit',
              'periodCredit',
              'closingDebit',
              'closingCredit',
            ] as const;
            report.excel(
              t('ledger.tabTrial'),
              period,
              [
                t('ledger.code'),
                t('ledger.account'),
                ...[t('ledger.opening'), t('ledger.period'), t('ledger.closing')].flatMap((h) => [
                  `${h} — ${t('ledger.debit')}`,
                  `${h} — ${t('ledger.credit')}`,
                ]),
              ],
              data.rows.map((r) => [r.code, r.name, ...keys.map((k) => m(r[k]))]),
              [t('ledger.total'), '', ...keys.map((k) => ({ money: sum(k) }))],
            );
          }}
        />
      </div>
      {isLoading || !data ? (
        <Loading />
      ) : (
        <Card padded={false} className="overflow-x-auto">
          <div ref={paper}>
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th rowSpan={2} className="px-3 py-2 text-start font-normal">
                    {t('ledger.account')}
                  </th>
                  <th colSpan={2} className="px-2 py-1 text-center font-normal">
                    {t('ledger.opening')}
                  </th>
                  <th colSpan={2} className="px-2 py-1 text-center font-normal">
                    {t('ledger.period')}
                  </th>
                  <th colSpan={2} className="px-2 py-1 text-center font-normal">
                    {t('ledger.closing')}
                  </th>
                </tr>
                <tr>
                  {[0, 1, 2].flatMap((i) => [
                    <th key={`d${i}`} className="px-2 pb-2 text-end font-normal">
                      {t('ledger.debit')}
                    </th>,
                    <th key={`c${i}`} className="px-2 pb-2 text-end font-normal">
                      {t('ledger.credit')}
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r) => (
                  <tr key={r.accountId}>
                    <td className="px-3 py-1.5">
                      <span className="text-xs text-muted tnum">{r.code}</span> {r.name}
                    </td>
                    {[
                      r.openingDebit,
                      r.openingCredit,
                      r.periodDebit,
                      r.periodCredit,
                      r.closingDebit,
                      r.closingCredit,
                    ].map((v, i) => (
                      <td key={i} className="px-2 py-1.5 text-end tnum">
                        {money(v)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-surface-2 font-semibold">
                  <td className="px-3 py-2">{t('ledger.total')}</td>
                  {(
                    [
                      'openingDebit',
                      'openingCredit',
                      'periodDebit',
                      'periodCredit',
                      'closingDebit',
                      'closingCredit',
                    ] as const
                  ).map((k) => (
                    <td key={k} className="px-2 py-2 text-end tnum">
                      {formatMoney(sum(k), data.currency, locale)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Year-end close (إقفال السنة): the closed years, and closing the next one. */
function YearClose() {
  const { t, locale } = useT();
  const can = useCan();
  const closed = useClosedYears();
  const close = useCloseYear();
  const thisYear = new Date().getFullYear();
  // Years close in order: only those after the last closed one.
  const last = Math.max(0, ...(closed.data ?? []).map((c) => c.year));
  const open = [1, 2, 3, 4, 5].map((i) => thisYear - i).filter((y) => y > last);
  const [picked, setPicked] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const year = picked !== null && open.includes(picked) ? picked : open[0];
  const currency = 'EGP';

  return (
    <Card className="space-y-2 !p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{t('ledger.yearClose')}</span>
        {can('ledger:lock') && year !== undefined && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={`${small} w-auto tnum`}
              aria-label={t('ledger.year')}
              value={year}
              onChange={(e) => {
                setPicked(Number(e.target.value));
                setConfirming(false);
              }}
            >
              {open.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {confirming ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  loading={close.isPending}
                  onClick={() => close.mutate(year, { onSuccess: () => setConfirming(false) })}
                >
                  {t('ledger.closeYearConfirm')} {year}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
                {t('ledger.closeYear')}
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-faint">{t('ledger.yearCloseHint')}</p>
      {close.error && <p className="text-destructive">{errorText(t, close.error)}</p>}
      {(closed.data ?? []).length > 0 && (
        <ul className="divide-y divide-line">
          {closed.data!.map((c) => (
            <li key={c.year} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                <span className="font-semibold tnum">{c.year}</span>{' '}
                <Badge tone="neutral">{t('ledger.closed')}</Badge>
              </span>
              <span className="text-xs text-muted">
                {c.netProfit < 0 ? t('fin.netLoss') : t('fin.netProfit')}{' '}
                <span className={`tnum ${c.netProfit < 0 ? 'text-destructive' : 'text-fg'}`}>
                  {formatMoney(Math.abs(c.netProfit), currency, locale)}
                </span>{' '}
                · {c.closedByName} · {formatDate(c.closedAt, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------ financial statements */

/** Rows under a heading, grouped by their group (e.g. current assets), with a total line. */
function StatementBlock({
  title,
  rows,
  total,
  currency,
  strong,
}: {
  title: string;
  rows: FinancialRow[];
  total: number;
  currency: string;
  strong?: boolean;
}) {
  const { t, locale } = useT();
  const groups = new Map<string, FinancialRow[]>();
  for (const r of rows)
    groups.set(r.groupName ?? '', [...(groups.get(r.groupName ?? '') ?? []), r]);
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">{t('fin.nothing')}</p>
      ) : (
        [...groups.entries()].map(([group, list]) => (
          <div key={group} className="mb-1">
            {group && <p className="mt-1 text-xs text-muted">{group}</p>}
            <ul>
              {list.map((r) => (
                <li
                  key={r.accountId}
                  className="flex items-center justify-between gap-3 py-0.5 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-xs text-muted tnum">{r.code}</span> {r.name}
                  </span>
                  <span className="shrink-0 tnum">{formatMoney(r.amount, currency, locale)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      <div
        className={`mt-1 flex justify-between border-t border-line pt-1 text-sm ${strong ? 'font-semibold' : 'font-medium'}`}
      >
        <span>{t('ledger.total')}</span>
        <span className="tnum">{formatMoney(total, currency, locale)}</span>
      </div>
    </div>
  );
}

function TotalLine({
  label,
  value,
  currency,
  big,
}: {
  label: string;
  value: number;
  currency: string;
  big?: boolean;
}) {
  const { locale } = useT();
  return (
    <div
      className={`flex justify-between rounded-[var(--radius-app)] bg-surface-2 px-3 py-2 ${big ? 'text-base font-semibold' : 'text-sm font-medium'}`}
    >
      <span>{label}</span>
      <span className={`tnum ${value < 0 ? 'text-destructive' : ''}`}>
        {formatMoney(value, currency, locale)}
      </span>
    </div>
  );
}

/** Income statement (قائمة الدخل): revenue − cost of sales = gross profit; − expenses = net profit. */
function IncomeTab() {
  const { t, locale } = useT();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const { data, isLoading, error } = useIncomeStatement(from, to);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const period = `${formatDate(from, locale)} – ${formatDate(to, locale)}`;
  return (
    <div className="space-y-3">
      <div className="flex max-w-2xl flex-wrap items-end justify-between gap-3">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <ReportActions
          disabled={!data}
          onPrint={() => report.print(paper.current, t('ledger.tabIncome'), period)}
          onExcel={() => {
            if (!data) return;
            const block = (section: string, title: string, total: number): Cell[][] => [
              [title],
              ...data.rows
                .filter((r) => r.section === section)
                .map((r): Cell[] => [r.groupName ?? '', r.code, r.name, { money: r.amount }]),
              ['', '', t('ledger.total'), { money: total }],
              [],
            ];
            report.excel(
              t('ledger.tabIncome'),
              period,
              [t('ledger.group'), t('ledger.code'), t('ledger.account'), t('fin.amount')],
              [
                ...block('REVENUE', t('fin.revenue'), data.revenue),
                ...block('COGS', t('fin.cogs'), data.cogs),
                [t('fin.grossProfit'), '', '', { money: data.grossProfit }],
                [],
                ...block('EXPENSE', t('fin.expenses'), data.expenses),
              ],
              [
                data.netProfit < 0 ? t('fin.netLoss') : t('fin.netProfit'),
                '',
                '',
                { money: data.netProfit },
              ],
            );
          }}
        />
      </div>
      {error && <p className="text-sm text-destructive">{errorText(t, error)}</p>}
      {isLoading || !data ? (
        <Loading />
      ) : (
        <Card className="max-w-2xl">
          <div ref={paper} className="space-y-4">
            <StatementBlock
              title={t('fin.revenue')}
              rows={data.rows.filter((r) => r.section === 'REVENUE')}
              total={data.revenue}
              currency={data.currency}
            />
            <StatementBlock
              title={t('fin.cogs')}
              rows={data.rows.filter((r) => r.section === 'COGS')}
              total={data.cogs}
              currency={data.currency}
            />
            <TotalLine
              label={t('fin.grossProfit')}
              value={data.grossProfit}
              currency={data.currency}
            />
            <StatementBlock
              title={t('fin.expenses')}
              rows={data.rows.filter((r) => r.section === 'EXPENSE')}
              total={data.expenses}
              currency={data.currency}
            />
            <TotalLine
              label={data.netProfit < 0 ? t('fin.netLoss') : t('fin.netProfit')}
              value={data.netProfit}
              currency={data.currency}
              big
            />
          </div>
        </Card>
      )}
    </div>
  );
}

/** Balance sheet (الميزانية العمومية): assets = liabilities + equity (with the profit to date). */
function BalanceTab() {
  const { t, locale } = useT();
  const [asOf, setAsOf] = useState(today());
  const { data, isLoading } = useBalanceSheet(asOf);
  const balanced = data ? data.assets === data.liabilities + data.equity : true;
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const asOfText = `${t('fin.asOf')} ${formatDate(asOf, locale)}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block w-fit">
          <span className="mb-1 block text-xs text-muted">{t('fin.asOf')}</span>
          <input
            className={small}
            type="date"
            value={asOf}
            max={today()}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <ReportActions
          disabled={!data}
          onPrint={() => report.print(paper.current, t('ledger.tabBalance'), asOfText)}
          onExcel={() => {
            if (!data) return;
            const block = (section: string, title: string): Cell[][] => [
              [title],
              ...data.rows
                .filter((r) => r.section === section)
                .map((r): Cell[] => [r.groupName ?? '', r.code, r.name, { money: r.amount }]),
            ];
            report.excel(
              t('ledger.tabBalance'),
              asOfText,
              [t('ledger.group'), t('ledger.code'), t('ledger.account'), t('fin.amount')],
              [
                ...block('ASSET', t('fin.assets')),
                ['', '', t('ledger.total'), { money: data.assets }],
                [],
                ...block('LIABILITY', t('fin.liabilities')),
                ['', '', t('ledger.total'), { money: data.liabilities }],
                [],
                ...block('EQUITY', t('fin.equity')),
                ['', '', t('fin.profitToDate'), { money: data.profitToDate }],
                ['', '', t('ledger.total'), { money: data.equity }],
                [],
              ],
              [t('fin.liabilitiesEquity'), '', '', { money: data.liabilities + data.equity }],
            );
          }}
        />
      </div>
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div ref={paper} className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2 print:grid-cols-2">
            <Card className="space-y-4">
              <StatementBlock
                title={t('fin.assets')}
                rows={data.rows.filter((r) => r.section === 'ASSET')}
                total={data.assets}
                currency={data.currency}
                strong
              />
            </Card>
            <Card className="space-y-4">
              <StatementBlock
                title={t('fin.liabilities')}
                rows={data.rows.filter((r) => r.section === 'LIABILITY')}
                total={data.liabilities}
                currency={data.currency}
              />
              <StatementBlock
                title={t('fin.equity')}
                rows={[
                  ...data.rows.filter((r) => r.section === 'EQUITY'),
                  {
                    accountId: 'profit',
                    code: '',
                    name: t('fin.profitToDate'),
                    section: 'EQUITY',
                    groupName: null,
                    amount: data.profitToDate,
                  },
                ]}
                total={data.equity}
                currency={data.currency}
              />
              <TotalLine
                label={t('fin.liabilitiesEquity')}
                value={data.liabilities + data.equity}
                currency={data.currency}
                big
              />
            </Card>
          </div>
          <p className={`text-sm ${balanced ? 'text-positive' : 'text-destructive'}`}>
            {balanced ? t('fin.balanced') : t('fin.unbalanced')} · {t('fin.assets')}{' '}
            <span className="tnum">{formatMoney(data.assets, data.currency, locale)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
