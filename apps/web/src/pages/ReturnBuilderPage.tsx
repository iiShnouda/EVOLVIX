import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  RETURN_REASONS,
  type Party,
  type Product,
  type ReturnableItem,
  type ReturnableLine,
  type SalesDocument,
  type TranslationKey,
} from '@skb/shared';
import { Button, Card, Spinner } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { PartyPicker } from '../components/PartyPicker';
import { joinList, useT } from '../lib/i18n';
import { onlyChoice } from '../lib/onlyChoice';
import { useCan, useMayOverride } from '../lib/can';
import { errorText } from '../lib/errors';
import { useAuth } from '../stores/auth';
import { useWorkDraft } from '../lib/workDraft';
import { useWorkPlace } from '../lib/workPlace';
import { useDeviceInfo } from '../lib/device';
import { api } from '../lib/api';
import {
  useCompanySettings,
  useCreateReturn,
  useDepartments,
  usePricing,
  useReturnable,
  type DocScope,
} from '../lib/queries';
import {
  useCreateExchange,
  useTakenSearch,
  useWarehousesWithDamaged,
} from '../lib/returnsQueries';
import { TableColumns } from '../components/TableColumns';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:bg-surface-2';

/** One line being returned: an item they bought, its unit and how many. */
interface ReturnLine {
  key: string;
  productId: string;
  unitId: string;
  qty: string;
  /** Its own reason (owner, 2026-11-18); empty = the return's. */
  reason?: string;
  reasonNote?: string;
  /** A damaged line of a sales return: WAREHOUSE or WRITE_OFF; empty = Settings. */
  damaged?: '' | 'WAREHOUSE' | 'WRITE_OFF';
}

/** In an exchange: one item the customer takes instead (owner, 2026-11-18). */
interface TakenLine {
  key: string;
  product: Product;
  qty: string;
}

/** A return being typed, as kept through an app update. */
interface ReturnDraft {
  party: Party | null;
  branch: string;
  warehouse: string;
  department: string;
  invoiceId: string;
  lines: ReturnLine[];
  notes: string;
  reason?: string;
  reasonNote?: string;
}

/** One line's preview: what it takes from which invoice lines, at what they paid (the server's figures are final). */
interface Taken {
  line: ReturnableLine;
  qty: number;
  value: number;
}

let nextKey = 1;

/**
 * Sales return (مرتجع مبيعات) or purchase return (مرتجع مشتريات), the one way (owner, 2026-11-10):
 * laid out like the invoice — the party, branch, warehouse and department, then the items by code,
 * barcode or name — but only what the party bought here, up to what is left. Each item comes from
 * their invoices newest first (or from the invoice chosen), at what they paid after its discounts;
 * the server takes the same pieces and has the last word. A return started from an invoice opens
 * with that invoice chosen.
 */
export function ReturnBuilderPage({ scope, exchange = false }: { scope: DocScope; exchange?: boolean }) {
  const { id = '' } = useParams();
  return (
    <ReturnForm
      key={`${id || 'new'}${exchange ? '-x' : ''}`}
      scope={scope}
      fromInvoice={id}
      exchange={exchange && scope === 'sales'}
    />
  );
}

