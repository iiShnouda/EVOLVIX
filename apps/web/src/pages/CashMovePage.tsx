import { confirm } from '../lib/confirm';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  toMajor,
  toMinor,
  companyToday,
  type MoneyAccount,
  type MoneyAccountKind,
  type OpenInvoice,
  type Party,
  type PaymentMethod,
  type TranslationKey,
} from '@skb/shared';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { PartyPicker } from '../components/PartyPicker';
import { DocumentDateField, dayToSend } from '../components/DocumentDate';
import { TableColumns } from '../components/TableColumns';
import { SidedMoney } from '../components/LedgerStatementSheet';
import { useDeviceInfo } from '../lib/device';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { api } from '../lib/api';
import { useWorkDraft } from '../lib/workDraft';
import {
  useCreateCashTransfer,
  useCreateVoucher,
  useDeleteExpenseCategory,
  useExpenseCategories,
  useMoneyAccounts,
  useOpenInvoices,
  useSaveExpenseCategory,
  useSettleDiscount,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** EXPENSE: money paid out for an expense item (owner, 2026-10-02), only as the deposit side. */
type SideKind = 'CUSTOMER' | 'SUPPLIER' | 'MONEY' | 'EXPENSE';

interface Side {
  kind: SideKind;
  party: Party | null;
  accountId: string;
  /** The expense item, on an EXPENSE side. */
  categoryId?: string;
}

/** What is kept of a withdraw / deposit being written (parties by id; read again). */
interface CashMoveDraft {
  from: { kind: SideKind; partyId: string | null; accountId: string };
  to: { kind: SideKind; partyId: string | null; accountId: string };
  amount: string;
  alloc: Record<string, string>;
  notes: string;
}

/** How money reaches or leaves an account of each kind. */
const METHOD_OF: Record<MoneyAccountKind, PaymentMethod> = {
  CASH_BOX: 'CASH',
  CUSTODY: 'CASH',
  BANK: 'BANK_TRANSFER',
  WALLET: 'MOBILE_WALLET',
  POST: 'POST',
};

/**
 * Withdraw / deposit (سحب / إيداع نقدي), the old program's screen (owner, 2026-10-01): money is
 * taken from one account and put into another. A customer paying = withdraw from their account,
 * deposit into the cash box (the branch's own, unless another is picked). Each side is a customer,
 * a supplier or a cash box / bank, picked by code or name, with its balance; a customer's or
 * supplier's open invoices are listed to settle. It is saved as what it is: a receipt (party → cash
 * box), a payment (cash box → party) or a transfer (cash box → cash box), each under its own
 * permission; the server checks the same.
 */
export function CashMovePage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const accounts = useMoneyAccounts();
  const list = (accounts.data ?? []).filter((a) => a.isActive);
  const mainBox = list.find((a) => a.isDefault && a.kind === 'CASH_BOX');

  // Opened as "pull from this box" (a manager taking a box's cash without a handover): box → box.
  const [params] = useSearchParams();
  const pullFrom = params.get('from') ?? '';
  const [from, setFrom] = useState<Side>(
    pullFrom
      ? { kind: 'MONEY', party: null, accountId: pullFrom }
      : { kind: 'CUSTOMER', party: null, accountId: '' },
  );
  const [to, setTo] = useState<Side>({
    kind: 'MONEY',
    party: null,
    accountId: pullFrom ? (params.get('to') ?? '') : '',
  });
  // The deposit side starts at the main cash box.
  const toAccountId = to.accountId || (to.kind === 'MONEY' ? (mainBox?.id ?? '') : '');
  const [amount, setAmount] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [docDate, setDocDate] = useState(companyToday);
  const [done, setDone] = useState<string | null>(null);

  // Kept on the server while it is written, brought back after a crash or on another device.
  const keep = (x: Side) => ({
    kind: x.kind,
    partyId: x.party?.id ?? null,
    accountId: x.accountId,
  });
  useWorkDraft<CashMoveDraft>(
    1,
    () =>
      !amount.trim() && !notes.trim() && !from.party && !to.party
        ? null
        : { from: keep(from), to: keep(to), amount, alloc, notes },
    async (d) => {
      const side = async (x: CashMoveDraft['from']): Promise<Side> => ({
        kind: x.kind,
        accountId: typeof x.accountId === 'string' ? x.accountId : '',
        party: x.partyId ? await api.get<Party>(`/parties/${x.partyId}`).catch(() => null) : null,
      });
      if (d.from) setFrom(await side(d.from));
      if (d.to) setTo(await side(d.to));
      if (typeof d.amount === 'string') setAmount(d.amount);
      if (d.alloc && typeof d.alloc === 'object') setAlloc(d.alloc);
      if (typeof d.notes === 'string') setNotes(d.notes);
    },
  );

  const voucher = useCreateVoucher();
  const transfer = useCreateCashTransfer();
  const pending = voucher.isPending || transfer.isPending;
  const error = voucher.error ?? transfer.error;

  // What this is: a receipt, a payment, an expense or a transfer (party → party isn't done here).
  const what =
    from.kind === 'MONEY' && to.kind === 'EXPENSE'
      ? 'EXPENSE'
      : from.kind !== 'MONEY' && from.kind !== 'EXPENSE' && to.kind === 'MONEY'
        ? 'RECEIPT'
        : from.kind === 'MONEY' && to.kind !== 'MONEY'
          ? 'PAYMENT'
          : from.kind === 'MONEY' && to.kind === 'MONEY'
            ? 'TRANSFER'
            : null;
  const allowed =
    what === 'RECEIPT'
      ? can('receipts:create')
      : what === 'PAYMENT'
        ? can('payments:create')
        : what === 'EXPENSE'
          ? can('expenses:create')
          : what === 'TRANSFER'
            ? can('cash:transfer')
            : false;

  // The invoices this settles: a customer's sales it is received for, a supplier's purchases it pays.
  const party = what === 'RECEIPT' ? from.party : what === 'PAYMENT' ? to.party : null;
  const docSide =
    what === 'RECEIPT' && from.kind === 'CUSTOMER'
      ? 'sales'
      : what === 'PAYMENT' && to.kind === 'SUPPLIER'
        ? 'purchases'
        : null;
  const open = useOpenInvoices(party?.id ?? '', docSide ?? 'sales', !!party && !!docSide);
  const invoices = (open.data ?? []).filter((o) => docSide === 'purchases' || !o.onCodParcel);

  const minor = (v: string) => (v.trim() && Number(v) > 0 ? toMinor(Number(v)) : 0);
  const total = minor(amount);
  const allocated = Object.values(alloc).reduce((s, v) => s + minor(v), 0);
  const overInvoice = invoices.some((o) => minor(alloc[o.documentId] ?? '') > o.outstanding);
  const moneyId =
    what === 'RECEIPT'
      ? toAccountId
      : what === 'PAYMENT' || what === 'EXPENSE'
        ? from.accountId
        : '';
  const moneyAccount = list.find((a) => a.id === moneyId);
  const ready =
    !!what &&
    allowed &&
    total > 0 &&
    allocated <= total &&
    !overInvoice &&
    (what === 'TRANSFER'
      ? !!from.accountId && !!toAccountId && from.accountId !== toAccountId
      : what === 'EXPENSE'
        ? !!to.categoryId && !!moneyAccount
        : !!party && !!moneyAccount);

  function spread() {
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
    if (!ready || !what) return;
    try {
      const saved =
        what === 'TRANSFER'
          ? await transfer.mutateAsync({
              fromAccountId: from.accountId,
              toAccountId,
              amount: total,
              notes: notes.trim() || undefined,
              documentDate: dayToSend(docDate),
            })
          : what === 'EXPENSE'
            ? await voucher.mutateAsync({
                kind: 'expenses',
                input: {
                  categoryId: to.categoryId,
                  lines: [
                    {
                      method: METHOD_OF[moneyAccount!.kind],
                      accountId: moneyAccount!.id,
                      amount: total,
                    },
                  ],
                  notes: notes.trim() || undefined,
                  documentDate: dayToSend(docDate),
                },
              })
            : await voucher.mutateAsync({
                kind: what === 'RECEIPT' ? 'receipts' : 'payments',
                input: {
                  partyId: party!.id,
                  lines: [
                    {
                      method: METHOD_OF[moneyAccount!.kind],
                      accountId: moneyAccount!.id,
                      amount: total,
                    },
                  ],
                  allocations: Object.entries(alloc)
                    .map(([documentId, v]) => ({ documentId, amount: minor(v) }))
                    .filter((a) => a.amount > 0),
                  notes: notes.trim() || undefined,
                  documentDate: dayToSend(docDate),
                },
              });
      setDone(saved.number);
      setAmount('');
      setAlloc({});
      setNotes('');
      setFrom((s) => ({ ...s, party: null }));
      setTo((s) => ({ ...s, party: null }));
    } catch {
      /* shown below */
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('move.title')}
        action={
          <Button
            variant="ghost"
            size="sm"
            icon="close"
            onClick={() => navigate('/receipts?tab=vouchers')}
          >
            {t('invoice.back')}
          </Button>
        }
      />

      <Card className="flex flex-wrap items-end gap-4 text-sm">
        {can('documents:backdate') ? (
          <DocumentDateField value={docDate} onChange={setDocDate} className="w-44" />
        ) : (
          <div>
            <span className="block text-xs text-muted">{t('common.date')}</span>
            <span className="tnum">{formatDate(companyToday(), locale)}</span>
          </div>
        )}
        <div>
          <span className="block text-xs text-muted">{t('move.as')}</span>
          <span className="font-medium">
            {what ? t(`money.voucher.${what}` as TranslationKey) : '—'}
          </span>
        </div>
        {!what && <span className="text-xs text-warning">{t('move.partyToParty')}</span>}
        {what && !allowed && (
          <span className="text-xs text-destructive">{t('move.noPermission')}</span>
        )}
        {done && (
          <span className="ms-auto rounded-full bg-positive-soft px-3 py-1 text-xs text-positive">
            {t('move.saved')}: <span className="tnum">{done}</span>
          </span>
        )}
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <SideCard
          title={t('move.from')}
          side={from}
          onChange={(s) => {
            setFrom(s);
            setAlloc({});
            setDone(null);
          }}
          accounts={list}
          accountId={from.accountId}
          invoices={what === 'RECEIPT' && docSide ? invoices : null}
          loading={open.isLoading}
          alloc={alloc}
          setAlloc={setAlloc}
          onSpread={spread}
        />
        <SideCard
          title={t('move.to')}
          side={to}
          onChange={(s) => {
            setTo(s);
            setAlloc({});
            setDone(null);
          }}
          accounts={list}
          accountId={toAccountId}
          invoices={what === 'PAYMENT' && docSide ? invoices : null}
          canExpense
          loading={open.isLoading}
          alloc={alloc}
          setAlloc={setAlloc}
          onSpread={spread}
        />
      </div>

      {/* The amount under the two sides (owner, 2026-10-01). */}
      <Card className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('move.amount')}</span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className={`${field} text-base font-semibold tnum`}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setDone(null);
            }}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('invoice.notes')}</span>
          <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <Button
          icon="check"
          loading={pending}
          disabled={!ready || pending}
          onClick={() => void save()}
        >
          {t('common.save')}
        </Button>
        {what === 'TRANSFER' && from.accountId && from.accountId === toAccountId && (
          <p className="text-xs text-destructive sm:col-span-3">{t('move.sameAccount')}</p>
        )}
        {allocated > total && (
          <p className="text-xs text-destructive sm:col-span-3">{t('money.overAllocated')}</p>
        )}
        {error && <p className="text-sm text-destructive sm:col-span-3">{errorText(t, error)}</p>}
      </Card>
    </div>
  );
}

