import { useDeferredValue, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  balanceView,
  formatMoney,
  partySchema,
  toMajor,
  toMinor,
  type Party,
  type PartyType,
  type PriceLevel,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { LedgerStatementSheet } from '../components/LedgerStatementSheet';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import {
  useCreateParty,
  useParties,
  usePriceLevels,
  usePriceLists,
  useSetCreditLimit,
  useSetPartyPriceLevels,
  useUpdateParty,
} from '../lib/queries';
import type { Tone } from '../components/ui';

// A factory is a supplier, so there is no separate factory type.
const TYPES: PartyType[] = ['CUSTOMER', 'SUPPLIER', 'CARRIER'];

const TYPE_LABEL: Record<PartyType, TranslationKey> = {
  CUSTOMER: 'parties.customer',
  SUPPLIER: 'parties.supplier',
  CARRIER: 'parties.carrier',
};

/** A supplier-only party is a factory: its contact is the owner and its address the factory's. */
const isFactory = (types: PartyType[]) => types.includes('SUPPLIER') && !types.includes('CUSTOMER');
const MAX_OTHER_PHONES = 5;

const field =
  'h-8 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2 text-xs outline-none focus:border-brand disabled:opacity-70';
const input =
  'h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand disabled:opacity-60';

export function PartiesPage() {
  const { t } = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<PartyType | ''>('');
  const [showClosed, setShowClosed] = useState(false);
  const [editing, setEditing] = useState<Party | 'new' | null>(null);
  const query = useDeferredValue(search.trim());
  const { data, isLoading } = useParties({
    page: 1,
    pageSize: 100,
    type: type || undefined,
    search: query || undefined,
    active: showClosed ? undefined : true,
  });
  const levels = usePriceLevels();

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('parties.title')}
        subtitle={data ? `${data.total} ${t('common.total')}` : undefined}
        action={
          can('parties:create') ? (
            <Button icon="plus" onClick={() => setEditing('new')}>
              {t('parties.add')}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-faint">
            <Icon name="search" size={16} />
          </span>
          <input
            className={`${input} ps-9`}
            value={search}
            placeholder={t('parties.search')}
            aria-label={t('parties.search')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div
          role="tablist"
          className="flex max-w-full flex-wrap gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1"
        >
          {(['', ...TYPES] as const).map((x) => (
            <button
              key={x || 'all'}
              role="tab"
              aria-selected={type === x}
              onClick={() => setType(x)}
              className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
                type === x ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
              }`}
            >
              {x ? t(TYPE_LABEL[x]) : t('parties.all')}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          {t('parties.showClosed')}
        </label>
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('common.empty')} icon="parties" />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((party) => (
            <PartyCard
              key={party.id}
              party={party}
              levels={levels.data ?? []}
              onEdit={can('parties:edit') ? () => setEditing(party) : undefined}
            />
          ))}
        </div>
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

function PartyCard({
  party,
  levels,
  onEdit,
}: {
  party: Party;
  levels: PriceLevel[];
  onEdit?: () => void;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const bal = balanceView(party.balance, party.currency);
  const money = (kind: 'receipt' | 'payment') =>
    navigate(`/receipts?tab=vouchers&new=${kind}&party=${party.id}`);
  const [statement, setStatement] = useState(false);
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
            <p className="truncate font-medium">
              {party.name}
              <span className="ms-1.5 text-xs font-normal text-muted tnum">
                {t('common.code')} {party.code}
              </span>
            </p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {party.types.map((type) => (
                <Badge key={type} tone="brand">
                  {t(TYPE_LABEL[type])}
                </Badge>
              ))}
              {!party.isActive && <Badge tone="warning">{t('parties.closed')}</Badge>}
            </div>
          </div>
        </div>
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            {t('parties.edit')}
          </Button>
        )}
      </div>

      <div className="mt-4 rounded-[var(--radius-app)] bg-surface-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{t('parties.balance')}</span>
          <Badge tone={balTone}>{balLabel}</Badge>
        </div>
        <p className={`mt-1 text-lg font-semibold tnum ${balColor}`}>
          {formatMoney(bal.amount, bal.currency, locale)}
        </p>
      </div>

      {levels.length > 0 && (
        <PriceLevelPicker party={party} levels={levels} canSet={can('parties:set_price_level')} />
      )}
      {party.types.includes('CUSTOMER') &&
        (can('parties:credit_limit') || party.creditLimit != null) && (
          <CreditLimitField party={party} canSet={can('parties:credit_limit')} />
        )}

      {((party.isActive && (can('receipts:create') || can('payments:create'))) ||
        can('ledger:view') ||
        (party.types.includes('CUSTOMER') && can('sales:view'))) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {party.types.includes('CUSTOMER') && can('sales:view') && (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/parties/${party.id}/account`)}>
              {t('account.open')}
            </Button>
          )}
          {can('ledger:view') && (
            <Button size="sm" variant="ghost" onClick={() => setStatement(true)}>
              {t('ledger.partyStatement')}
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

      <PartyDetails party={party} />
      {statement && (
        <LedgerStatementSheet
          kind="parties"
          id={party.id}
          title={party.name}
          onClose={() => setStatement(false)}
        />
      )}
    </Card>
  );
}

/** Add a party, or edit one (including closing / reopening its account). */
function PartySheet({ party, onClose }: { party: Party | null; onClose: () => void }) {
  const { t } = useT();
  const isNew = !party;
  const create = useCreateParty();
  const update = useUpdateParty();
  const can = useCan();
  const carriers = useParties({ page: 1, pageSize: 100, type: 'CARRIER', active: true });
  // The shipping company a customer's sales go with, and whether they are a cash customer.
  const [defaultCarrierId, setDefaultCarrierId] = useState(party?.defaultCarrierId ?? '');
  const [isCashCustomer, setIsCashCustomer] = useState(party?.isCashCustomer ?? false);
  const [name, setName] = useState(party?.name ?? '');
  const [types, setTypes] = useState<PartyType[]>(party?.types ?? ['CUSTOMER']);
  const [phone, setPhone] = useState(party?.phone ?? '');
  const [email, setEmail] = useState(party?.email ?? '');
  const [taxNumber, setTaxNumber] = useState(party?.taxNumber ?? '');
  const [address, setAddress] = useState(party?.address ?? '');
  const [otherPhones, setOtherPhones] = useState<string[]>(party?.otherPhones ?? []);
  const [contactName, setContactName] = useState(party?.contactName ?? '');
  const [shippingAddress, setShippingAddress] = useState(party?.shippingAddress ?? '');
  const [notes, setNotes] = useState(party?.notes ?? '');
  const [touched, setTouched] = useState(false);
  const factory = isFactory(types);

  const values = {
    name: name.trim(),
    types,
    phone: phone.trim(),
    email: email.trim(),
    taxNumber: taxNumber.trim(),
    address: address.trim(),
    otherPhones: otherPhones.map((x) => x.trim()).filter(Boolean),
    contactName: contactName.trim(),
    shippingAddress: shippingAddress.trim(),
    notes: notes.trim(),
    ...(types.includes('CUSTOMER') ? { defaultCarrierId } : {}),
    ...(can('parties:cash_customer') && isCashCustomer !== (party?.isCashCustomer ?? false)
      ? { isCashCustomer }
      : {}),
  };
  const parsed = partySchema.safeParse(values);
  const issues = new Set(parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0])));
  const pending = create.isPending || update.isPending;
  const error = errorText(t, create.error ?? update.error);

  const toggle = (type: PartyType) =>
    setTypes((cur) => (cur.includes(type) ? cur.filter((x) => x !== type) : [...cur, type]));

  async function save() {
    setTouched(true);
    if (!parsed.success) return;
    try {
      if (isNew) await create.mutateAsync(values);
      else await update.mutateAsync({ id: party.id, input: values });
      onClose();
    } catch {
      /* shown below */
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
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('common.name')}</span>
          <input
            className={input}
            value={name}
            maxLength={200}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            aria-invalid={touched && issues.has('name')}
          />
        </label>

        <fieldset>
          <legend className="mb-1 block text-xs text-muted">{t('parties.types')}</legend>
          <div className="flex flex-wrap gap-2">
            {TYPES.map((type) => (
              <label
                key={type}
                className={`flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-app)] border px-3 text-sm ${
                  types.includes(type) ? 'border-brand bg-brand-soft text-brand' : 'border-line'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={types.includes(type)}
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

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('parties.phone')}</span>
            <input
              className={input}
              dir="ltr"
              inputMode="tel"
              value={phone}
              maxLength={40}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
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
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 block text-xs text-muted">{t('parties.otherPhones')}</legend>
            <div className="space-y-2">
              {otherPhones.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className={input}
                    dir="ltr"
                    inputMode="tel"
                    value={p}
                    maxLength={40}
                    aria-label={`${t('parties.otherPhones')} ${i + 1}`}
                    onChange={(e) =>
                      setOtherPhones((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon="close"
                    aria-label={t('parties.removePhone')}
                    onClick={() => setOtherPhones((cur) => cur.filter((_, j) => j !== i))}
                  />
                </div>
              ))}
              {otherPhones.length < MAX_OTHER_PHONES && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon="plus"
                  onClick={() => setOtherPhones((cur) => [...cur, ''])}
                >
                  {t('parties.addPhone')}
                </Button>
              )}
            </div>
          </fieldset>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs text-muted">{t('parties.taxNumber')}</span>
            <input
              className={input}
              dir="ltr"
              value={taxNumber}
              maxLength={40}
              onChange={(e) => setTaxNumber(e.target.value)}
            />
          </label>
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
          {types.includes('CUSTOMER') && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-muted">{t('parties.shippingAddress')}</span>
              <textarea
                className={`${input} h-auto min-h-16 py-2`}
                rows={2}
                value={shippingAddress}
                maxLength={300}
                onChange={(e) => setShippingAddress(e.target.value)}
              />
            </label>
          )}
          {types.includes('CUSTOMER') && (
            <label className="block">
              <span className="mb-1 block text-xs text-muted">{t('parties.defaultCarrier')}</span>
              <select
                className={input}
                value={defaultCarrierId}
                onChange={(e) => setDefaultCarrierId(e.target.value)}
              >
                <option value="">{t('parties.noCarrier')}</option>
                {(carriers.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {types.includes('CUSTOMER') && (
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                checked={isCashCustomer}
                disabled={!can('parties:cash_customer')}
                onChange={(e) => setIsCashCustomer(e.target.checked)}
              />
              {t('parties.cashCustomer')}
            </label>
          )}
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs text-muted">{t('parties.notes')}</span>
            <textarea
              className={`${input} h-auto min-h-16 py-2`}
              rows={2}
              value={notes}
              maxLength={1000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        {touched && issues.has('email') && (
          <p className="text-xs text-destructive">{t('error.bad_email')}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {party ? (
            party.isActive ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending || party.balance !== 0}
                title={party.balance !== 0 ? t('parties.closeHint') : undefined}
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
            <Button type="submit" loading={pending}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}

/** The party's own price levels and price lists: what new invoices to / from them start at. */
function PriceLevelPicker({
  party,
  levels,
  canSet,
}: {
  party: Party;
  levels: PriceLevel[];
  canSet: boolean;
}) {
  const { t } = useT();
  const set = useSetPartyPriceLevels();
  const lists = usePriceLists();
  const error = errorText(t, set.error);
  const sides = [
    party.types.includes('CUSTOMER') && {
      side: 'SALE' as const,
      label: t('parties.salesLevel'),
      value: party.salesPriceLevelId ?? '',
      key: 'salesPriceLevelId' as const,
      list: party.salesPriceListId ?? '',
      listKey: 'salesPriceListId' as const,
    },
    party.types.includes('SUPPLIER') && {
      side: 'PURCHASE' as const,
      label: t('parties.purchaseLevel'),
      value: party.purchasePriceLevelId ?? '',
      key: 'purchasePriceLevelId' as const,
      list: party.purchasePriceListId ?? '',
      listKey: 'purchasePriceListId' as const,
    },
  ].filter((x) => !!x);
  if (sides.length === 0) return null;

  return (
    <div className="mt-3 grid gap-2">
      {sides.map((s) => {
        const options = levels.filter((l) => l.side === s.side && (l.isActive || l.id === s.value));
        const def = options.find((l) => l.isDefault);
        // Lists given one by one (an offer for everyone applies without being given).
        const listOptions = (lists.data ?? []).filter(
          (l) => l.side === s.side && !l.forEveryone && (l.isActive || l.id === s.list),
        );
        return (
          <div key={s.side} className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{s.label}</span>
              <select
                className={field}
                value={s.value}
                disabled={!canSet || set.isPending}
                onChange={(e) => set.mutate({ id: party.id, input: { [s.key]: e.target.value } })}
              >
                <option value="">
                  {t('parties.defaultLevel')}
                  {def ? ` (${def.name})` : ''}
                </option>
                {options.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            {(listOptions.length > 0 || s.list) && (
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('pl.partyList')}</span>
                <select
                  className={field}
                  value={s.list}
                  disabled={!canSet || set.isPending}
                  onChange={(e) => set.mutate({ id: party.id, input: { [s.listKey]: e.target.value } })}
                >
                  <option value="">{t('pl.noList')}</option>
                  {listOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        );
      })}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Contact details on a party's card: owner / person in charge, phones, addresses, notes. */
function PartyDetails({ party }: { party: Party }) {
  const { t } = useT();
  const factory = isFactory(party.types);
  const phones = [party.phone, ...(party.otherPhones ?? [])].filter((x): x is string => !!x);
  if (
    !party.contactName &&
    phones.length === 0 &&
    !party.address &&
    !party.shippingAddress &&
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
              <a key={p} href={`tel:${p.replace(/\s+/g, '')}`} dir="ltr" className="hover:text-fg">
                {p}
              </a>
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
