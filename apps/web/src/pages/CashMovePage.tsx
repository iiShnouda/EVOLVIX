import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { TableColumns } from '../components/TableColumns';
import { SidedMoney } from '../components/LedgerStatementSheet';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { api } from '../lib/api';
import { useWorkDraft } from '../lib/workDraft';
import {
  useCreateCashTransfer,
  useCreateVoucher,
  useMoneyAccounts,
  useOpenInvoices,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

type SideKind = 'CUSTOMER' | 'SUPPLIER' | 'MONEY';

interface Side {
  kind: SideKind;
  party: Party | null;
  accountId: string;
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

  const [from, setFrom] = useState<Side>({ kind: 'CUSTOMER', party: null, accountId: '' });
  const [to, setTo] = useState<Side>({ kind: 'MONEY', party: null, accountId: '' });
  // The deposit side starts at the main cash box.
  const toAccountId = to.accountId || (to.kind === 'MONEY' ? (mainBox?.id ?? '') : '');
  const [amount, setAmount] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
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

  // What this is: a receipt, a payment or a transfer (party → party isn't done here).
  const what =
    from.kind !== 'MONEY' && to.kind === 'MONEY'
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
  const moneyId = what === 'RECEIPT' ? toAccountId : what === 'PAYMENT' ? from.accountId : '';
  const moneyAccount = list.find((a) => a.id === moneyId);
  const ready =
    !!what &&
    allowed &&
    total > 0 &&
    allocated <= total &&
    !overInvoice &&
    (what === 'TRANSFER'
      ? !!from.accountId && !!toAccountId && from.accountId !== toAccountId
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
        <div>
          <span className="block text-xs text-muted">{t('common.date')}</span>
          <span className="tnum">{formatDate(companyToday(), locale)}</span>
        </div>
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

      <div className="grid gap-4 lg:grid-cols-2">
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
          loading={open.isLoading}
          alloc={alloc}
          setAlloc={setAlloc}
          onSpread={spread}
        />
      </div>
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
}: {
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
  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? accounts[0]?.currency ?? 'EGP';
  // Plain amounts in the table, as on the old screen.
  const plain = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <Card className="space-y-3">
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
        </select>
      </label>
      {side.kind === 'MONEY' ? (
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
