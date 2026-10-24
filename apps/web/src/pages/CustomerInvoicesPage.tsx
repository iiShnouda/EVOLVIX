import { useRef, useState, type Ref } from 'react';
import { ItemLink } from '../components/ItemLink';
import { useNavigate, useParams } from 'react-router-dom';
import {
  companyToday,
  formatDate,
  formatMoney,
  formatNumber,
  toMajor,
  toMinor,
  type Party,
  type SalesDocument,
  type TranslationKey,
  type PayState,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { PartyPicker } from '../components/PartyPicker';
import { CompanyMark } from '../components/CompanyBadge';
import {
  InvoicePaper,
  PrintOptions,
  approvalText,
  usePaperOptions,
  PAPER_SIZES,
  PrintSetupSheet,
  type PaperOptions,
} from '../components/DocumentPreview';
import { useT } from '../lib/i18n';
import { useCan, useMayOverride } from '../lib/can';
import { lineDiscount, type LineDiscountMode } from '../lib/discount';
import { errorText } from '../lib/errors';
import { printElement, safeName } from '../lib/print';
import { useReportTools } from '../lib/report';
import { STATE_TONE, statusOf } from '../lib/status';
import {
  useCustomerInvoices,
  useDiscountAll,
  useLockInvoices,
  useSetInvoiceDiscount,
  useSetLineDiscounts,
} from '../lib/queries';
import { PartyLink } from '../components/PartyContact';
import { TableColumns } from '../components/TableColumns';

const field =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** A discount as typed: a percent or an amount in the currency. */
interface DiscountDraft {
  mode: 'percent' | 'amount';
  value: string;
}

/** A charge of `doc` as a discount draft (empty when it has none). */
function draftOf(doc: SalesDocument, kind: 'DISCOUNT' | 'EXTRA_DISCOUNT'): DiscountDraft {
  const c = doc.charges.find((x) => x.kind === kind);
  if (!c) return { mode: 'percent', value: '' };
  return c.rate != null
    ? { mode: 'percent', value: String(c.rate) }
    : { mode: 'amount', value: String(toMajor(c.fixedAmount ?? c.amount)) };
}

/** A line's discount as typed. */
interface LineDraft {
  mode: LineDiscountMode;
  value: string;
}

/**
 * A customer's invoices together, for the accountant (owner, 2026-10-02): when a customer takes
 * goods from several departments, each department's invoice shows one after another, each with
 * its own discount and its own print button; a discount can also be given on all of them together.
 * Every discount is given here (owner, 2026-10-24) — on items, on an invoice, on all of them — each
 * with its own permission.
 * Below, one printout puts every department's invoice together (with the discounts and what was
 * owed before), and another prints every invoice on its own page followed by that one. The print
 * options choose what shows, the type size and bold, and the paper.
 */
export function CustomerInvoicesPage() {
  const { partyId = '' } = useParams();
  const navigate = useNavigate();
  const { t, locale } = useT();
  const can = useCan();
  const canDiscount = can('sales:discount');
  const canLineDiscount = can('sales:discount_line');
  const canDiscountCombined = can('sales:discount_combined');
  const canLock = can('sales:lock');
  const [from, setFrom] = useState(companyToday);
  const [to, setTo] = useState(companyToday);
  const data = useCustomerInvoices(partyId || null, from, to);
  const [options, setOptions] = usePaperOptions();
  const [party, setParty] = useState<Party | null>(null);
  const shownParty = party?.id === partyId ? party : (data.data?.party ?? null);
  const invoices = data.data?.invoices ?? [];
  const returns = data.data?.returns ?? [];
  const returnsTotal = data.data?.returnsTotal ?? 0;
  const currency = data.data?.currency ?? 'EGP';
  const money = (v: number) => formatMoney(v, currency, locale);

  const setDiscount = useSetInvoiceDiscount();
  const setLineDiscounts = useSetLineDiscounts();
  const discountAll = useDiscountAll();
  const lock = useLockInvoices();
  const [all, setAll] = useState<DiscountDraft>({ mode: 'percent', value: '' });
  // One invoice printed: the print setup first (paper and what shows).
  const [printing, setPrinting] = useState<SalesDocument | null>(null);
  const posted = invoices.filter((d) => d.type === 'SALES_INVOICE');
  const total = invoices.reduce((s, d) => s + d.grandTotal, 0);
  const discounts = invoices.reduce((s, d) => s + d.discountTotal, 0);
  const paid = posted.reduce((s, d) => s + d.paidAmount, 0);
  // Printing the combined invoices freezes them (owner, 2026-10-13): the accountant has finished with
  // them, so no one changes them afterwards. Only the posted invoices are locked, and only if allowed.
  const lockPostedForPrint = () => {
    if (canLock && posted.length > 0) lock.mutate({ ids: posted.map((d) => d.id), locked: true });
  };

  // Printing: one invoice, the combined one, or every invoice and then the combined one.
  const combined = useRef<HTMLDivElement>(null);
  const everything = useRef<HTMLDivElement>(null);
  const single = useRef<Record<string, HTMLDivElement | null>>({});
  const printName = (what: string) =>
    safeName(`${what} ${shownParty?.name ?? ''} ${formatDate(from, locale, true)}`);

  function applyAll() {
    const v = Number(all.value);
    discountAll.mutate({
      invoiceIds: invoices.map((d) => d.id),
      ...(all.value.trim() === '' || !(v > 0)
        ? {}
        : all.mode === 'percent'
          ? { percent: Math.round(v * 100) / 100 }
          : { amount: toMinor(v) }),
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('together.title')}
        action={
          <Button variant="ghost" size="sm" icon="close" onClick={() => navigate('/sales')}>
            {t('invoice.back')}
          </Button>
        }
      />

      <Card className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <PartyPicker
            type="CUSTOMER"
            withCode
            value={shownParty}
            onChange={(p) => {
              setParty(p);
              if (p) navigate(`/sales/together/${p.id}`, { replace: true });
            }}
            label={t('invoice.customer')}
            placeholder={t('invoice.selectCustomer')}
          />
        </div>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('sales.filterFrom')}</span>
          <input
            type="date"
            className={`${field} tnum`}
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value || companyToday())}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('sales.filterTo')}</span>
          <input
            type="date"
            className={`${field} tnum`}
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value || from)}
          />
        </label>
        <PrintOptions options={options} onChange={setOptions} />
      </Card>

      {!partyId ? (
        <Card>
          <EmptyState title={t('together.pick')} icon="parties" />
        </Card>
      ) : data.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : invoices.length === 0 && returns.length === 0 ? (
        <Card>
          <EmptyState title={t('common.empty')} icon="sales" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
          <div className="min-w-0 space-y-4">
            {invoices.map((doc) => (
              <InvoiceCard
                key={doc.id}
                doc={doc}
                options={options}
                canDiscount={canDiscount}
                canLineDiscount={canLineDiscount}
                busy={setDiscount.isPending || setLineDiscounts.isPending}
                onLineDiscounts={(lines) => setLineDiscounts.mutate({ doc, lines })}
                onDiscount={(d) => {
                  const v = Number(d.value);
                  setDiscount.mutate({
                    doc,
                    kind: 'DISCOUNT',
                    ...(d.value.trim() === '' || !(v > 0)
                      ? {}
                      : d.mode === 'percent'
                        ? { percent: Math.round(v * 100) / 100 }
                        : { amount: toMinor(v) }),
                  });
                }}
                paperRef={(el) => {
                  single.current[doc.id] = el;
                }}
                onPrint={() => setPrinting(doc)}
                canLock={canLock && doc.type === 'SALES_INVOICE'}
                locked={!!doc.locked}
                onToggleLock={() => lock.mutate({ ids: [doc.id], locked: !doc.locked })}
              />
            ))}
            {(setDiscount.error || setLineDiscounts.error) && (
              <p className="text-sm text-destructive">
                {errorText(t, setDiscount.error ?? setLineDiscounts.error)}
              </p>
            )}
            {printing && <PrintSetupSheet doc={printing} onClose={() => setPrinting(null)} />}
            {/* The customer's returns: printed with the invoices and taken off the total. */}
            {returns.length > 0 && (
              <h2 className="pt-2 text-sm font-semibold text-destructive">
                {t('together.returns')} ({formatNumber(returns.length, locale)})
              </h2>
            )}
            {returns.map((doc) => (
              <InvoiceCard
                key={doc.id}
                doc={doc}
                options={options}
                canDiscount={false}
                canLineDiscount={false}
                busy={false}
                isReturn
                onDiscount={() => undefined}
                onLineDiscounts={() => undefined}
                paperRef={(el) => {
                  single.current[doc.id] = el;
                }}
                onPrint={() => setPrinting(doc)}
              />
            ))}
          </div>

          <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                  {t('together.summary')}
                </h2>
                {data.data!.state && (
                  <Badge tone={STATE_TONE[(data.data!.state as PayState) ?? 'UNPAID'] ?? 'neutral'}>
                    {t(`state.${data.data!.state}` as TranslationKey)}
                  </Badge>
                )}
              </div>
              <dl className="space-y-1.5 text-sm">
                <Line label={t('together.count')} value={formatNumber(invoices.length, locale)} />
                <Line label={t('together.previous')} value={money(data.data!.previousBalance)} />
                <Line label={t('together.total')} value={money(total)} strong />
                {discounts > 0 && (
                  <Line label={t('together.discountsGiven')} value={money(discounts)} />
                )}
                {returnsTotal > 0 && (
                  <Line label={t('together.returnsTotal')} value={money(-returnsTotal)} />
                )}
                {returnsTotal > 0 && (
                  <Line label={t('together.net')} value={money(total - returnsTotal)} strong />
                )}
                {paid > 0 && <Line label={t('sales.paid')} value={money(paid)} />}
                <div className="my-1 border-t border-line" />
                <Line label={t('together.balance')} value={money(data.data!.balance)} strong />
              </dl>
              {canDiscountCombined && (
                <div className="mt-4 space-y-2 border-t border-line pt-3">
                  <p className="text-xs font-medium text-muted">{t('together.discountAll')}</p>
                  <DiscountInputs value={all} onChange={setAll} currency={currency} />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    loading={discountAll.isPending}
                    onClick={applyAll}
                  >
                    {t('together.applyAll')}
                  </Button>
                  {discountAll.error && (
                    <p className="text-xs text-destructive">{errorText(t, discountAll.error)}</p>
                  )}
                </div>
              )}
              <div className="mt-4 grid gap-2">
                <Button
                  icon="print"
                  onClick={() => {
                    if (!combined.current) return;
                    lockPostedForPrint();
                    printElement(combined.current, printName(t('together.title')));
                  }}
                >
                  {t('together.printCombined')}
                </Button>
                <Button
                  variant="secondary"
                  icon="print"
                  onClick={() => {
                    if (!everything.current) return;
                    lockPostedForPrint();
                    printElement(everything.current, printName(t('together.title')));
                  }}
                >
                  {t('together.printAll')}
                </Button>
              </div>
            </Card>
            <Card padded={false} className="overflow-hidden">
              <p className="border-b border-line p-3 text-xs font-semibold text-muted">
                {t('together.preview')}
              </p>
              <div className="max-h-[60vh] overflow-y-auto">
                <CombinedPaper
                  ref={combined}
                  invoices={invoices}
                  returns={returns}
                  party={shownParty}
                  previousBalance={data.data!.previousBalance}
                  balance={data.data!.balance}
                  currency={currency}
                  from={from}
                  to={to}
                  options={options}
                />
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Every invoice on its own page, then the combined one: kept off screen for printing. */}
      {invoices.length + returns.length > 0 && (
        <div
          aria-hidden
          className="pointer-events-none fixed start-0 top-0 h-0 w-0 overflow-hidden"
        >
          <div className="w-[760px]">
            <div ref={everything}>
              {[...invoices, ...returns].map((doc) => (
                <div key={doc.id} className="print-page">
                  <InvoicePaper doc={doc} options={options} />
                </div>
              ))}
              <div className="print-page">
                <CombinedPaper
                  invoices={invoices}
                  returns={returns}
                  party={shownParty}
                  previousBalance={data.data!.previousBalance}
                  balance={data.data!.balance}
                  currency={currency}
                  from={from}
                  to={to}
                  options={options}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InvoiceCard({
  doc,
  options,
  canDiscount,
  canLineDiscount,
  busy,
  onDiscount,
  onLineDiscounts,
  onPrint,
  paperRef,
  isReturn,
  canLock,
  locked,
  onToggleLock,
}: {
  doc: SalesDocument;
  isReturn?: boolean;
  options: PaperOptions;
  canDiscount: boolean;
  canLineDiscount: boolean;
  busy: boolean;
  onDiscount: (d: DiscountDraft) => void;
  onLineDiscounts: (lines: { lineId: string; discount: number }[]) => void;
  onPrint: () => void;
  paperRef: (el: HTMLDivElement | null) => void;
  canLock?: boolean;
  locked?: boolean;
  onToggleLock?: () => void;
}) {
  const { t, locale } = useT();
  const owner = useMayOverride();
  const [open, setOpen] = useState(false);
  const [discounting, setDiscounting] = useState(false);
  const [draft, setDraft] = useState<DiscountDraft>(() => draftOf(doc, 'DISCOUNT'));
  // Each item's discount as typed, from what it has when the discount is opened.
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const status = statusOf(doc);
  const approval = approvalText(doc.approvalNote, t);
  const money = (v: number) => formatMoney(v, doc.currency, locale);
  const items = doc.lines.filter((l) => !l.isBonus);
  const grossOf = (l: SalesDocument['lines'][number]) =>
    l.unitPrice * (l.unitQuantity || l.quantity);
  const newLineDiscount = (l: SalesDocument['lines'][number]) => {
    const d = lineDrafts[l.id];
    return d ? lineDiscount(d.mode, d.value, grossOf(l), l.quantity) : l.discount;
  };
  const changedLines = items.filter((l) => newLineDiscount(l) !== l.discount);
  function openDiscount() {
    if (!discounting)
      setLineDrafts(
        Object.fromEntries(
          items.map((l) => [
            l.id,
            l.discount > 0
              ? { mode: 'amount', value: String(toMajor(l.discount)) }
              : { mode: 'percent', value: '' },
          ]),
        ),
      );
    setDiscounting((d) => !d);
  }
  return (
    <Card padded={false} className={`overflow-hidden ${isReturn ? 'border-destructive/40' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            {isReturn && <Badge tone="destructive">{t('doc.SALES_RETURN')}</Badge>}
            <span className="tnum">{doc.number}</span>
            {doc.departmentName && <span className="text-muted">· {doc.departmentName}</span>}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
            <Badge tone={status.tone}>{t(status.key as TranslationKey)}</Badge>
            {doc.edited && <Badge tone="info">{t('state.EDITED')}</Badge>}
            {locked && <Badge tone="neutral">{t('invoice.locked')}</Badge>}
            {doc.overLimit && <Badge tone="warning">{t('approval.waiting')}</Badge>}
            {approval && <span className="text-muted">{approval}</span>}
          </p>
        </div>
        <div className="text-end">
          <p className={`text-sm font-semibold tnum ${isReturn ? 'text-destructive' : ''}`}>
            {money(isReturn ? -doc.grandTotal : doc.grandTotal)}
          </p>
          {doc.discountTotal > 0 && (
            <p className="text-xs text-warning tnum">
              {t('together.discounts')} −{money(doc.discountTotal)}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 p-3">
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {t(open ? 'together.hideItems' : 'together.showItems')} ({doc.lines.length})
        </Button>
        {(canDiscount || canLineDiscount) && (!locked || owner) && (
          <Button size="sm" variant="secondary" onClick={openDiscount}>
            {t('invoice.addDiscount')}
          </Button>
        )}
        {canLock && onToggleLock && (
          <Button
            size="sm"
            variant="ghost"
            icon={locked ? 'unlock' : 'lock'}
            onClick={onToggleLock}
          >
            {t(locked ? 'invoice.unlock' : 'invoice.lock')}
          </Button>
        )}
        <Button size="sm" variant="secondary" icon="print" className="ms-auto" onClick={onPrint}>
          {t('common.print')}
        </Button>
      </div>
      {discounting && canLineDiscount && items.length > 0 && (
        <div className="border-t border-line p-3">
          <p className="mb-1 text-xs font-medium text-muted">{t('together.itemsDiscount')}</p>
          <ul className="divide-y divide-[var(--c-line)]">
            {items.map((l) => {
              const d = lineDrafts[l.id] ?? { mode: 'percent', value: '' };
              const off = newLineDiscount(l);
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{l.productName}</span>
                    <span className="text-xs text-muted tnum">
                      {formatNumber(l.unitQuantity || l.quantity, locale)} {l.unitName} ×{' '}
                      {money(l.unitPrice)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      className={`${field} w-24 tnum`}
                      aria-label={t('invoice.lineDiscount')}
                      placeholder="0"
                      value={d.value}
                      onChange={(e) =>
                        setLineDrafts((s) => ({ ...s, [l.id]: { ...d, value: e.target.value } }))
                      }
                    />
                    <select
                      className={`${field} px-1.5`}
                      aria-label={t('invoice.lineDiscountMode')}
                      value={d.mode}
                      onChange={(e) =>
                        setLineDrafts((s) => ({
                          ...s,
                          [l.id]: { ...d, mode: e.target.value as LineDiscountMode },
                        }))
                      }
                    >
                      <option value="percent">%</option>
                      <option value="piece">{t('invoice.perPiece')}</option>
                      <option value="amount">{t('invoice.onLine')}</option>
                    </select>
                  </span>
                  <span className="w-28 text-end tnum">
                    {off > 0 && <span className="block text-xs text-warning">−{money(off)}</span>}
                    {money(grossOf(l) - off)}
                  </span>
                </li>
              );
            })}
          </ul>
          <Button
            size="sm"
            className="mt-2"
            loading={busy}
            disabled={changedLines.length === 0}
            onClick={() => {
              onLineDiscounts(
                changedLines.map((l) => ({ lineId: l.id, discount: newLineDiscount(l) })),
              );
              setDiscounting(false);
            }}
          >
            {t('together.apply')}
          </Button>
        </div>
      )}
      {discounting && canDiscount && (
        <div className="border-t border-line p-3">
          <p className="mb-1 text-xs font-medium text-muted">{t('together.invoiceDiscount')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <DiscountInputs value={draft} onChange={setDraft} currency={doc.currency} />
            <Button
              size="sm"
              loading={busy}
              onClick={() => {
                onDiscount(draft);
                setDiscounting(false);
              }}
            >
              {t('together.apply')}
            </Button>
          </div>
        </div>
      )}
      {/* The invoice as it prints; its items show when opened. */}
      <div className={open ? 'border-t border-line' : 'hidden'}>
        <InvoicePaper ref={paperRef} doc={doc} options={options} />
      </div>
    </Card>
  );
}

function DiscountInputs({
  value,
  onChange,
  currency,
}: {
  value: DiscountDraft;
  onChange: (v: DiscountDraft) => void;
  currency: string;
}) {
  const { t } = useT();
  return (
    <span className="flex gap-1">
      <input
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        className={`${field} w-28 tnum`}
        aria-label={t('col.discount')}
        placeholder="0"
        value={value.value}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
      />
      <select
        className={`${field} w-24 px-1.5`}
        aria-label={t('col.discount')}
        value={value.mode}
        onChange={(e) => onChange({ ...value, mode: e.target.value as DiscountDraft['mode'] })}
      >
        <option value="percent">%</option>
        <option value="amount">{currency}</option>
      </select>
    </span>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`tnum ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}

/**
 * Every department's invoice of the customer on one paper: each with its items, its discounts and
 * its total, then all of them together, what was owed before and what is owed now.
 */
function CombinedPaper({
  invoices,
  returns = [],
  party,
  previousBalance,
  balance,
  currency,
  from,
  to,
  options,
  ref,
}: {
  invoices: SalesDocument[];
  returns?: SalesDocument[];
  party: Party | null;
  previousBalance: number;
  balance: number;
  currency: string;
  from: string;
  to: string;
  options: PaperOptions;
  ref?: Ref<HTMLDivElement>;
}) {
  const { t, locale } = useT();
  const { company, details } = useReportTools();
  const shows = options.shows;
  const money = (v: number) => formatMoney(v, currency, locale);
  const total = invoices.reduce((s, d) => s + d.grandTotal, 0);
  const back = returns.reduce((s, d) => s + d.grandTotal, 0);
  const discounts = invoices.reduce((s, d) => s + d.discountTotal, 0);
  const anyLineDiscount = [...invoices, ...returns].some((d) =>
    d.lines.some((l) => l.discount > 0),
  );
  // Department by department (owner, 2026-10-02): its invoices, then its returns, then what it
  // comes to; then all of them together.
  const noDept = t('invoice.noDepartment');
  const groups = [...invoices, ...returns].reduce<
    Map<string, { sales: SalesDocument[]; back: SalesDocument[] }>
  >((m, d) => {
    const key = d.departmentName ?? noDept;
    const g = m.get(key) ?? { sales: [], back: [] };
    (d.type === 'SALES_RETURN' ? g.back : g.sales).push(d);
    return m.set(key, g);
  }, new Map());
  const block = (doc: SalesDocument, isReturn: boolean) => (
    <div
      key={doc.id}
      className={`print-avoid mb-2 rounded-[var(--radius-app)] border ${isReturn ? 'border-destructive/50' : 'border-line'}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-2.5 py-1.5 text-xs">
        <span className="font-semibold">
          {isReturn ? t('doc.SALES_RETURN') : t('together.invoiceNo')}{' '}
          <span className="tnum">{doc.number}</span>
          {isReturn && doc.sourceNumber && (
            <span className="ms-1 font-normal text-muted">
              ({t('return.against')} <span className="tnum">{doc.sourceNumber}</span>)
            </span>
          )}
        </span>
        <span className={`font-semibold tnum ${isReturn ? 'text-destructive' : ''}`}>
          {money(isReturn ? -doc.grandTotal : doc.grandTotal)}
        </span>
      </div>
      {shows('lines') && (
        <TableColumns id="customerInvoices.lines">
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr>
                <th className="px-2 py-1 text-start font-medium">{t('inventory.products')}</th>
                <th className="px-2 py-1 text-end font-medium">{t('sales.qty')}</th>
                <th className="px-2 py-1 text-end font-medium">{t('sales.unitPrice')}</th>
                {anyLineDiscount && (
                  <th className="px-2 py-1 text-end font-medium">{t('col.discount')}</th>
                )}
                <th className="px-2 py-1 text-end font-medium">{t('common.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {doc.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-2 py-1">
                    <ItemLink id={l.productId} name={l.productName} />
                  </td>
                  <td className="px-2 py-1 text-end tnum">
                    {formatNumber(l.unitQuantity || l.quantity, locale)} {l.unitName}
                  </td>
                  <td className="px-2 py-1 text-end tnum">{money(l.unitPrice)}</td>
                  {anyLineDiscount && (
                    <td className="px-2 py-1 text-end tnum">
                      {l.discount > 0 ? money(l.discount) : ''}
                    </td>
                  )}
                  <td className="px-2 py-1 text-end tnum">{money(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableColumns>
      )}
      {doc.charges
        .filter((c) => c.amount !== 0 && (c.kind === 'DISCOUNT' || c.kind === 'EXTRA_DISCOUNT'))
        .map((c, i) => (
          <div key={i} className="flex justify-between border-t border-line px-2.5 py-1 text-xs">
            <span className="text-muted">
              {t(`charge.${c.kind}`)}
              {c.rate != null && ` (${formatNumber(c.rate, locale)}%)`}
            </span>
            <span className="tnum">−{money(c.amount)}</span>
          </div>
        ))}
    </div>
  );
  return (
    <div
      ref={ref}
      className="p-4 text-sm"
      style={options.size !== 'M' ? { zoom: PAPER_SIZES[options.size] } : undefined}
      {...(options.bold ? { 'data-paper-bold': '' } : {})}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        {shows('company') && (
          <>
            <CompanyMark size={40} logoOnly />
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold">{company}</p>
              {details.map((d) => (
                <p key={d} className="break-words text-xs text-muted">
                  <bdi>{d}</bdi>
                </p>
              ))}
            </div>
          </>
        )}
        <div className="ms-auto shrink-0 text-end text-xs text-muted">
          <p className="text-sm font-semibold text-fg">{t('together.paperTitle')}</p>
          <p className="tnum">
            {formatDate(from, locale, true)}
            {to !== from && ` – ${formatDate(to, locale, true)}`}
          </p>
        </div>
      </div>
      {shows('party') && party && (
        <p className="mb-3 rounded-[var(--radius-app)] bg-surface-2 p-2.5 font-medium">
          {t('sales.customer')}:{' '}
          <PartyLink
            id={party.id}
            code={shows('partyCode') ? party.code : null}
            name={party.name}
          />
        </p>
      )}
      {[...groups].map(([name, g]) => {
        const sold = g.sales.reduce((n, d) => n + d.grandTotal, 0);
        const returned = g.back.reduce((n, d) => n + d.grandTotal, 0);
        return (
          <section key={name} className="mb-4">
            <h3 className="mb-1.5 border-b-2 border-fg/70 pb-0.5 text-sm font-bold">
              {t('together.department')}: {name}
            </h3>
            {g.sales.map((d) => block(d, false))}
            {g.back.map((d) => block(d, true))}
            {g.back.length > 0 && (
              <dl className="space-y-0.5 px-1 text-xs">
                <Line label={t('together.deptSales')} value={money(sold)} />
                <Line label={t('together.returnsTotal')} value={money(-returned)} />
                <Line label={t('together.deptNet')} value={money(sold - returned)} strong />
              </dl>
            )}
          </section>
        );
      })}
      {shows('totals') && (
        <dl className="mt-3 space-y-1 border-t-2 border-fg/70 pt-2">
          <Line label={t('together.total')} value={money(total)} strong />
          {discounts > 0 && <Line label={t('together.discountsGiven')} value={money(discounts)} />}
          {back > 0 && <Line label={t('together.returnsTotal')} value={money(-back)} />}
          {back > 0 && <Line label={t('together.net')} value={money(total - back)} strong />}
          <Line label={t('together.previous')} value={money(previousBalance)} />
          <div className="border-t border-line pt-1">
            <Line label={t('together.balance')} value={money(balance)} strong />
          </div>
        </dl>
      )}
    </div>
  );
}
