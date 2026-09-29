import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  toMajor,
  toMinor,
  type DeliveryMethod,
  type DeliveryRow,
  type DeliveryStatus,
  type Shipment,
  type ShipmentStatus,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { MoneyAccountPicker } from '../components/MoneyAccountPicker';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import {
  useCreateSettlement,
  useCreateShipment,
  useDeliveries,
  useEligibleInvoices,
  useParties,
  useSetDelivery,
  useSettlements,
  useShipments,
  useShipmentStep,
  type ShipmentStep,
} from '../lib/queries';

type Tab = 'deliveries' | 'shipments' | 'settlements';
const TABS: { key: Tab; label: TranslationKey }[] = [
  { key: 'deliveries', label: 'delivery.tabDeliveries' },
  { key: 'shipments', label: 'delivery.tabShipments' },
  { key: 'settlements', label: 'delivery.tabSettlements' },
];

const DELIVERY_TONE: Record<DeliveryStatus, Tone> = {
  PENDING: 'neutral',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'positive',
  RETURNED: 'warning',
};
const SHIPMENT_TONE: Record<ShipmentStatus, Tone> = {
  CREATED: 'neutral',
  PICKED_UP: 'info',
  DELIVERED: 'positive',
  SETTLED: 'brand',
  RETURNED: 'warning',
  CANCELLED: 'destructive',
};

const input =
  'h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand disabled:opacity-60';

/**
 * Delivery (التوصيل): sales our drivers take, parcels handed to shipping companies with cash on
 * delivery, and the companies' settlements. Every step is checked again by the server.
 */
export function DeliveriesPage() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((x) => x.key === params.get('tab'))?.key ?? 'deliveries') as Tab;

  return (
    <div className="space-y-5">
      <PageHeader title={t('delivery.title')} subtitle={t('delivery.subtitle')} />
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
      {tab === 'deliveries' && <DeliveriesTab />}
      {tab === 'shipments' && <ShipmentsTab />}
      {tab === 'settlements' && <SettlementsTab />}
    </div>
  );
}

/* ------------------------------------------------------------ shared bits */

