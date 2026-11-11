import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Party, Permission, TranslationKey } from '@skb/shared';
import { Card, PageHeader } from '../components/ui';
import { PartyPicker } from '../components/PartyPicker';
import { PartyAccount } from '../components/PartyAccount';
import { WarehouseSelect } from '../components/WarehouseSelect';
import { StatementBody } from '../components/LedgerStatementSheet';
import { ExpenseStatementBody, WarehouseStatementBody } from '../components/OtherStatements';
import { MoneyStatementBody } from './MoneyPage';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { api } from '../lib/api';
import {
  useExpenseCategories,
  useLedgerAccounts,
  useMoneyAccounts,
  useWarehouses,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

type Kind = 'CUSTOMER' | 'SUPPLIER' | 'CARRIER' | 'CASH' | 'EXPENSE' | 'WAREHOUSE' | 'LEDGER';
const PARTY_KINDS = ['CUSTOMER', 'SUPPLIER', 'CARRIER'] as const;
type PartyKind = (typeof PARTY_KINDS)[number];
const isParty = (k: Kind): k is PartyKind => (PARTY_KINDS as readonly Kind[]).includes(k);

/** Each kind of statement is a permission of its own (owner, 2026-10-23). */
const KINDS: { kind: Kind; label: TranslationKey; permission: Permission }[] = [
  { kind: 'CUSTOMER', label: 'statement.customers', permission: 'statement:customers' },
  { kind: 'SUPPLIER', label: 'statement.suppliers', permission: 'statement:suppliers' },
  { kind: 'CARRIER', label: 'statement.carriers', permission: 'statement:carriers' },
  { kind: 'CASH', label: 'statement.cash', permission: 'statement:money' },
  { kind: 'EXPENSE', label: 'statement.expenses', permission: 'statement:expenses' },
  { kind: 'WAREHOUSE', label: 'statement.warehouses', permission: 'statement:warehouses' },
  { kind: 'LEDGER', label: 'statement.ledger', permission: 'statement:ledger' },
];

const PARTY_LABEL: Record<PartyKind, TranslationKey> = {
  CUSTOMER: 'invoice.customer',
  SUPPLIER: 'invoice.supplier',
  CARRIER: 'parties.carrier',
};

/**
 * Account statement (كشف الحساب) as its own page, like the old program (owner, 2026-10-01): pick
 * the kind of account, then the account; the period and filters are set on the statement itself.
 * Beside customers and suppliers (the whole account, PartyAccount) it covers shipping companies,
 * cash boxes and banks, expense items, warehouses and the chart of accounts (owner, 2026-10-19).
 * `?party=<id>` opens a customer's, supplier's or shipping company's.
 */
export function StatementPage() {
  const { t } = useT();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const kinds = KINDS.filter((k) => can(k.permission));
  // `?kind=CASH&account=<id>` opens a cash box's or bank's (the Cash & Banks page's button).
  const [askedKind, setKind] = useState<Kind>(() => {
    const asked = params.get('kind') as Kind | null;
    return asked && KINDS.some((k) => k.kind === asked) ? asked : (kinds[0]?.kind ?? 'CUSTOMER');
  });
  // Only a kind the person may open (owner, 2026-11-10: given the warehouses' statement alone, it
  // still loaded customers and never showed the warehouses).
  const kind: Kind = kinds.some((k) => k.kind === askedKind)
    ? askedKind
    : (kinds[0]?.kind ?? askedKind);
  const [party, setParty] = useState<Party | null>(null);
  const [pick, setPick] = useState(() => params.get('account') ?? '');
  const askedAccount = params.get('account');
  const [seenAccount, setSeenAccount] = useState(askedAccount);
  if (askedAccount && askedAccount !== seenAccount) {
    setSeenAccount(askedAccount);
    const asked = params.get('kind') as Kind | null;
    if (asked && KINDS.some((k) => k.kind === asked)) setKind(asked);
    setPick(askedAccount);
  }
  const linked = params.get('party');
  const [loaded, setLoaded] = useState<string | null>(null);
  if (linked && linked !== loaded && linked !== party?.id) {
    setLoaded(linked);
    void api
      .get<Party>(`/parties/${linked}`)
      .then((p) => {
        setParty(p);
        setKind(
          p.types.includes('CUSTOMER')
            ? 'CUSTOMER'
            : p.types.includes('SUPPLIER')
              ? 'SUPPLIER'
              : 'CARRIER',
        );
      })
      .catch(() => undefined);
  }

  const money = useMoneyAccounts(kind === 'CASH');
  const expenses = useExpenseCategories(kind === 'EXPENSE');
  const warehouses = useWarehouses();
  const ledger = useLedgerAccounts(kind === 'LEDGER');

  const options: { id: string; name: string }[] =
    kind === 'CASH'
      ? (money.data ?? []).map((a) => ({ id: a.id, name: a.name }))
      : kind === 'EXPENSE'
        ? (expenses.data ?? []).map((c) => ({
            id: c.id,
            name: c.parentName ? `${c.parentName} / ${c.name}` : c.name,
          }))
        : kind === 'LEDGER'
          ? (ledger.data ?? []).map((a) => ({ id: a.id, name: `${a.code} ${a.name}` }))
          : [];
  const chosen = options.find((o) => o.id === pick);

  let body = null;
  if (isParty(kind)) {
    if (party) body = <PartyAccount key={party.id} party={party} />;
  } else if (pick) {
    const card = (child: ReactNode) => <Card key={`${kind}-${pick}`}>{child}</Card>;
    if (kind === 'CASH') {
      const a = money.data?.find((x) => x.id === pick);
      if (a) body = card(<MoneyStatementBody a={a} />);
    } else if (kind === 'EXPENSE' && chosen) {
      body = card(<ExpenseStatementBody id={pick} title={chosen.name} />);
    } else if (kind === 'WAREHOUSE') {
      const w = warehouses.data?.find((x) => x.id === pick);
      body = card(<WarehouseStatementBody id={pick} title={w?.name ?? ''} />);
    } else if (kind === 'LEDGER' && chosen) {
      body = card(<StatementBody kind="accounts" id={pick} title={chosen.name} />);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('statement.title')} />
      <Card className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('statement.type')}</span>
          <select
            className={field}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setParty(null);
              setPick('');
              setParams({}, { replace: true });
            }}
          >
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {t(k.label)}
              </option>
            ))}
          </select>
        </label>
        {isParty(kind) ? (
          <PartyPicker
            key={kind}
            type={kind}
            withCode
            value={party}
            onChange={(p) => {
              setParty(p);
              setParams(p ? { party: p.id } : {}, { replace: true });
            }}
            label={t(PARTY_LABEL[kind])}
            placeholder={t('statement.pick')}
          />
        ) : kind === 'WAREHOUSE' ? (
          <WarehouseSelect
            value={pick}
            onChange={setPick}
            includeClosed
            label={t('statement.pickAccount')}
          />
        ) : (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('statement.pickAccount')}</span>
            <select className={field} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t('statement.pick')}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </Card>
      {body ?? (
        <Card>
          <p className="py-6 text-center text-sm text-muted">{t('statement.pick')}</p>
        </Card>
      )}
    </div>
  );
}