function ReturnForm({
  scope,
  fromInvoice,
  exchange,
}: {
  scope: DocScope;
  fromInvoice: string;
  exchange: boolean;
}) {
  const isSale = scope === 'sales';
  const can = useCan();
  const mayWriteOff = isSale && can('returns:write_off');
  // Opened from the damaged goods list: the supplier, branch and damaged warehouse chosen.
  const [params] = useSearchParams();
  const { t, locale } = useT();
  const navigate = useNavigate();
  const isPhone = useDeviceInfo().deviceClass === 'phone';
  const me = useAuth((s) => s.user);
  const settings = useCompanySettings();
  const mayOverride = useMayOverride();
  const currency = settings.data?.currency ?? 'EGP';

  // Branch, then warehouse, then department, as on the invoice.
  const myBranches = me?.branches ?? [];
  const [branch, setBranch] = useState(
    params.get('branch') || (myBranches.length === 1 ? (myBranches[0]?.id ?? '') : ''),
  );
  const [warehouse, setWarehouse] = useState(params.get('warehouse') ?? '');
  const [department, setDepartment] = useState('');
  const [invoiceId, setInvoiceId] = useState(fromInvoice);
  const [place, setPlace] = useWorkPlace();
  const placed = useRef(!!fromInvoice || !!params.get('warehouse'));
  useEffect(() => {
    if (placed.current || (!place.branchId && !place.warehouseId)) return;
    placed.current = true;
    if (place.branchId && myBranches.some((b) => b.id === place.branchId))
      setBranch((b) => b || place.branchId);
    if (place.warehouseId) setWarehouse((w) => w || place.warehouseId);
    if (place.departmentId) setDepartment((d) => d || place.departmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.branchId, place.warehouseId, place.departmentId]);
  // Goods go back to a supplier from a store or from the branch's damaged goods.
  const allWarehouses = useWarehousesWithDamaged(true);
  const branchWarehouses = (allWarehouses.data ?? []).filter(
    (w) =>
      (w.kind === 'STORE' || (!isSale && w.kind === 'DAMAGED')) &&
      w.isActive &&
      w.branchId === branch,
  );
  const warehouseId = branchWarehouses.some((w) => w.id === warehouse)
    ? warehouse
    : onlyChoice(branchWarehouses);
  const departmentList = useDepartments();
  const myDepartments = me?.departmentIds ?? null;
  const onWarehouse = branchWarehouses.find((w) => w.id === warehouseId)?.departmentIds;
  const departments = isSale
    ? (departmentList.data ?? []).filter(
        (d) =>
          d.isActive &&
          (!myDepartments || myDepartments.includes(d.id)) &&
          (!onWarehouse?.length || onWarehouse.includes(d.id)),
      )
    : [];
  const departmentId = departments.some((d) => d.id === department)
    ? department
    : onlyChoice(departments);
  const departmentRequired =
    isSale && departments.length > 0 && settings.data?.requireDepartment !== false;

  const [party, setParty] = useState<Party | null>(null);
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [taken, setTaken] = useState<TakenLine[]>([]);
  const [takenSearch, setTakenSearch] = useState('');
  const [money, setMoney] = useState('');
  const makeExchange = useCreateExchange();
  const [search, setSearch] = useState('');
  const [code, setCode] = useState('');
  const [codeNote, setCodeNote] = useState('');
  const create = useCreateReturn(scope);

  // Opened for a supplier from the damaged goods list.
  useEffect(() => {
    const who = params.get('party');
    if (fromInvoice || !who) return;
    void api
      .get<Party>(`/parties/${who}`)
      .then(setParty)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Started from an invoice: its party, branch, department and warehouse, and only its items.
  const [loading, setLoading] = useState(!!fromInvoice);
  useEffect(() => {
    if (!fromInvoice) return;
    let gone = false;
    void (async () => {
      const doc = await api
        .get<SalesDocument>(`/${scope}/invoices/${fromInvoice}`)
        .catch(() => null);
      const who = doc ? await api.get<Party>(`/parties/${doc.partyId}`).catch(() => null) : null;
      if (gone) return;
      if (doc && who) {
        setParty(who);
        if (doc.branchId) setBranch(doc.branchId);
        setWarehouse(doc.lines[0]?.warehouseId ?? '');
        setDepartment(doc.departmentId ?? '');
      } else setInvoiceId('');
      setLoading(false);
    })();
    return () => {
      gone = true;
    };
  }, [fromInvoice, scope]);

  const returnable = useReturnable(
    scope,
    party?.id ?? '',
    branch,
    isSale ? departmentId || undefined : undefined,
  );
  const items = returnable.data ?? [];
  const byId = new Map(items.map((i) => [i.productId, i]));
  // The invoices they can return from, newest first, for the invoice filter.
  const invoices = [
    ...new Map(items.flatMap((i) => i.lines).map((l) => [l.invoiceId, l] as const)).values(),
  ].sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const chosenInvoice = invoices.some((i) => i.invoiceId === invoiceId) ? invoiceId : '';
  const linesOf = (item: ReturnableItem) =>
    item.lines.filter((l) => !chosenInvoice || l.invoiceId === chosenInvoice);
  const shown = items.filter((i) => linesOf(i).length > 0);

  const work = useWorkDraft<ReturnDraft>(
    2,
    () =>
      lines.length === 0 && !notes
        ? null
        : { party, branch, warehouse, department, invoiceId, lines, notes, reason, reasonNote },
    (d) => {
      if (d.party && typeof d.party.id === 'string') setParty(d.party);
      if (typeof d.branch === 'string') setBranch(d.branch);
      if (typeof d.warehouse === 'string') setWarehouse(d.warehouse);
      if (typeof d.department === 'string') setDepartment(d.department);
      if (typeof d.invoiceId === 'string') setInvoiceId(d.invoiceId);
      if (Array.isArray(d.lines))
        setLines(
          d.lines.filter(
            (l) => l && typeof l.productId === 'string' && typeof l.unitId === 'string',
          ),
        );
      if (typeof d.notes === 'string') setNotes(d.notes);
      if (typeof d.reason === 'string') setReason(d.reason);
      if (typeof d.reasonNote === 'string') setReasonNote(d.reasonNote);
    },
  );

  function add(item: ReturnableItem, unitId?: string, qty?: number) {
    const unit =
      item.units.find((u) => u.unitId === unitId) ?? item.units.find((u) => u.factor === 1);
    setLines((prev) => [
      ...prev,
      {
        key: `r${nextKey++}`,
        productId: item.productId,
        unitId: unit?.unitId ?? '',
        qty: String(qty ?? 1),
      },
    ]);
    setSearch('');
  }
  const update = (key: string, patch: Partial<ReturnLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // What each line takes, newest invoice first, as the server will (fresh invoices only for the owner).
  const left = new Map<string, number>();
  const rows = lines.map((l) => {
    const item = byId.get(l.productId);
    const factor = item?.units.find((u) => u.unitId === l.unitId)?.factor ?? 1;
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
    let need = qty * factor;
    const taken: Taken[] = [];
    let waits: string | null = null;
    for (const s of item ? linesOf(item) : []) {
      if (need <= 0) break;
      if (s.from && !mayOverride) {
        waits = waits ?? s.from;
        continue;
      }
      const has = left.get(s.lineId) ?? s.left;
      const take = Math.min(need, has);
      if (take <= 0) continue;
      left.set(s.lineId, has - take);
      need -= take;
      taken.push({ line: s, qty: take, value: Math.round((s.net * take) / s.quantity) });
    }
    const value = taken.reduce((sum, x) => sum + x.value, 0);
    const room =
      Math.floor(
        (item ? linesOf(item) : [])
          .filter((s) => !s.from || mayOverride)
          .reduce((sum, s) => sum + s.left, 0) / factor,
      ) || 0;
    return { l, item, factor, qty, taken, value, short: need > 0, waits, room };
  });
  const total = rows.reduce((s, r) => s + r.value, 0);
  const reasonOf = (l: ReturnLine) => l.reason || reason;
  const notesOk = rows.every((r) =>
    reasonOf(r.l) !== 'OTHER' ? true : !!(r.l.reason ? r.l.reasonNote : reasonNote)?.trim(),
  );

  // An exchange: what the customer takes instead, priced as the server will (owner, 2026-11-18).
  const takenRows = taken.map((x) => ({ ...x, quantity: Math.max(0, Math.floor(Number(x.qty) || 0)) }));
  const pricing = usePricing('sale', {
    partyId: party?.id,
    warehouseId: warehouseId || undefined,
    lines: exchange
      ? takenRows.map((x) => ({ productId: x.product.id, quantity: Math.max(1, x.quantity) }))
      : [],
  });
  const priced = takenRows.map((x, i) => {
    const p = pricing.data?.lines[i];
    const unitPrice = p?.unitPrice ?? x.product.salePrice;
    const discount = x.quantity > 0 ? (p?.discount ?? 0) : 0;
    return { ...x, unitPrice, discount, value: unitPrice * x.quantity - discount };
  });
  const takenTotal = priced.reduce((s, x) => s + x.value, 0);
  const difference = takenTotal - total;
  const cashCustomer = !!party?.isCashCustomer;
  const productSearch = useTakenSearch(exchange ? takenSearch.trim() : '', warehouseId);
  const takenResults = takenSearch.trim() ? (productSearch.data ?? []).slice(0, 8) : [];

  const ready =
    !!party &&
    notesOk &&
    (!exchange || (priced.length > 0 && priced.every((x) => x.quantity > 0))) &&
    !!branch &&
    !!warehouseId &&
    (!departmentRequired || !!departmentId) &&
    rows.length > 0 &&
    rows.every((r) => r.qty > 0 && !!r.item && !r.short);

  const returnInput = () => ({
    partyId: party!.id,
    branchId: branch,
    warehouseId,
    departmentId: departmentId || undefined,
    invoiceId: chosenInvoice || undefined,
    lines: rows.map((r) => ({
      productId: r.l.productId,
      unitId: r.l.unitId || undefined,
      quantity: r.qty,
      reason: (r.l.reason || undefined) as (typeof RETURN_REASONS)[number] | undefined,
      reasonNote: (r.l.reason === 'OTHER' && r.l.reasonNote?.trim()) || undefined,
      damaged: (isSale && reasonOf(r.l) === 'DAMAGED' && r.l.damaged) || undefined,
    })),
    notes: notes.trim() || undefined,
    reason: (reason || undefined) as (typeof RETURN_REASONS)[number] | undefined,
    reasonNote: (reason === 'OTHER' && reasonNote.trim()) || undefined,
  });

  async function save() {
    if (!party) return;
    try {
      if (exchange) {
        const amount = Math.max(0, Math.round((Number(money) || 0) * 100));
        const saved = await makeExchange.mutateAsync({
          return: returnInput(),
          invoice: {
            partyId: party.id,
            branchId: branch,
            warehouseId,
            departmentId: departmentId || undefined,
            priceLevelId: pricing.data?.priceLevelId ?? undefined,
            lines: priced.map((x) => ({
              productId: x.product.id,
              quantity: x.quantity,
              unitPrice: x.unitPrice,
              discount: x.discount,
            })),
            paidAmount: !cashCustomer && difference > 0 ? Math.min(amount, difference) : 0,
            overrideFloor: false,
          },
          refund: !cashCustomer && difference < 0 ? Math.min(amount, -difference) : 0,
        });
        work.finished();
        navigate(`/sales?doc=${saved.invoice.id}`);
        return;
      }
      await create.mutateAsync(returnInput());
      work.finished();
      navigate(`/${scope}?tab=returns`);
    } catch {
      /* shown below */
    }
  }

  /** Everything left on the chosen invoice (or of what they bought), in base units. */
  function addAll() {
    setLines(
      shown.map((item) => {
        const base = item.units.find((u) => u.factor === 1) ?? item.units[0];
        return {
          key: `r${nextKey++}`,
          productId: item.productId,
          unitId: base?.unitId ?? '',
          qty: String(
            linesOf(item)
              .filter((s) => !s.from || mayOverride)
              .reduce((sum, s) => sum + s.left, 0),
          ),
        };
      }),
    );
  }

  const q = search.trim().toLowerCase();
  const results = q
    ? shown
        .filter((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
        .slice(0, 8)
    : [];
  const noParty = t(isSale ? 'return.pickParty' : 'return.pickSupplier');
  const title = exchange ? t('exchange.new') : t(isSale ? 'return.newSale' : 'return.newPurchase');
  const locked = !party || !warehouseId;

  if (loading) {
    return (
      <div className="grid place-items-center py-24 text-muted">
        <Spinner size={26} />
      </div>
    );
  }

  const priceOf = (r: (typeof rows)[number]) =>
    r.qty > 0 && r.value > 0 ? Math.round(r.value / r.qty) : null;
  const fromOf = (r: (typeof rows)[number]) =>
    joinList([...new Set(r.taken.map((x) => x.line.invoiceNumber))]);

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        title={title}
        action={
          <Button
            variant="ghost"
            size="sm"
            icon="close"
            onClick={() => navigate(`/${scope}?tab=returns`)}
          >
            {t('invoice.back')}
          </Button>
        }
      />
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <PartyPicker
            type={isSale ? 'CUSTOMER' : 'SUPPLIER'}
            withCode
            value={party}
            onChange={(p) => {
              setParty(p);
              setLines([]);
              setInvoiceId('');
            }}
            label={t(isSale ? 'invoice.customer' : 'invoice.supplier')}
            placeholder={t(isSale ? 'invoice.selectCustomer' : 'invoice.selectSupplier')}
          />
        </div>
        <Labelled label={t('list.branch')}>
          <select
            className={`${field} ${!branch ? 'border-warning' : ''}`}
            value={branch}
            onChange={(e) => {
              setBranch(e.target.value);
              setWarehouse('');
              setDepartment('');
              setLines([]);
              setPlace({ branchId: e.target.value, warehouseId: '', departmentId: '' });
            }}
          >
            <option value="" disabled>
              {t('invoice.chooseBranch')}
            </option>
            {myBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label={t('list.warehouse')}>
          <select
            className={`${field} ${branch && !warehouseId ? 'border-warning' : ''}`}
            value={warehouseId}
            disabled={!branch}
            onChange={(e) => {
              setWarehouse(e.target.value);
              setPlace({ branchId: branch, warehouseId: e.target.value, departmentId: '' });
            }}
          >
            <option value="" disabled>
              {t('invoice.chooseWarehouse')}
            </option>
            {branchWarehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Labelled>
        {departments.length > 0 && (
          <Labelled label={t('invoice.department')}>
            <select
              className={`${field} ${departmentRequired && warehouseId && !departmentId ? 'border-warning' : ''}`}
              value={departmentId}
              disabled={!warehouseId}
              onChange={(e) => {
                setDepartment(e.target.value);
                setLines([]);
                setPlace({ departmentId: e.target.value });
              }}
            >
              <option value="" disabled={departmentRequired}>
                {departmentRequired ? t('invoice.chooseDepartment') : t('invoice.noDepartment')}
              </option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Labelled>
        )}
        <Labelled label={t('return.invoice')}>
          <select
            className={field}
            value={chosenInvoice}
            disabled={!party || invoices.length === 0}
            onChange={(e) => {
              setInvoiceId(e.target.value);
              setLines([]);
            }}
          >
            <option value="">{t('return.anyInvoice')}</option>
            {invoices.map((i) => (
              <option key={i.invoiceId} value={i.invoiceId}>
                {i.invoiceNumber} · {formatDate(i.issueDate, locale)}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label={t('return.reasonAll')}>
          <ReasonSelect value={reason} onChange={setReason} empty={t('return.reasonNone')} />
        </Labelled>
        {reason === 'OTHER' && (
          <Labelled label={t('return.reasonNote')} className="sm:col-span-2">
            <input
              className={`${field} ${!reasonNote.trim() ? 'border-warning' : ''}`}
              maxLength={200}
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
            />
          </Labelled>
        )}
      </Card>

      <Card className="space-y-3">
        {/* The item's code (or barcode) in its own box first, as on the invoice: Enter adds it. */}
        <div className="flex items-start gap-2">
          <label className="block w-28 shrink-0 sm:w-36">
            <span className="sr-only">{t('invoice.itemCode')}</span>
            <input
              className="h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm tnum outline-none focus:border-brand"
              dir="ltr"
              placeholder={t('invoice.itemCode')}
              aria-label={t('invoice.itemCode')}
              value={code}
              disabled={locked}
              onChange={(e) => {
                setCode(e.target.value);
                setCodeNote('');
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !code.trim()) return;
                e.preventDefault();
                const c = code.trim().toLowerCase();
                const bySku = shown.find((i) => i.sku.toLowerCase() === c);
                const byBarcode = shown.find((i) =>
                  i.units.some((u) => u.barcode?.toLowerCase() === c),
                );
                const hit = bySku ?? byBarcode;
                if (!hit) {
                  setCodeNote(`${code.trim()}: ${t('return.notBought')}`);
                  return;
                }
                add(hit, byBarcode?.units.find((u) => u.barcode?.toLowerCase() === c)?.unitId);
                setCode('');
              }}
            />
            {codeNote && <span className="mt-1 block text-xs text-destructive">{codeNote}</span>}
          </label>
          <div className="relative min-w-0 flex-1">
            <span className="flex h-10 items-center gap-2 rounded-[var(--radius-app)] border border-line bg-surface px-3 focus-within:border-brand">
              <Icon name="search" size={16} className="shrink-0 text-muted" />
              <input
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                placeholder={t('invoice.searchProduct')}
                value={search}
                disabled={locked}
                onChange={(e) => setSearch(e.target.value)}
              />
              {returnable.isFetching && <Spinner size={14} />}
            </span>
            {results.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-[var(--radius-app)] border border-line bg-surface shadow-lg">
                {results.map((i) => (
                  <li key={i.productId}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2"
                      onClick={() => add(i)}
                    >
                      <span className="min-w-0 truncate font-medium">{i.name}</span>
                      <span className="shrink-0 text-xs text-muted tnum">{i.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {shown.length > 0 && (
            <Button size="sm" variant="secondary" className="h-10" onClick={addAll}>
              {t('return.all')}
            </Button>
          )}
        </div>

        {!party ? (
          <Empty>{noParty}</Empty>
        ) : rows.length === 0 ? (
          <Empty>{t('return.noItems')}</Empty>
        ) : isPhone ? (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.l.key}
                className={`rounded-[var(--radius-app)] border p-3 ${r.short ? 'border-destructive' : 'border-line'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.item?.name}</p>
                    <p className="text-xs text-muted tnum">
                      {r.item?.sku} · {t('return.remaining')}: {r.room}
                    </p>
                  </div>
                  <RemoveButton
                    onClick={() => setLines((p) => p.filter((x) => x.key !== r.l.key))}
                  />
                </div>
                <div className="mt-2 flex items-end gap-2">
                  <Labelled label={t('invoice.qty')} className="w-20">
                    <QtyInput
                      value={r.l.qty}
                      max={r.room}
                      onChange={(v) => update(r.l.key, { qty: v })}
                    />
                  </Labelled>
                  <Labelled label={t('invoice.unit')} className="w-28">
                    <UnitSelect row={r} onChange={(unitId) => update(r.l.key, { unitId })} />
                  </Labelled>
                  <p className="ms-auto text-sm font-semibold tnum">
                    {formatMoney(r.value, currency, locale)}
                  </p>
                </div>
                <RowNote row={r} fromOf={fromOf} />
                <div className="mt-2">
                  <LineReason
                    line={r.l}
                    fallback={reason}
                    sale={isSale}
                    mayWriteOff={mayWriteOff}
                    onChange={(patch) => update(r.l.key, patch)}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <TableColumns id="return.lines">
            <div className="overflow-x-auto rounded-[var(--radius-app)] border border-line">
              <table className="w-full text-[13px]">
                <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                  <tr className="whitespace-nowrap">
                    <th className="px-1.5 py-2 text-start font-medium">#</th>
                    <th className="px-1.5 py-2 text-start font-medium">{t('invoice.item')}</th>
                    <th className="px-1.5 py-2 text-start font-medium">{t('invoice.unit')}</th>
                    <th className="px-1.5 py-2 text-start font-medium">{t('invoice.qty')}</th>
                    <th className="px-1.5 py-2 text-end font-medium">{t('return.remaining')}</th>
                    <th className="px-1.5 py-2 text-end font-medium">{t('return.pricePaid')}</th>
                    <th className="px-1.5 py-2 text-start font-medium">
                      {t('return.fromInvoices')}
                    </th>
                    <th className="px-1.5 py-2 text-start font-medium">{t('return.reason')}</th>
                    <th className="px-1.5 py-2 text-end font-medium">{t('invoice.lineTotal')}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--c-line)]">
                  {rows.map((r, i) => (
                    <tr key={r.l.key} className={r.short ? 'bg-destructive-soft/40' : ''}>
                      <td className="px-1.5 py-2 text-muted tnum">{i + 1}</td>
                      <td className="min-w-40 px-1.5 py-2">
                        <span className="block font-medium">{r.item?.name}</span>
                        <span className="block text-xs text-muted tnum">{r.item?.sku}</span>
                      </td>
                      <td className="px-1.5 py-1.5">
                        <UnitSelect
                          row={r}
                          onChange={(unitId) => update(r.l.key, { unitId })}
                          className="w-28"
                        />
                      </td>
                      <td className="px-1.5 py-1.5">
                        <QtyInput
                          value={r.l.qty}
                          max={r.room}
                          onChange={(v) => update(r.l.key, { qty: v })}
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-2 text-end text-muted tnum">
                        {r.room}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-2 text-end tnum">
                        {priceOf(r) != null ? formatMoney(priceOf(r)!, currency, locale) : ''}
                      </td>
                      <td className="px-1.5 py-2 text-xs text-muted tnum">
                        <RowNote row={r} fromOf={fromOf} inline />
                      </td>
                      <td className="min-w-40 px-1.5 py-1.5">
                        <LineReason
                          line={r.l}
                          fallback={reason}
                          sale={isSale}
                          mayWriteOff={mayWriteOff}
                          onChange={(patch) => update(r.l.key, patch)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-2 text-end font-semibold tnum">
                        {formatMoney(r.value, currency, locale)}
                      </td>
                      <td className="px-1 py-1.5">
                        <RemoveButton
                          onClick={() => setLines((p) => p.filter((x) => x.key !== r.l.key))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TableColumns>
        )}

        <Labelled label={t('invoice.notes')}>
          <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Labelled>
      </Card>

      {exchange && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold">{t('exchange.taken')}</p>
          <div className="relative">
            <span className="flex h-10 items-center gap-2 rounded-[var(--radius-app)] border border-line bg-surface px-3 focus-within:border-brand">
              <Icon name="search" size={16} className="shrink-0 text-muted" />
              <input
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                placeholder={t('invoice.searchProduct')}
                value={takenSearch}
                disabled={locked}
                onChange={(e) => setTakenSearch(e.target.value)}
              />
              {productSearch.isFetching && <Spinner size={14} />}
            </span>
            {takenResults.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-[var(--radius-app)] border border-line bg-surface shadow-lg">
                {takenResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2"
                      onClick={() => {
                        setTaken((prev) => [...prev, { key: `t${nextKey++}`, product: p, qty: '1' }]);
                        setTakenSearch('');
                      }}
                    >
                      <span className="min-w-0 truncate font-medium">{p.name}</span>
                      <span className="shrink-0 text-xs text-muted tnum">{p.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {priced.length === 0 ? (
            <Empty>{t('exchange.noTaken')}</Empty>
          ) : (
            <ul className="divide-y divide-[var(--c-line)] rounded-[var(--radius-app)] border border-line">
              {priced.map((x) => (
                <li key={x.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{x.product.name}</span>
                    <span className="block text-xs text-muted tnum">
                      {x.product.sku} · {x.product.unit}
                    </span>
                  </span>
                  <QtyInput
                    value={x.qty}
                    max={0}
                    onChange={(v) =>
                      setTaken((prev) => prev.map((y) => (y.key === x.key ? { ...y, qty: v } : y)))
                    }
                  />
                  <span className="w-24 text-end text-xs text-muted tnum">
                    {formatMoney(x.unitPrice, currency, locale)}
                  </span>
                  <span className="w-24 text-end font-semibold tnum">
                    {formatMoney(x.value, currency, locale)}
                  </span>
                  <RemoveButton
                    onClick={() => setTaken((prev) => prev.filter((y) => y.key !== x.key))}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {exchange ? (
        <ExchangeBar
          returned={formatMoney(total, currency, locale)}
          taken={formatMoney(takenTotal, currency, locale)}
          difference={difference}
          format={(v) => formatMoney(v, currency, locale)}
          cash={cashCustomer}
          money={money}
          onMoney={setMoney}
          error={errorText(t, makeExchange.error)}
          saving={makeExchange.isPending}
          disabled={!ready || makeExchange.isPending}
          onSave={save}
        />
      ) : (
        <ReturnBar
          total={formatMoney(total, currency, locale)}
          error={errorText(t, create.error)}
          saving={create.isPending}
          disabled={!ready || create.isPending}
          onSave={save}
        />
      )}
    </div>
  );
}

type Row = {
  factor: number;
  item: ReturnableItem | undefined;
  l: ReturnLine;
  short: boolean;
  waits: string | null;
  taken: Taken[];
};

function UnitSelect({
  row,
  onChange,
  className = '',
}: {
  row: Row;
  onChange: (unitId: string) => void;
  className?: string;
}) {
  return (
    <select
      className={`${field} h-8 ${className}`}
      value={row.l.unitId}
      onChange={(e) => onChange(e.target.value)}
    >
      {(row.item?.units ?? []).map((u) => (
        <option key={u.unitId} value={u.unitId}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

function QtyInput({
  value,
  max,
  onChange,
}: {
  value: string;
  max: number;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="number"
      min={1}
      max={max || undefined}
      className={`${field} h-8 w-20 tnum`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Which invoices a line comes from, or why it can't come back yet. */
function RowNote({
  row,
  fromOf,
  inline,
}: {
  row: Row;
  fromOf: (r: Row & { qty: number; value: number; room: number }) => string;
  inline?: boolean;
}) {
  const { t, locale } = useT();
  const text =
    row.short && row.waits
      ? `${t('return.from')} ${formatDate(row.waits, locale, true)}`
      : row.short
        ? t('error.exceeds_returnable')
        : fromOf(row as Row & { qty: number; value: number; room: number });
  if (!text) return null;
  return (
    <span
      className={`${inline ? '' : 'mt-1 block text-xs'} ${row.short ? 'text-destructive' : 'text-muted'}`}
    >
      {text}
    </span>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  const { t } = useT();
  return (
    <button
      type="button"
      className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-destructive-soft hover:text-destructive"
      aria-label={t('invoice.remove')}
      title={t('invoice.remove')}
      onClick={onClick}
    >
      <Icon name="close" size={16} />
    </button>
  );
}

function Labelled({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-0.5 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[var(--radius-app)] bg-surface-2 p-4 text-center text-sm text-muted">
      {children}
    </p>
  );
}

/** The return's total and Save, kept at the bottom of the screen. */
function ReturnBar({
  total,
  error,
  saving,
  disabled,
  onSave,
}: {
  total: string;
  error?: string | null;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  const { t } = useT();
  return (
    <div className="sticky bottom-[var(--bottom-bar,0px)] z-10 -mx-1 rounded-t-2xl border border-line bg-surface px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(15,23,42,.35)] pb-safe">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-muted">{t('invoice.grandTotal')}</span>
          <span className="text-xl font-bold tnum">{total}</span>
        </div>
        <Button
          className="ms-auto"
          icon="check"
          loading={saving}
          disabled={disabled}
          onClick={onSave}
        >
          {saving ? t('return.saving') : t('return.save')}
        </Button>
      </div>
      {error && (
        <p className="mt-2 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The reasons list (owner, 2026-11-18). */
function ReasonSelect({
  value,
  onChange,
  empty,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  empty: string;
  className?: string;
}) {
  const { t } = useT();
  return (
    <select className={`${field} ${className}`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {RETURN_REASONS.map((r) => (
        <option key={r} value={r}>
          {t(`return.reason.${r}` as TranslationKey)}
        </option>
      ))}
    </select>
  );
}

/** A line's own reason, its words for OTHER, and where damaged goods go. */
function LineReason({
  line,
  fallback,
  sale,
  mayWriteOff,
  onChange,
}: {
  line: ReturnLine;
  fallback: string;
  sale: boolean;
  mayWriteOff: boolean;
  onChange: (patch: Partial<ReturnLine>) => void;
}) {
  const { t } = useT();
  const effective = line.reason || fallback;
  return (
    <div className="space-y-1">
      <ReasonSelect
        className="h-8"
        value={line.reason ?? ''}
        onChange={(v) => onChange({ reason: v })}
        empty={t('return.reasonSame')}
      />
      {line.reason === 'OTHER' && (
        <input
          className={`${field} h-8 ${!line.reasonNote?.trim() ? 'border-warning' : ''}`}
          placeholder={t('return.reasonNote')}
          aria-label={t('return.reasonNote')}
          maxLength={200}
          value={line.reasonNote ?? ''}
          onChange={(e) => onChange({ reasonNote: e.target.value })}
        />
      )}
      {sale && effective === 'DAMAGED' && (
        <select
          className={`${field} h-8`}
          aria-label={t('return.damagedTo')}
          value={line.damaged ?? ''}
          onChange={(e) => onChange({ damaged: e.target.value as ReturnLine['damaged'] })}
        >
          <option value="">{t('return.damagedTo')}</option>
          <option value="WAREHOUSE">{t('return.damaged.WAREHOUSE')}</option>
          {mayWriteOff && <option value="WRITE_OFF">{t('return.damaged.WRITE_OFF')}</option>}
        </select>
      )}
    </div>
  );
}

/** An exchange's totals: what comes back, what is taken, the difference and what is paid now. */
function ExchangeBar({
  returned,
  taken,
  difference,
  format,
  cash,
  money,
  onMoney,
  error,
  saving,
  disabled,
  onSave,
}: {
  returned: string;
  taken: string;
  difference: number;
  format: (v: number) => string;
  cash: boolean;
  money: string;
  onMoney: (v: string) => void;
  error?: string | null;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  const { t } = useT();
  return (
    <div className="sticky bottom-[var(--bottom-bar,0px)] z-10 -mx-1 rounded-t-2xl border border-line bg-surface px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(15,23,42,.35)] pb-safe">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div className="text-sm">
          <span className="block text-xs text-muted">{t('exchange.returnedTotal')}</span>
          <span className="font-semibold tnum">{returned}</span>
        </div>
        <div className="text-sm">
          <span className="block text-xs text-muted">{t('exchange.takenTotal')}</span>
          <span className="font-semibold tnum">{taken}</span>
        </div>
        <div>
          <span className="block text-xs text-muted">
            {difference >= 0 ? t('exchange.customerPays') : t('exchange.customerGets')}
          </span>
          <span className="text-xl font-bold tnum">{format(Math.abs(difference))}</span>
        </div>
        {!cash && difference !== 0 && (
          <label className="block w-36">
            <span className="block text-xs text-muted">
              {difference > 0 ? t('exchange.payNow') : t('exchange.refundNow')}
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              className={`${field} h-9 tnum`}
              value={money}
              onChange={(e) => onMoney(e.target.value)}
            />
          </label>
        )}
        <Button className="ms-auto" icon="check" loading={saving} disabled={disabled} onClick={onSave}>
          {saving ? t('exchange.saving') : t('exchange.save')}
        </Button>
      </div>
      {error && (
        <p className="mt-2 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