/**
 * Take what is left on the account off (owner, 2026-10-02: "if 5 or 10 pounds are left, the
 * accountant may give the customer that as a discount"): a settlement discount, no money moves.
 */
function SettleRest({
  party,
  currency,
  onDone,
}: {
  party: Party;
  currency: string;
  onDone: (p: Party) => void;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const settle = useSettleDiscount();
  const left = Math.abs(party.balance);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(toMajor(left)));
  const [notes, setNotes] = useState('');
  if (!can('vouchers:discount')) return null;
  const minor = toMinor(Number(amount) || 0);
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t('settle.button')}
      </Button>
    );
  return (
    <div className="space-y-2 rounded-[var(--radius-app)] border border-line p-3">
      <p className="flex justify-between text-xs text-muted">
        <span>{t('settle.left')}</span>
        <span className="tnum">{formatMoney(left, currency, locale)}</span>
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-[7rem] flex-1">
          <span className="mb-0.5 block text-xs text-muted">{t('settle.amount')}</span>
          <input
            className={`${field} tnum`}
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block min-w-[7rem] flex-[2]">
          <span className="mb-0.5 block text-xs text-muted">{t('invoice.notes')}</span>
          <input
            className={field}
            value={notes}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <Button
          size="sm"
          icon="check"
          loading={settle.isPending}
          disabled={minor <= 0 || minor > left}
          onClick={async () => {
            try {
              await settle.mutateAsync({
                partyId: party.id,
                amount: minor,
                notes: notes || undefined,
              });
              onDone(await api.get<Party>(`/parties/${party.id}`));
            } catch {
              /* shown below */
            }
          }}
        >
          {t('settle.title')}
        </Button>
      </div>
      {settle.error && <p className="text-xs text-destructive">{errorText(t, settle.error)}</p>}
    </div>
  );
}