function Chips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | '';
  options: T[];
  onChange: (v: T | '') => void;
  label: (v: T) => string;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {(['', ...options] as (T | '')[]).map((o) => (
        <button
          key={o || 'all'}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
            value === o
              ? 'border-brand bg-brand-soft text-brand'
              : 'border-line text-muted hover:text-fg'
          }`}
        >
          {o ? label(o) : t('delivery.all')}
        </button>
      ))}
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-sm tnum">{children}</dd>
    </div>
  );
}

/** What a step did besides moving: returns posted, and ones that could not be. */
function Outcome({ returns, problems }: { returns: string[]; problems: string[] }) {
  const { t } = useT();
  if (returns.length === 0 && problems.length === 0) return null;
  return (
    <Card className="space-y-1 text-sm">
      {returns.length > 0 && (
        <p className="text-positive">
          {t('delivery.returnsPosted')}: <span className="tnum">{returns.join('، ')}</span>
        </p>
      )}
      {problems.length > 0 && (
        <p className="text-destructive">
          {t('delivery.problems')}: {problems.join(' · ')}
        </p>
      )}
    </Card>
  );
}

/** Confirm a refusal, optionally putting the goods back through sales returns. */
function ReturnSheet({
  onClose,
  onConfirm,
  pending,
  error,
}: {
  onClose: () => void;
  onConfirm: (createReturns: boolean) => void;
  pending: boolean;
  error: string | null;
}) {
  const { t } = useT();
  const can = useCan();
  const canReturn = can('sales:return');
  const [post, setPost] = useState(canReturn);
  return (
    <Sheet title={t('delivery.confirmReturned')} onClose={onClose} closeLabel={t('common.close')}>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={post}
          disabled={!canReturn}
          onChange={(e) => setPost(e.target.checked)}
        />
        <span>
          {t('delivery.postReturn')}
          {!canReturn && (
            <span className="block text-xs text-faint">{t('error.return_not_allowed')}</span>
          )}
        </span>
      </label>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" loading={pending} onClick={() => onConfirm(post)}>
          {t('delivery.confirmReturned')}
        </Button>
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------- deliveries tab */

const DELIVERY_STATUSES: DeliveryStatus[] = [
  'PENDING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RETURNED',
];
const METHODS: DeliveryMethod[] = ['OWN_DELIVERY', 'SHIPPING_COMPANY'];

function DeliveriesTab() {
  const { t } = useT();
  const can = useCan();
  const [status, setStatus] = useState<DeliveryStatus | ''>('');
  const [method, setMethod] = useState<DeliveryMethod | ''>('');
  const { data, isLoading } = useDeliveries({
    status: status || undefined,
    method: method || undefined,
  });
  const step = useSetDelivery();
  const [returning, setReturning] = useState<DeliveryRow | null>(null);
  const [outcome, setOutcome] = useState<{ returns: string[]; problems: string[] } | null>(null);
  const canManage = can('delivery:manage');

  async function move(
    row: DeliveryRow,
    next: 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RETURNED',
    createReturn = false,
  ) {
    try {
      const res = await step.mutateAsync({
        id: row.documentId,
        input: { status: next, createReturn },
      });
      setOutcome({ returns: res.returns, problems: res.problems });
      setReturning(null);
    } catch {
      /* shown below */
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="h-8 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-xs outline-none focus:border-brand"
          value={method}
          aria-label={t('delivery.method')}
          onChange={(e) => setMethod(e.target.value as DeliveryMethod | '')}
        >
          <option value="">
            {t('delivery.method')}: {t('delivery.all')}
          </option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`delivery.${m}`)}
            </option>
          ))}
        </select>
        <Chips
          value={status}
          options={DELIVERY_STATUSES}
          onChange={setStatus}
          label={(s) => t(`delivery.status.${s}`)}
        />
      </div>
      {outcome && <Outcome {...outcome} />}
      {step.error && !returning && (
        <p className="text-sm text-destructive">{errorText(t, step.error)}</p>
      )}
      {isLoading ? (
        <Loading />
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('delivery.empty')} icon="delivery" />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.items.map((row) => (
            <DeliveryCard
              key={row.documentId}
              row={row}
              actions={
                canManage &&
                row.method === 'OWN_DELIVERY' &&
                (row.status === 'PENDING' || row.status === 'OUT_FOR_DELIVERY') ? (
                  <>
                    {row.status === 'PENDING' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={step.isPending}
                        onClick={() => void move(row, 'OUT_FOR_DELIVERY')}
                      >
                        {t('delivery.outForDelivery')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={step.isPending}
                      onClick={() => void move(row, 'DELIVERED')}
                    >
                      {t('delivery.markDelivered')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={step.isPending}
                      onClick={() => setReturning(row)}
                    >
                      {t('delivery.markReturned')}
                    </Button>
                  </>
                ) : null
              }
            />
          ))}
        </div>
      )}
      {returning && (
        <ReturnSheet
          onClose={() => setReturning(null)}
          pending={step.isPending}
          error={errorText(t, step.error)}
          onConfirm={(post) => void move(returning, 'RETURNED', post)}
        />
      )}
    </div>
  );
}

function DeliveryCard({ row, actions }: { row: DeliveryRow; actions: ReactNode }) {
  const { t, locale } = useT();
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{row.partyName}</p>
          <p className="text-xs text-muted tnum">
            {row.number} · {formatDate(row.issueDate, locale)} · {row.branchName}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge tone="brand">{t(`delivery.${row.method}`)}</Badge>
          {row.status && (
            <Badge tone={DELIVERY_TONE[row.status]}>{t(`delivery.status.${row.status}`)}</Badge>
          )}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
        <Fact label={t('sales.grandTotal')}>
          {formatMoney(row.grandTotal, row.currency, locale)}
        </Fact>
        <Fact label={t('delivery.outstanding')}>
          {formatMoney(row.outstanding, row.currency, locale)}
        </Fact>
        {row.method === 'OWN_DELIVERY' ? (
          <Fact label={t('delivery.driver')}>{row.driverName ?? t('delivery.noDriver')}</Fact>
        ) : (
          <Fact label={t('delivery.carrier')}>{row.carrierName ?? '—'}</Fact>
        )}
        {row.address && (
          <div className="col-span-2 min-w-0 sm:col-span-3">
            <dt className="text-xs text-muted">{t('delivery.address')}</dt>
            <dd className="break-words text-sm">{row.address}</dd>
          </div>
        )}
      </dl>
      {row.method === 'SHIPPING_COMPANY' && (row.shipmentNumber || row.status === 'PENDING') && (
        <p className="mt-2 text-xs text-muted">
          {row.shipmentNumber
            ? `${t('delivery.inParcel')}: ${row.shipmentNumber} · ${t(`shipment.status.${row.shipmentStatus ?? 'CREATED'}`)}`
            : t('delivery.useParcel')}
        </p>
      )}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </Card>
  );
}

/* --------------------------------------------------------- shipments tab */

const SHIPMENT_STATUSES: ShipmentStatus[] = [
  'CREATED',
  'PICKED_UP',
  'DELIVERED',
  'SETTLED',
  'RETURNED',
  'CANCELLED',
];

function ShipmentsTab() {
  const { t } = useT();
  const can = useCan();
  const [status, setStatus] = useState<ShipmentStatus | ''>('');
  const { data, isLoading } = useShipments({ status: status || undefined });
  const step = useShipmentStep();
  const [creating, setCreating] = useState(false);
  const [returning, setReturning] = useState<Shipment | null>(null);
  const [outcome, setOutcome] = useState<{ returns: string[]; problems: string[] } | null>(null);
  const canManage = can('delivery:manage');

  async function move(s: Shipment, name: ShipmentStep, createReturns = false) {
    try {
      const res = await step.mutateAsync({ id: s.id, step: name, createReturns });
      setOutcome(name === 'returned' ? { returns: res.returns, problems: res.problems } : null);
      setReturning(null);
    } catch {
      /* shown below */
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips
          value={status}
          options={SHIPMENT_STATUSES}
          onChange={setStatus}
          label={(s) => t(`shipment.status.${s}`)}
        />
        {canManage && (
          <Button icon="plus" onClick={() => setCreating(true)}>
            {t('shipment.new')}
          </Button>
        )}
      </div>
      {outcome && <Outcome {...outcome} />}
      {step.error && !returning && (
        <p className="text-sm text-destructive">{errorText(t, step.error)}</p>
      )}
      {isLoading ? (
        <Loading />
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('shipment.empty')} icon="delivery" />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.items.map((s) => (
            <ShipmentCard
              key={s.id}
              s={s}
              actions={
                canManage && (s.status === 'CREATED' || s.status === 'PICKED_UP') ? (
                  <>
                    {s.status === 'CREATED' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={step.isPending}
                        onClick={() => void move(s, 'picked-up')}
                      >
                        {t('shipment.pickedUp')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={step.isPending}
                      onClick={() => void move(s, 'delivered')}
                      title={s.codAmount > 0 ? t('shipment.deliveredHint') : undefined}
                    >
                      {t('shipment.delivered')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={step.isPending}
                      onClick={() => setReturning(s)}
                    >
                      {t('shipment.returned')}
                    </Button>
                    {s.status === 'CREATED' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={step.isPending}
                        onClick={() => void move(s, 'cancel')}
                      >
                        {t('shipment.cancel')}
                      </Button>
                    )}
                  </>
                ) : null
              }
            />
          ))}
        </div>
      )}
      {creating && <NewShipmentSheet onClose={() => setCreating(false)} />}
      {returning && (
        <ReturnSheet
          onClose={() => setReturning(null)}
          pending={step.isPending}
          error={errorText(t, step.error)}
          onConfirm={(post) => void move(returning, 'returned', post)}
        />
      )}
    </div>
  );
}

function ShipmentCard({ s, actions }: { s: Shipment; actions: ReactNode }) {
  const { t, locale } = useT();
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{s.partyName}</p>
          <p className="text-xs text-muted tnum">
            {s.number}
            {s.waybillNo ? ` · ${s.waybillNo}` : ''} · {formatDate(s.createdAt, locale)}
          </p>
        </div>
        <Badge tone={SHIPMENT_TONE[s.status]}>{t(`shipment.status.${s.status}`)}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
        <Fact label={t('delivery.carrier')}>{s.carrierName}</Fact>
        <Fact label={t('shipment.cod')}>{formatMoney(s.codAmount, s.currency, locale)}</Fact>
        <Fact label={t('common.branch')}>{s.branchName}</Fact>
        <div className="col-span-2 min-w-0 sm:col-span-3">
          <dt className="text-xs text-muted">{t('shipment.invoices')}</dt>
          <dd className="flex flex-wrap gap-x-3 text-sm tnum">
            {s.invoices.map((i) => (
              <span key={i.documentId}>
                {i.number}
                {s.codAmount > 0 && (
                  <span className="text-muted">
                    {' '}
                    ({formatMoney(i.codShare, s.currency, locale)})
                  </span>
                )}
              </span>
            ))}
          </dd>
        </div>
      </dl>
      {s.settlementNumber && (
        <p className="mt-2 text-xs text-muted">
          {t('settlement.number')}: <span className="tnum">{s.settlementNumber}</span>
        </p>
      )}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </Card>
  );
}

function useCarriers() {
  return useParties({ page: 1, pageSize: 100, type: 'CARRIER', active: true });
}

function NewShipmentSheet({ onClose }: { onClose: () => void }) {
  const { t, locale } = useT();
  const carriers = useCarriers();
  const [carrierId, setCarrierId] = useState('');
  const eligible = useEligibleInvoices(carrierId);
  const [picked, setPicked] = useState<string[]>([]);
  const [waybill, setWaybill] = useState('');
  const [cod, setCod] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const create = useCreateShipment();

  const rows = eligible.data ?? [];
  const chosen = rows.filter((r) => picked.includes(r.documentId));
  const customer = chosen[0]?.partyId;
  const owed = chosen.reduce((sum, r) => sum + r.outstanding, 0);
  const currency = rows[0]?.currency ?? 'EGP';
  const codMinor = cod === null ? owed : toMinor(Number(cod) || 0);
  const codBad = codMinor < 0 || codMinor > owed;
  const groups = useMemo(() => {
    const m = new Map<string, DeliveryRow[]>();
    for (const r of rows) m.set(r.partyId, [...(m.get(r.partyId) ?? []), r]);
    return [...m.values()];
  }, [rows]);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function save() {
    try {
      await create.mutateAsync({
        carrierId,
        invoiceIds: picked,
        waybillNo: waybill.trim() || undefined,
        codAmount: codMinor,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet title={t('shipment.new')} onClose={onClose} closeLabel={t('common.close')} wide>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('delivery.carrier')}</span>
          <select
            className={input}
            value={carrierId}
            onChange={(e) => {
              setCarrierId(e.target.value);
              setPicked([]);
              setCod(null);
            }}
          >
            <option value="">{t('delivery.pickCarrier')}</option>
            {(carriers.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {carriers.data && carriers.data.items.length === 0 && (
            <span className="mt-1 block text-xs text-faint">{t('delivery.noCarriers')}</span>
          )}
        </label>

        {carrierId && (
          <div>
            <p className="mb-1 text-xs text-muted">{t('shipment.pickInvoices')}</p>
            {eligible.isLoading ? (
              <Loading />
            ) : rows.length === 0 ? (
              <p className="rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm text-muted">
                {t('shipment.noEligible')}
              </p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-auto">
                {groups.map((g) => (
                  <div
                    key={g[0]!.partyId}
                    className="rounded-[var(--radius-app)] border border-line p-2"
                  >
                    <p className="mb-1 text-sm font-medium">{g[0]!.partyName}</p>
                    {g.map((r) => {
                      const other = !!customer && customer !== r.partyId;
                      return (
                        <label
                          key={r.documentId}
                          className={`flex items-center justify-between gap-2 rounded px-1 py-1 text-sm ${other ? 'opacity-50' : ''}`}
                          title={other ? t('shipment.oneCustomer') : undefined}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={picked.includes(r.documentId)}
                              disabled={other}
                              onChange={() => {
                                toggle(r.documentId);
                                setCod(null);
                              }}
                            />
                            <span className="truncate tnum">
                              {r.number} · {formatDate(r.issueDate, locale)}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted tnum">
                            {t('delivery.outstanding')}:{' '}
                            {formatMoney(r.outstanding, r.currency, locale)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {chosen.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-muted">{t('shipment.waybill')}</span>
              <input
                className={input}
                dir="ltr"
                value={waybill}
                maxLength={60}
                placeholder={t('shipment.waybillPlaceholder')}
                onChange={(e) => setWaybill(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">{t('shipment.cod')}</span>
              <input
                className={`${input} tnum`}
                type="number"
                min={0}
                step="0.01"
                value={cod ?? String(toMajor(owed))}
                aria-invalid={codBad}
                onChange={(e) => setCod(e.target.value)}
              />
              <span
                className={`mt-0.5 block text-xs ${codBad ? 'text-destructive' : 'text-faint'}`}
              >
                {codBad ? t('shipment.codMax') : t('shipment.codHint')} (
                {formatMoney(owed, currency, locale)})
              </span>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-muted">{t('invoice.notes')}</span>
              <input
                className={input}
                value={notes}
                maxLength={500}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
        )}

        {create.error && <p className="text-sm text-destructive">{errorText(t, create.error)}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon="check"
            loading={create.isPending}
            disabled={chosen.length === 0 || codBad}
            onClick={() => void save()}
          >
            {t('shipment.create')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------- settlements tab */

function SettlementsTab() {
  const { t, locale } = useT();
  const can = useCan();
  const { data, isLoading } = useSettlements();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">{t('settlement.hint')}</p>
        {can('delivery:settle') && (
          <Button icon="plus" onClick={() => setCreating(true)}>
            {t('settlement.new')}
          </Button>
        )}
      </div>
      {isLoading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState title={t('settlement.empty')} icon="delivery" />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((x) => (
            <Card key={x.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{x.carrierName}</p>
                  <p className="text-xs text-muted tnum">
                    {x.number} · {formatDate(x.createdAt, locale)} · {x.createdByName}
                  </p>
                </div>
                {x.difference !== 0 && (
                  <Badge tone="warning">
                    {t('settlement.difference')}: {formatMoney(x.difference, x.currency, locale)}
                  </Badge>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                <Fact label={t('settlement.codTotal')}>
                  {formatMoney(x.codTotal, x.currency, locale)}
                </Fact>
                <Fact label={t('settlement.fees')}>{formatMoney(x.fees, x.currency, locale)}</Fact>
                <Fact label={t('settlement.received')}>
                  {formatMoney(x.received, x.currency, locale)}
                </Fact>
              </dl>
              <p className="mt-2 text-xs text-muted">
                {t('settlement.parcels')}: <span className="tnum">{x.shipments.join('، ')}</span>
              </p>
              {x.notes && <p className="mt-1 text-xs text-muted">{x.notes}</p>}
            </Card>
          ))}
        </div>
      )}
      {creating && <NewSettlementSheet onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewSettlementSheet({ onClose }: { onClose: () => void }) {
  const { t, locale } = useT();
  const carriers = useCarriers();
  const [carrierId, setCarrierId] = useState('');
  const delivered = useShipments({ status: 'DELIVERED', carrierId: carrierId || undefined });
  const [picked, setPicked] = useState<string[]>([]);
  const [fees, setFees] = useState('');
  const [received, setReceived] = useState('');
  const [accountId, setAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const create = useCreateSettlement();

  const rows = carrierId ? (delivered.data?.items ?? []).filter((s) => s.codAmount > 0) : [];
  const currency = rows[0]?.currency ?? 'EGP';
  const codTotal = rows
    .filter((s) => picked.includes(s.id))
    .reduce((sum, s) => sum + s.codAmount, 0);
  const feesMinor = toMinor(Number(fees) || 0);
  const receivedMinor = toMinor(Number(received) || 0);
  const difference = codTotal - feesMinor - receivedMinor;
  const bad = feesMinor < 0 || receivedMinor < 0;

  async function save() {
    try {
      await create.mutateAsync({
        carrierId,
        shipmentIds: picked,
        fees: feesMinor,
        received: receivedMinor,
        notes: notes.trim() || undefined,
        accountId: receivedMinor > 0 && accountId ? accountId : undefined,
      });
      onClose();
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet title={t('settlement.new')} onClose={onClose} closeLabel={t('common.close')} wide>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('delivery.carrier')}</span>
          <select
            className={input}
            value={carrierId}
            onChange={(e) => {
              setCarrierId(e.target.value);
              setPicked([]);
            }}
          >
            <option value="">{t('delivery.pickCarrier')}</option>
            {(carriers.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {carrierId && (
          <div>
            <p className="mb-1 text-xs text-muted">{t('settlement.pickParcels')}</p>
            {delivered.isLoading ? (
              <Loading />
            ) : rows.length === 0 ? (
              <p className="rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm text-muted">
                {t('settlement.noParcels')}
              </p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-auto rounded-[var(--radius-app)] border border-line p-2">
                {rows.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center justify-between gap-2 py-1 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={picked.includes(s.id)}
                        onChange={() =>
                          setPicked((cur) =>
                            cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id],
                          )
                        }
                      />
                      <span className="truncate">
                        <span className="tnum">{s.number}</span> · {s.partyName}
                      </span>
                    </span>
                    <span className="shrink-0 tnum">
                      {formatMoney(s.codAmount, s.currency, locale)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {picked.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">{t('settlement.fees')}</span>
                <input
                  className={`${input} tnum`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={fees}
                  onChange={(e) => setFees(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">{t('settlement.received')}</span>
                <input
                  className={`${input} tnum`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                />
              </label>
              {receivedMinor > 0 && (
                <div className="sm:col-span-2">
                  <MoneyAccountPicker
                    className={input}
                    label={t('money.receivedInto')}
                    value={accountId}
                    onChange={setAccountId}
                  />
                </div>
              )}
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs text-muted">{t('invoice.notes')}</span>
                <input
                  className={input}
                  value={notes}
                  maxLength={500}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>
            <dl className="grid grid-cols-2 gap-2 rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm">
              <dt className="text-muted">{t('settlement.codTotal')}</dt>
              <dd className="text-end tnum">{formatMoney(codTotal, currency, locale)}</dd>
              <dt className="text-muted">{t('settlement.difference')}</dt>
              <dd
                className={`text-end font-semibold tnum ${difference !== 0 ? 'text-warning' : ''}`}
              >
                {formatMoney(difference, currency, locale)}
              </dd>
            </dl>
          </>
        )}

        {bad && <p className="text-sm text-destructive">{t('error.bad_amount')}</p>}
        {create.error && <p className="text-sm text-destructive">{errorText(t, create.error)}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon="check"
            loading={create.isPending}
            disabled={picked.length === 0 || bad}
            onClick={() => void save()}
          >
            {t('settlement.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
