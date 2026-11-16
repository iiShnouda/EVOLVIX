import { useDeferredValue, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  balanceView,
  formatMoney,
  partySchema,
  toMajor,
  toMinor,
  type Party,
  type PartyType,
  type Permission,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import {
  NationalIdInput,
  PhoneInput,
  PhoneList,
  anyIdProblem,
  useCompanyCountry,
} from '../components/PhoneFields';
import { IdCardFields, IdCardView, type IdSide } from '../components/IdCards';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { BALANCE_PERMISSIONS, mayOpenStatement, useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import {
  useCreateParty,
  useParties,
  usePageSize,
  usePriceLists,
  useSetCreditLimit,
  useSetPartyPriceLevels,
  useUpdateParty,
} from '../lib/queries';
import type { Tone } from '../components/ui';
import { PartyLink } from '../components/PartyContact';
import { Pager } from '../components/Pager';
import { TableColumns } from '../components/TableColumns';
import { useDeviceInfo } from '../lib/device';
import { useAuth } from '../stores/auth';
import {
  Filter,
  FilterPanel,
  filterField,
  useKeptFilters,
  useSettled,
} from '../components/FilterPanel';

// A factory is a supplier, so there is no separate factory type.
const TYPES: PartyType[] = ['CUSTOMER', 'SUPPLIER', 'CARRIER'];
/** Adding each kind has its own permission (owner, 2026-10-19). */
export const CREATE_PERMISSION = {
  CUSTOMER: 'parties:create_customer',
  SUPPLIER: 'parties:create_supplier',
  CARRIER: 'parties:create_carrier',
} as const satisfies Record<PartyType, Permission>;

const TYPE_LABEL: Record<PartyType, TranslationKey> = {
  CUSTOMER: 'parties.customer',
  SUPPLIER: 'parties.supplier',
  CARRIER: 'parties.carrier',
};

/** A supplier-only party is a factory: its contact is the owner and its address the factory's. */
const isFactory = (types: PartyType[]) => types.includes('SUPPLIER') && !types.includes('CUSTOMER');
const MAX_OTHER_PHONES = 5;
/** The shipping-company choice for a company with no file of its own. */
const OTHER = '__other__';

const field =
  'h-8 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2 text-xs outline-none focus:border-brand disabled:opacity-70';
const input =
  'h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand disabled:opacity-60';

/** How an account stands (owner, 2026-10-02), to filter the list by. */
const STATUSES = ['OVER_LIMIT', 'NEAR_LIMIT', 'OWES', 'CREDIT', 'SETTLED', 'CLOSED'] as const;

/** What the list remembers while the app is open. */
const PARTY_FILTERS = { search: '', code: '', phone: '', closed: '' };

/** The code box's name for the kind of account searched (owner, 2026-10-22). */
/** Whoever may change any part of an account opens its form. */
const EDIT_PERMISSIONS: Permission[] = [
  'parties:edit',
  'parties:close',
  'parties:contact',
  'parties:id_cards_edit',
];

function codeLabel(type: PartyType | ''): TranslationKey {
  return type === 'CUSTOMER'
    ? 'parties.customerCode'
    : type === 'SUPPLIER'
      ? 'parties.supplierCode'
      : type === 'CARRIER'
        ? 'parties.carrierCode'
        : 'parties.code';
}

/** The name box's name for the kind of account searched. */
function nameSearchLabel(type: PartyType | ''): TranslationKey {
  return type === 'CUSTOMER'
    ? 'parties.customerName'
    : type === 'SUPPLIER'
      ? 'parties.supplierName'
      : type === 'CARRIER'
        ? 'parties.carrierName'
        : 'parties.name';
}

export function PartiesPage() {
  const { t } = useT();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  // Kept while the app is open, as on the sales list (owner, 2026-11-16: the detailed search).
  const myId = useAuth((st) => st.user?.id);
  const [kept, keep, clearKept] = useKeptFilters(`skb.list.${myId ?? ''}.parties`, PARTY_FILTERS);
  const search = kept.search;
  const setSearch = (v: string) => keep({ search: v });
  const code = kept.code;
  const setCode = (v: string) => keep({ code: v });
  const [type, setType] = useState<PartyType | ''>(() =>
    (TYPES as string[]).includes(params.get('type') ?? '') ? (params.get('type') as PartyType) : '',
  );
  const status = params.get('status') ?? '';
  const setStatus = (s: string) => {
    const next = new URLSearchParams(params);
    if (s) next.set('status', s);
    else next.delete('status');
    setParams(next, { replace: true });
  };
  const showClosed = kept.closed === '1';
  const setShowClosed = (v: boolean) => keep({ closed: v ? '1' : '' });
  const [editing, setEditing] = useState<Party | 'new' | null>(null);
  // `?new=1` (the quick-action button): the add form opens at once.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (TYPES.some((x) => can(CREATE_PERMISSION[x]))) setEditing('new');
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize('parties', 50);
  const query = useDeferredValue(search.trim());
  const codeQuery = useDeferredValue(/^\d+$/.test(code.trim()) ? code.trim() : '');
  const phoneQuery = useSettled(kept.phone.replace(/[^\d+]/g, ''));
  useEffect(() => setPage(1), [query, codeQuery, phoneQuery, type, status, showClosed]);
  const { deviceClass } = useDeviceInfo();
  const [opened, setOpened] = useState<Party | null>(null);
  const detailed = [type, status, kept.phone.trim(), kept.closed].filter(Boolean).length;
  function clearDetailed() {
    setType('');
    setStatus('');
    clearKept();
  }
  const { data, isLoading } = useParties({
    page,
    pageSize: size,
    type: type || undefined,
    search: query || undefined,
    code: codeQuery || undefined,
    status: status || undefined,
    phone: phoneQuery || undefined,
    active: showClosed || status === 'CLOSED' ? undefined : true,
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('parties.title')}
        subtitle={data ? `${data.total} ${t('common.total')}` : undefined}
        action={
          TYPES.some((x) => can(CREATE_PERMISSION[x])) ? (
            <Button icon="plus" onClick={() => setEditing('new')}>
              {t('parties.add')}
            </Button>
          ) : undefined
        }
      />

      <FilterPanel
        id="parties"
        active={detailed}
        onClear={clearDetailed}
        quick={
          <>
            <label className="block w-24 min-w-0 sm:w-32">
              <span className="mb-0.5 block text-xs text-muted">{t(codeLabel(type))}</span>
              <input
                className={`${filterField} tnum`}
                inputMode="numeric"
                dir="ltr"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <label className="relative block min-w-0 flex-1 basis-48">
              <span className="mb-0.5 block text-xs text-muted">{t(nameSearchLabel(type))}</span>
              <span className="pointer-events-none absolute bottom-0 start-3 grid h-9 place-items-center text-faint">
                <Icon name="search" size={16} />
              </span>
              <input
                className={`${filterField} ps-9`}
                value={search}
                placeholder={t('parties.search')}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </>
        }
      >
        <Filter label={t('parties.type')}>
          <select
            className={filterField}
            value={type}
            onChange={(e) => setType(e.target.value as PartyType | '')}
          >
            <option value="">{t('parties.all')}</option>
            {TYPES.map((x) => (
              <option key={x} value={x}>
                {t(TYPE_LABEL[x])}
              </option>
            ))}
          </select>
        </Filter>
        <Filter label={t('parties.status')}>
          <select
            className={filterField}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t('parties.anyStatus')}</option>
            {STATUSES.filter((s) => s === 'CLOSED' || BALANCE_PERMISSIONS.some(can)).map((s) => (
              <option key={s} value={s}>
                {t(`parties.status.${s}` as TranslationKey)}
              </option>
            ))}
          </select>
        </Filter>
        <Filter label={t('parties.phone')}>
          <input
            className={`${filterField} tnum`}
            inputMode="tel"
            dir="ltr"
            value={kept.phone}
            onChange={(e) => keep({ phone: e.target.value })}
          />
        </Filter>
        <label className="flex h-9 items-center gap-2 self-end text-sm text-muted">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          {t('parties.showClosed')}
        </label>
      </FilterPanel>

      {isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('common.empty')} icon="parties" />
        </Card>
      ) : (
        <>
          {deviceClass === 'phone' ? (
            <div className="grid grid-cols-1 gap-3">
              {data.items.map((party) => (
                <PartyCard
                  key={party.id}
                  party={party}
                  onEdit={EDIT_PERMISSIONS.some(can) ? () => setEditing(party) : undefined}
                />
              ))}
            </div>
          ) : (
            <PartyTable
              parties={data.items}
              onOpen={setOpened}
              onEdit={EDIT_PERMISSIONS.some(can) ? setEditing : undefined}
            />
          )}
          {data.total > 10 && (
            <div className="flex justify-center">
              <Pager
                page={page}
                size={size}
                pages={Math.max(1, Math.ceil(data.total / size))}
                onPage={setPage}
                onSize={(n) => {
                  setSize(n);
                  setPage(1);
                }}
              />
            </div>
          )}
        </>
      )}

      {/* The table opens a party's card with everything on it. */}
      {opened && (
        <Sheet title={opened.name} onClose={() => setOpened(null)} closeLabel={t('common.close')}>
          <PartyCard
            party={data?.items.find((p) => p.id === opened.id) ?? opened}
            onEdit={
              EDIT_PERMISSIONS.some(can)
                ? () => {
                    setEditing(opened);
                    setOpened(null);
                  }
                : undefined
            }
          />
        </Sheet>
      )}

      {editing && (
        <PartySheet
          key={editing === 'new' ? 'new' : editing.id}
          party={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * The parties as a table on a computer or tablet (owner, 2026-11-16: every list with its columns):
 * code, name, kind, phone, balance and limit; a row opens the party's card.
 */
function PartyTable({
  parties,
  onOpen,
  onEdit,
}: {
  parties: Party[];
  onOpen: (p: Party) => void;
  onEdit?: (p: Party) => void;
}) {
  const { t, locale } = useT();
  const seeBalance = parties.some((p) => p.balance != null);
  const seeLimit = parties.some((p) => p.creditLimit != null);
  return (
    <Card padded={false} className="overflow-hidden">
      <TableColumns id="parties" className="pt-2">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="p-2 text-start font-medium">{t('parties.code')}</th>
                <th className="p-2 text-start font-medium">{t('parties.name')}</th>
                <th className="p-2 text-start font-medium">{t('parties.type')}</th>
                <th className="p-2 text-start font-medium">{t('parties.phone')}</th>
                <th className="p-2 text-start font-medium">{t('parties.address')}</th>
                {seeBalance && <th className="p-2 text-end font-medium">{t('parties.balance')}</th>}
                {seeLimit && (
                  <th className="p-2 text-end font-medium">{t('parties.creditLimit')}</th>
                )}
                <th className="p-2 text-start font-medium">{t('parties.status')}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {parties.map((party) => {
                const bal = balanceView(party.balance ?? 0, party.currency);
                return (
                  <tr
                    key={party.id}
                    onClick={() => onOpen(party)}
                    className={`cursor-pointer hover:bg-surface-2 ${party.isActive ? '' : 'opacity-70'}`}
                  >
                    <td className="p-2 text-muted tnum">{party.code}</td>
                    <td className="max-w-72 p-2 font-medium" onClick={(e) => e.stopPropagation()}>
                      <PartyLink id={party.id} name={party.name} truncate />
                    </td>
                    <td className="p-2 text-xs">
                      {party.types.map((type) => t(TYPE_LABEL[type])).join(' · ')}
                    </td>
                    <td className="p-2 tnum" dir="ltr">
                      {party.phone ?? ''}
                    </td>
                    <td className="max-w-60 truncate p-2 text-xs text-muted">
                      {party.address ?? ''}
                    </td>
                    {seeBalance && (
                      <td
                        className={`p-2 text-end font-medium tnum ${
                          bal.direction === 'receivable'
                            ? 'text-positive'
                            : bal.direction === 'payable'
                              ? 'text-warning'
                              : 'text-muted'
                        }`}
                      >
                        {party.balance == null ? '' : formatMoney(bal.amount, bal.currency, locale)}
                      </td>
                    )}
                    {seeLimit && (
                      <td className="p-2 text-end tnum">
                        {party.creditLimit == null
                          ? ''
                          : formatMoney(party.creditLimit, party.currency, locale)}
                      </td>
                    )}
                    <td className="p-2 text-xs">
                      {!party.isActive
                        ? t('parties.closed')
                        : party.balance == null
                          ? ''
                          : bal.direction === 'receivable'
                            ? t('parties.theyOweUs')
                            : bal.direction === 'payable'
                              ? t('parties.weOweThem')
                              : t('parties.settled')}
                    </td>
                    <td className="p-1" onClick={(e) => e.stopPropagation()}>
                      {onEdit && (
                        <button
                          type="button"
                          className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
                          aria-label={t('parties.edit')}
                          title={t('parties.edit')}
                          onClick={() => onEdit(party)}
                        >
                          <Icon name="notes" size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TableColumns>
    </Card>
  );
}

function PartyCard({ party, onEdit }: { party: Party; onEdit?: () => void }) {
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const opensAccount =
    mayOpenStatement(party, can) || (party.types.includes('CUSTOMER') && can('sales:together'));
  const bal = balanceView(party.balance ?? 0, party.currency);
  const money = (kind: 'receipt' | 'payment') =>
    navigate(`/receipts?tab=vouchers&new=${kind}&party=${party.id}`);
  const [idCard, setIdCard] = useState(false);
  // What they owe against their purchase limit (owner, 2026-10-01: a warning on the customer).
  const limit =
    party.creditLimit == null || party.balance == null || !party.types.includes('CUSTOMER')
      ? null
      : party.balance >= party.creditLimit
        ? 'over'
        : party.balance >= party.creditLimit * 0.8
          ? 'near'
          : null;
  const balLabel =
    bal.direction === 'receivable'
      ? t('parties.theyOweUs')
      : bal.direction === 'payable'
        ? t('parties.weOweThem')
        : t('parties.settled');
  const balTone: Tone =
    bal.direction === 'receivable'
      ? 'positive'
      : bal.direction === 'payable'
        ? 'warning'
        : 'neutral';
  const balColor =
    bal.direction === 'receivable'
      ? 'text-positive'
      : bal.direction === 'payable'
        ? 'text-warning'
        : 'text-muted';

  return (
    <Card className={party.isActive ? '' : 'opacity-70'}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
            <Icon name={party.types.includes('CARRIER') ? 'delivery' : 'parties'} size={20} />
          </span>
          <div className="min-w-0">
            <p className="min-w-0 font-medium">
              <PartyLink id={party.id} code={party.code} name={party.name} truncate />
            </p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {party.types.map((type) => (
                <Badge key={type} tone="brand">
                  {t(TYPE_LABEL[type])}
                </Badge>
              ))}
              {!party.isActive && <Badge tone="warning">{t('parties.closed')}</Badge>}
              {limit === 'over' && <Badge tone="destructive">{t('parties.overLimit')}</Badge>}
              {limit === 'near' && <Badge tone="warning">{t('parties.nearLimit')}</Badge>}
            </div>
          </div>
        </div>
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            {t('parties.edit')}
          </Button>
        )}
      </div>

      {party.balance != null && (
        <div className="mt-4 rounded-[var(--radius-app)] bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{t('parties.balance')}</span>
            <Badge tone={balTone}>{balLabel}</Badge>
          </div>
          <p className={`mt-1 text-lg font-semibold tnum ${balColor}`}>
            {formatMoney(bal.amount, bal.currency, locale)}
          </p>
        </div>
      )}

      <PriceListPicker party={party} canSet={can('parties:set_price_level')} />
      {party.types.includes('CUSTOMER') &&
        (can('parties:credit_limit') || party.creditLimit != null) && (
          <CreditLimitField party={party} canSet={can('parties:credit_limit')} />
        )}

      {((party.isActive && (can('receipts:create') || can('payments:create'))) || opensAccount) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {opensAccount && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate(`/parties/${party.id}/account`)}
            >
              {t('account.statement')}
            </Button>
          )}
          {party.isActive && can('receipts:create') && (
            <Button size="sm" variant="secondary" onClick={() => money('receipt')}>
              {t('money.receive')}
            </Button>
          )}
          {party.isActive && can('payments:create') && (
            <Button size="sm" variant="ghost" onClick={() => money('payment')}>
              {t('money.pay')}
            </Button>
          )}
        </div>
      )}

      {/* The factory's prices at once (owner, 2026-11-10). */}
      {party.types.includes('SUPPLIER') && can('prices:bulk_edit') && (
        <Button
          size="sm"
          variant="ghost"
          icon="purchases"
          className="mt-2"
          onClick={() => navigate(`/inventory/supplier-prices?supplier=${party.id}`)}
        >
          {t('bulkPrices.title')}
        </Button>
      )}

      {(party.hasIdFront || party.hasIdBack) &&
        (can('parties:id_cards_view') || can('parties:id_cards_edit')) && (
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setIdCard(true)}>
            {t('parties.idShow')}
          </Button>
        )}
      <PartyDetails party={party} />
      {idCard && (
        <Sheet title={party.name} onClose={() => setIdCard(false)} closeLabel={t('common.close')}>
          <IdCardView party={party} />
        </Sheet>
      )}
    </Card>
  );
}

/**
 * Add a party, or edit one (including closing / reopening its account). Opened from another page to
 * add one there (e.g. a new supplier on the purchase screen), it starts as `startTypes` and hands the
 * new party to `onCreated`.
 */
export function PartySheet({
  party,
  onClose,
  startTypes,
  onCreated,
}: {
  party: Party | null;
  onClose: () => void;
  startTypes?: PartyType[];
  onCreated?: (party: Party) => void;
}) {
  const { t } = useT();
  const isNew = !party;
  const create = useCreateParty();
  const update = useUpdateParty();
  const can = useCan();
  const carriers = useParties({ page: 1, pageSize: 100, type: 'CARRIER', active: true });
  // The shipping company a customer's sales go with (or one with no file, by name). Whether they
  // are a cash customer isn't ticked here any more: walk-in customers are sold to on the cash
  // customer account, code 0 (owner, 2026-10-02).
  const system = !!party?.isSystem;
  const [defaultCarrierId, setDefaultCarrierId] = useState(
    party?.defaultCarrierId ?? (party?.tempCarrierName ? OTHER : ''),
  );
  const [tempCarrierName, setTempCarrierName] = useState(party?.tempCarrierName ?? '');
  const [name, setName] = useState(party?.name ?? '');
  // A new one can only be of the kinds this person may add.
  const addable = TYPES.filter((x) => can(CREATE_PERMISSION[x]));
  const [types, setTypes] = useState<PartyType[]>(
    party?.types ?? startTypes ?? (addable.length ? [addable[0]!] : []),
  );
  const [phone, setPhone] = useState(party?.phone ?? '');
  // What the main number is, like the others have (owner, 2026-10-19).
  const [phoneLabel, setPhoneLabel] = useState(party?.phoneLabel ?? '');
  const [nationalId, setNationalId] = useState(party?.nationalId ?? '');
  const country = useCompanyCountry();
  const [email, setEmail] = useState(party?.email ?? '');
  const [taxNumber, setTaxNumber] = useState(party?.taxNumber ?? '');
  const [address, setAddress] = useState(party?.address ?? '');
  // Extra phones, each with whose it is (optional).
  const [otherPhones, setOtherPhones] = useState<{ phone: string; label: string }[]>(
    (party?.otherPhones ?? []).map((phone, i) => ({
      phone,
      label: party?.otherPhoneLabels?.[i] ?? '',
    })),
  );
  const [extraAddress, setExtraAddress] = useState(party?.extraAddress ?? '');
  const [extraAddressLabel] = useState(party?.extraAddressLabel ?? '');
  const [contactName, setContactName] = useState(party?.contactName ?? '');
  const [shippingAddress, setShippingAddress] = useState(party?.shippingAddress ?? '');
  const [notes, setNotes] = useState(party?.notes ?? '');
  // ID card photos picked before a new party is saved; sent right after.
  const [idPending, setIdPending] = useState<Record<IdSide, Blob | null>>({
    front: null,
    back: null,
  });
  const [touched, setTouched] = useState(false);
  const factory = isFactory(types);
  const carrierOnly = types.length === 1 && types[0] === 'CARRIER';
  const customer = types.includes('CUSTOMER');
  const withIdCard = (customer || types.includes('CARRIER')) && can('parties:id_cards_edit');
  // Every field of a new account is optional (owner, 2026-10-22); an existing one keeps a name.
  // Contact details are seen and changed only with parties:contact; a new account's are typed in
  // by whoever adds it (owner, 2026-10-19).
  const showContact = isNew || can('parties:contact');
  // The name, kind, notes and carrier change with parties:edit; each other part with its own.
  const editsMain = isNew || can('parties:edit');
  const phones = otherPhones.filter((x) => x.phone.trim());

  const contact = {
    phone: phone.trim(),
    phoneLabel: phone.trim() ? phoneLabel.trim() : '',
    email: carrierOnly ? '' : email.trim(),
    taxNumber: carrierOnly ? '' : taxNumber.trim(),
    address: address.trim(),
    otherPhones: phones.map((x) => x.phone.trim()),
    otherPhoneLabels: phones.map((x) => x.label.trim()),
    nationalId: nationalId.trim(),
    extraAddress: extraAddress.trim(),
    extraAddressLabel: extraAddress.trim() ? extraAddressLabel.trim() : '',
    contactName: contactName.trim(),
    shippingAddress: shippingAddress.trim(),
  };
  const values = {
    name: name.trim(),
    types,
    ...(showContact ? contact : {}),
    notes: notes.trim(),
    ...(customer
      ? {
          defaultCarrierId: defaultCarrierId === OTHER ? '' : defaultCarrierId,
          tempCarrierName: defaultCarrierId === OTHER ? tempCarrierName.trim() : '',
        }
      : {}),
  };
  const parsed = partySchema.safeParse(values);
  const issues = new Set(parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0])));
  if (!isNew && !name.trim()) issues.add('name');
  const [sending, setSending] = useState(false);
  const pending = create.isPending || update.isPending || sending;
  const error = errorText(t, create.error ?? update.error);

  // One kind per account (owner, 2026-10-19): picking one replaces the other.
  const toggle = (type: PartyType) => setTypes([type]);

  async function save() {
    setTouched(true);
    if (!parsed.success || issues.size > 0) return;
    // Phones and the national ID as the company's country has them (owner, 2026-10-02).
    if (showContact && anyIdProblem(country, [phone, ...phones.map((x) => x.phone)], nationalId))
      return;
    try {
      if (isNew) {
        const created = await create.mutateAsync(values);
        onCreated?.(created);
        setSending(true);
        for (const side of ['front', 'back'] as const) {
          const photo = idPending[side];
          if (photo && withIdCard)
            await api
              .upload(`/parties/${created.id}/id-card/${side}`, photo)
              .catch(() => undefined);
        }
      } else await update.mutateAsync({ id: party.id, input: values });
      onClose();
    } catch {
      /* shown below */
    } finally {
      setSending(false);
    }
  }

  async function setActive(isActive: boolean) {
    if (!party) return;
    try {
      await update.mutateAsync({ id: party.id, input: { isActive } });
      onClose();
    } catch {
      /* shown below */
    }
  }

  const nameLabel = factory
    ? 'parties.factoryName'
    : carrierOnly
      ? 'parties.companyName'
      : 'common.name';

  return (
    <Sheet
      title={isNew ? t('parties.new') : t('parties.editTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <form
        className="space-y-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset>
          <legend className="mb-1 block text-xs text-muted">{t('parties.types')}</legend>
          <div className="flex flex-wrap gap-2">
            {TYPES.filter((type) => types.includes(type) || addable.includes(type)).map((type) => (
              <label
                key={type}
                className={`flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-app)] border px-3 text-sm ${
                  types.includes(type) ? 'border-brand bg-brand-soft text-brand' : 'border-line'
                }`}
              >
                <input
                  type="radio"
                  name="party-type"
                  className="sr-only"
                  checked={types.includes(type)}
                  disabled={system || !editsMain}
                  onChange={() => toggle(type)}
                />
                {types.includes(type) && <Icon name="check" size={14} />}
                {t(TYPE_LABEL[type])}
              </label>
            ))}
          </div>
          {touched && issues.has('types') && (
            <p className="mt-1 text-xs text-destructive">{t('parties.pickType')}</p>
          )}
        </fieldset>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t(nameLabel)}</span>
          <input
            className={input}
            value={name}
            maxLength={200}
            autoFocus
            disabled={!editsMain}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={touched && issues.has('name')}
          />
        </label>

        {/* A factory's owner; a customer has no "person in charge" (owner, 2026-10-19). */}
        {showContact && (factory || (contactName && !customer)) && (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">
              {t(factory ? 'parties.ownerName' : 'parties.contactName')}
            </span>
            <input
              className={input}
              value={contactName}
              maxLength={200}
              onChange={(e) => setContactName(e.target.value)}
            />
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {/* The main number and what it is, then the other numbers right under it (owner, 2026-10-19). */}
          {showContact && (
            <div className="flex items-start gap-2 sm:col-span-2">
              <div className="min-w-0 flex-1">
                <PhoneInput value={phone} onChange={setPhone} label={t('parties.phone')} />
              </div>
              <label className="block w-36 shrink-0 sm:w-48">
                <span className="mb-1 block text-xs text-muted">{t('parties.mainPhoneLabel')}</span>
                <input
                  className={input}
                  list="party-phone-kinds"
                  value={phoneLabel}
                  maxLength={60}
                  onChange={(e) => setPhoneLabel(e.target.value)}
                />
              </label>
            </div>
          )}
          {showContact && (
            <PhoneList
              value={otherPhones}
              onChange={setOtherPhones}
              max={MAX_OTHER_PHONES}
              listId="party-phone-kinds"
            />
          )}
          {showContact && !carrierOnly && (
            <label className="block">
              <span className="mb-1 block text-xs text-muted">{t('parties.email')}</span>
              <input
                className={input}
                dir="ltr"
                type="email"
                value={email}
                maxLength={200}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={touched && issues.has('email')}
              />
            </label>
          )}
          {showContact && (customer || types.includes('CARRIER')) && (
            <NationalIdInput
              value={nationalId}
              onChange={setNationalId}
              label={t('parties.nationalId')}
            />
          )}
          {showContact && !carrierOnly && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-muted">
                {t(factory ? 'parties.taxFile' : 'parties.taxNumber')}
              </span>
              <input
                className={input}
                dir="ltr"
                value={taxNumber}
                maxLength={40}
                onChange={(e) => setTaxNumber(e.target.value)}
              />
            </label>
          )}
          {showContact && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-muted">
                {t(factory ? 'parties.factoryAddress' : 'parties.address')}
              </span>
              <textarea
                className={`${input} h-auto min-h-16 py-2`}
                rows={2}
                value={address}
                maxLength={300}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
          )}
          {showContact && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-muted">{t('parties.extraAddress')}</span>
              <input
                className={input}
                value={extraAddress}
                maxLength={300}
                onChange={(e) => setExtraAddress(e.target.value)}
              />
            </label>
          )}
          {showContact && customer && shippingAddress && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-muted">{t('parties.shippingAddress')}</span>
              <input
                className={input}
                value={shippingAddress}
                maxLength={300}
                onChange={(e) => setShippingAddress(e.target.value)}
              />
            </label>
          )}
          {customer && (
            <label className="block">
              <span className="mb-1 block text-xs text-muted">{t('parties.defaultCarrier')}</span>
              <select
                className={input}
                value={defaultCarrierId}
                disabled={!editsMain}
                onChange={(e) => setDefaultCarrierId(e.target.value)}
              >
                <option value="">{t('parties.noCarrier')}</option>
                {(carriers.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={OTHER}>{t('parties.otherCarrier')}</option>
              </select>
            </label>
          )}
          {customer && defaultCarrierId === OTHER && (
            <label className="block">
              <span className="mb-1 block text-xs text-muted">{t('parties.tempCarrier')}</span>
              <input
                className={input}
                value={tempCarrierName}
                maxLength={200}
                disabled={!editsMain}
                onChange={(e) => setTempCarrierName(e.target.value)}
              />
            </label>
          )}
          {system && <p className="self-end pb-2 text-sm text-muted">{t('parties.systemCash')}</p>}
          {withIdCard && (
            <IdCardFields
              party={party}
              pending={idPending}
              onPending={(side, b) => setIdPending((cur) => ({ ...cur, [side]: b }))}
            />
          )}
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs text-muted">{t('parties.notes')}</span>
            <textarea
              className={`${input} h-auto min-h-16 py-2`}
              rows={2}
              value={notes}
              maxLength={1000}
              disabled={!editsMain}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        {touched && issues.has('email') && (
          <p className="text-xs text-destructive">{t('error.bad_email')}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {party && !system && can('parties:close') ? (
            party.isActive ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending || (party.balance ?? 0) !== 0}
                title={(party.balance ?? 0) !== 0 ? t('parties.closeHint') : undefined}
                onClick={() => void setActive(false)}
              >
                {t('parties.close')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => void setActive(true)}
              >
                {t('parties.reopen')}
              </Button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            {(editsMain || showContact) && (
              <Button type="submit" loading={pending}>
                {t('common.save')}
              </Button>
            )}
          </div>
        </div>
      </form>
    </Sheet>
  );
}

/** The party's own price list: its prices replace the usual ones for its items. */
function PriceListPicker({ party, canSet }: { party: Party; canSet: boolean }) {
  const { t } = useT();
  const set = useSetPartyPriceLevels();
  const lists = usePriceLists();
  const error = errorText(t, set.error);
  const sides = [
    party.types.includes('CUSTOMER') && {
      side: 'SALE' as const,
      list: party.salesPriceListId ?? '',
      listKey: 'salesPriceListId' as const,
    },
    party.types.includes('SUPPLIER') && {
      side: 'PURCHASE' as const,
      list: party.purchasePriceListId ?? '',
      listKey: 'purchasePriceListId' as const,
    },
  ]
    .filter((x) => !!x)
    .map((s) => ({
      ...s,
      // Lists given one by one (an offer for everyone applies without being given).
      options: (lists.data ?? []).filter(
        (l) => l.side === s.side && !l.forEveryone && (l.isActive || l.id === s.list),
      ),
    }))
    .filter((s) => s.options.length > 0 || s.list);
  if (sides.length === 0) return null;

  return (
    <div className="mt-3 grid gap-2">
      {sides.map((s) => (
        <label key={s.side} className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('pl.partyList')}</span>
          <select
            className={field}
            value={s.list}
            disabled={!canSet || set.isPending}
            onChange={(e) => set.mutate({ id: party.id, input: { [s.listKey]: e.target.value } })}
          >
            <option value="">{t('pl.noList')}</option>
            {s.options.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Contact details on a party's card: owner / person in charge, phones, addresses, notes. */
function PartyDetails({ party }: { party: Party }) {
  const { t } = useT();
  const factory = isFactory(party.types);
  const phones = [
    ...(party.phone ? [{ phone: party.phone, label: '' }] : []),
    ...(party.otherPhones ?? []).map((phone, i) => ({
      phone,
      label: party.otherPhoneLabels?.[i] ?? '',
    })),
  ];
  if (
    !party.contactName &&
    phones.length === 0 &&
    !party.address &&
    !party.extraAddress &&
    !party.shippingAddress &&
    !party.tempCarrierName &&
    !party.notes
  )
    return null;
  return (
    <dl className="mt-3 space-y-1 text-xs text-muted">
      {party.contactName && (
        <div className="flex items-center gap-1.5">
          <Icon name="staff" size={14} className="shrink-0" />
          <dt className="sr-only">{t(factory ? 'parties.ownerName' : 'parties.contactName')}</dt>
          <dd className="min-w-0 break-words text-fg">{party.contactName}</dd>
        </div>
      )}
      {phones.length > 0 && (
        <div className="flex items-start gap-1.5">
          <Icon name="bell" size={14} className="mt-0.5 shrink-0" />
          <dt className="sr-only">{t('parties.phone')}</dt>
          <dd className="flex min-w-0 flex-wrap gap-x-3">
            {phones.map((p) => (
              <span key={p.phone}>
                <a href={`tel:${p.phone.replace(/\s+/g, '')}`} dir="ltr" className="hover:text-fg">
                  {p.phone}
                </a>
                {p.label && <span className="ms-1">({p.label})</span>}
              </span>
            ))}
          </dd>
        </div>
      )}
      {party.address && (
        <div className="flex items-start gap-1.5">
          <Icon name="building" size={14} className="mt-0.5 shrink-0" />
          <dt className="shrink-0">{t(factory ? 'parties.factoryAddress' : 'parties.address')}:</dt>
          <dd className="min-w-0 break-words">{party.address}</dd>
        </div>
      )}
      {party.extraAddress && (
        <div className="flex items-start gap-1.5">
          <Icon name="building" size={14} className="mt-0.5 shrink-0" />
          <dt className="shrink-0">{party.extraAddressLabel || t('parties.extraAddress')}:</dt>
          <dd className="min-w-0 break-words">{party.extraAddress}</dd>
        </div>
      )}
      {party.tempCarrierName && (
        <div className="flex items-start gap-1.5">
          <Icon name="delivery" size={14} className="mt-0.5 shrink-0" />
          <dt className="sr-only">{t('parties.tempCarrier')}</dt>
          <dd className="min-w-0 break-words">{party.tempCarrierName}</dd>
        </div>
      )}
      {party.shippingAddress && (
        <div className="flex items-start gap-1.5">
          <Icon name="delivery" size={14} className="mt-0.5 shrink-0" />
          <dt className="shrink-0">{t('parties.shippingAddress')}:</dt>
          <dd className="min-w-0 break-words">{party.shippingAddress}</dd>
        </div>
      )}
      {party.notes && (
        <div className="flex items-start gap-1.5">
          <Icon name="notes" size={14} className="mt-0.5 shrink-0" />
          <dt className="sr-only">{t('parties.notes')}</dt>
          <dd className="line-clamp-3 min-w-0 whitespace-pre-line break-words">{party.notes}</dd>
        </div>
      )}
    </dl>
  );
}

/** A customer's credit limit (حد الائتمان): saved when the field is left; empty = no limit. */
function CreditLimitField({ party, canSet }: { party: Party; canSet: boolean }) {
  const { t } = useT();
  const set = useSetCreditLimit();
  const shown = party.creditLimit == null ? '' : String(toMajor(party.creditLimit));
  const [value, setValue] = useState(shown);
  useEffect(() => setValue(shown), [shown]);
  const error = errorText(t, set.error);
  function save() {
    const next = value.trim() === '' ? null : toMinor(Number(value));
    if (next !== null && !(Number.isFinite(next) && next >= 0)) return;
    if (next === (party.creditLimit ?? null)) return;
    set.mutate({ id: party.id, creditLimit: next });
  }
  return (
    <label className="mt-3 block">
      <span className="mb-0.5 block text-xs text-muted">{t('parties.creditLimit')}</span>
      <input
        type="number"
        min={0}
        step="0.01"
        className={`${field} tnum`}
        placeholder={t('parties.creditLimitHint')}
        disabled={!canSet || set.isPending}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      {error && <span className="mt-0.5 block text-xs text-destructive">{error}</span>}
    </label>
  );
}