/** One side: a customer, a supplier or a cash box / bank, its balance and its open invoices. */
function SideCard({
  title,
  side,
  onChange,
  accounts,
  accountId,
  invoices,
  loading,
  alloc,
  setAlloc,
  onSpread,
  canExpense,
}: {
  /** The deposit side may be an expense item. */
  canExpense?: boolean;
  title: string;
  side: Side;
  onChange: (s: Side) => void;
  accounts: MoneyAccount[];
  accountId: string;
  invoices: OpenInvoice[] | null;
  loading: boolean;
  alloc: Record<string, string>;
  setAlloc: (a: Record<string, string>) => void;
  onSpread: () => void;
}) {
  const { t, locale } = useT();
  const isPhone = useDeviceInfo().deviceClass === 'phone';
  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? accounts[0]?.currency ?? 'EGP';
  // Plain amounts in the table, as on the old screen.
  const plain = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <Card className="min-w-0 space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <label className="block">
        <span className="mb-0.5 block text-xs text-muted">{t('move.kind')}</span>
        <select
          className={field}
          value={side.kind}
          onChange={(e) =>
            onChange({ kind: e.target.value as SideKind, party: null, accountId: '' })
          }
        >
          <option value="CUSTOMER">{t('move.customer')}</option>
          <option value="SUPPLIER">{t('move.supplier')}</option>
          <option value="MONEY">{t('move.money')}</option>
          {canExpense && <option value="EXPENSE">{t('move.expense')}</option>}
        </select>
      </label>
      {side.kind === 'EXPENSE' ? (
        <ExpenseItemPicker
          value={side.categoryId ?? ''}
          onChange={(id) => onChange({ ...side, categoryId: id })}
        />
      ) : side.kind === 'MONEY' ? (
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('move.account')}</span>
          <select
            className={field}
            value={accountId}
            onChange={(e) => onChange({ ...side, accountId: e.target.value })}
          >
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.branchName}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <PartyPicker
          type={side.kind}
          withCode
          value={side.party}
          onChange={(p) => onChange({ ...side, party: p })}
          label={t(side.kind === 'CUSTOMER' ? 'invoice.customer' : 'invoice.supplier')}
          placeholder={t(
            side.kind === 'CUSTOMER' ? 'invoice.selectCustomer' : 'invoice.selectSupplier',
          )}
        />
      )}
      {side.kind !== 'EXPENSE' && (
        <div className="flex items-center justify-between rounded-[var(--radius-app)] bg-surface-2 px-3 py-2 text-sm">
          <span className="text-muted">{t('move.balance')}</span>
          {side.kind === 'MONEY' ? (
            <span className="font-semibold tnum">
              {account ? formatMoney(account.balance, currency, locale) : '—'}
            </span>
          ) : side.party ? (
            <SidedMoney value={side.party.balance} currency={currency} />
          ) : (
            <span>—</span>
          )}
        </div>
      )}
      {side.party && side.party.balance !== 0 && (
        <SettleRest
          key={`${side.party.id}:${side.party.balance}`}
          party={side.party}
          currency={currency}
          onDone={(p) => onChange({ ...side, party: p })}
        />
      )}

      {invoices && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{t('move.docs')}</span>
            {invoices.length > 0 && (
              <Button size="sm" variant="ghost" onClick={onSpread}>
                {t('move.auto')}
              </Button>
            )}
          </div>
          {loading ? (
            <div className="grid place-items-center py-4 text-muted">
              <Spinner size={18} />
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted">{t('move.noDocs')}</p>
          ) : isPhone ? (
            // Phones (owner, 2026-10-19): each invoice on its own row, its payment box in view.
            <ul className="max-h-96 divide-y divide-[var(--c-line)] overflow-y-auto rounded-[var(--radius-app)] border border-line text-[13px]">
              {invoices.map((o) => (
                <li key={o.documentId} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {t(`doc.${o.type}` as TranslationKey)}
                      <span className="block whitespace-nowrap tnum" dir="ltr">
                        {o.number}
                      </span>
                    </p>
                    <p className="text-xs text-muted tnum">
                      {formatDate(o.issueDate, locale, true)} · {t('move.value')}{' '}
                      {plain.format(toMajor(o.grandTotal))}
                    </p>
                    <p className="text-xs font-medium tnum">
                      {t('move.left')} {plain.format(toMajor(o.outstanding))}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    placeholder={t('move.settle')}
                    aria-label={`${t('move.settle')} ${o.number}`}
                    className="h-10 w-24 shrink-0 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm tnum outline-none focus:border-brand"
                    value={alloc[o.documentId] ?? ''}
                    onChange={(e) => setAlloc({ ...alloc, [o.documentId]: e.target.value })}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <TableColumns id="move.invoices">
              <div className="max-h-80 overflow-auto rounded-[var(--radius-app)] border border-line">
                <table className="w-full whitespace-nowrap text-[13px]">
                  <thead className="sticky top-0 border-b border-line bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="px-2 py-2 text-start font-medium">{t('move.docType')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('move.document')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('common.date')}</th>
                      <th className="px-2 py-2 text-end font-medium">{t('move.value')}</th>
                      <th className="px-2 py-2 text-end font-medium">{t('move.left')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('move.settle')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--c-line)]">
                    {invoices.map((o) => (
                      <tr key={o.documentId}>
                        <td className="px-2 py-1.5">{t(`doc.${o.type}` as TranslationKey)}</td>
                        <td className="px-2 py-1.5 tnum">{o.number}</td>
                        <td className="px-2 py-1.5 tnum">
                          {formatDate(o.issueDate, locale, true)}
                        </td>
                        <td className="px-2 py-1.5 text-end tnum">
                          {plain.format(toMajor(o.grandTotal))}
                        </td>
                        <td className="px-2 py-1.5 text-end font-medium tnum">
                          {plain.format(toMajor(o.outstanding))}
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            aria-label={`${t('move.settle')} ${o.number}`}
                            className="h-8 w-20 rounded-[var(--radius-app)] border border-line bg-surface px-1.5 text-sm tnum outline-none focus:border-brand"
                            value={alloc[o.documentId] ?? ''}
                            onChange={(e) => setAlloc({ ...alloc, [o.documentId]: e.target.value })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableColumns>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * The expense item an expense goes to, with adding a new item or deleting one nothing used yet
 * (owner, 2026-10-02), for whoever may manage expense items.
 */
function ExpenseItemPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useT();
  const can = useCan();
  const items = useExpenseCategories();
  const save = useSaveExpenseCategory();
  const remove = useDeleteExpenseCategory();
  const [name, setName] = useState('');
  const manage = can('expense_categories:manage');
  const list = (items.data ?? []).filter((c) => c.isActive);
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-0.5 block text-xs text-muted">{t('move.expenseItem')}</span>
        <span className="flex gap-1.5">
          <select className={field} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentName ? `${c.parentName} › ` : ''}
                {c.name}
              </option>
            ))}
          </select>
          {manage && value && (
            <Button
              size="sm"
              variant="ghost"
              icon="close"
              loading={remove.isPending}
              title={t('move.deleteItem')}
              aria-label={t('move.deleteItem')}
              onClick={async () => {
                if (!(await confirm({ message: t('move.deleteItemAsk'), danger: true }))) return;
                try {
                  await remove.mutateAsync(value);
                  onChange('');
                } catch {
                  /* shown below */
                }
              }}
            />
          )}
        </span>
      </label>
      {manage && (
        <span className="flex gap-1.5">
          <input
            className={field}
            placeholder={t('move.newItem')}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            disabled={!name.trim()}
            loading={save.isPending}
            onClick={async () => {
              try {
                const made = await save.mutateAsync({ input: { name: name.trim() } });
                setName('');
                onChange(made.id);
              } catch {
                /* shown below */
              }
            }}
          >
            {t('common.add')}
          </Button>
        </span>
      )}
      {(save.error || remove.error) && (
        <p className="text-xs text-destructive">{errorText(t, save.error ?? remove.error)}</p>
      )}
    </div>
  );
}
