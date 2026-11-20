import { useRef, useState, type Ref } from 'react';
import { ItemLink } from '../components/ItemLink';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  amountInWords,
  companyToday,
  formatDate,
  foldIncreases,
  formatMoney,
  formatNumber,
  toMinor,
  type Party,
  type SalesDocument,
  type TranslationKey,
  type PayState,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { PartyPicker } from '../components/PartyPicker';
import { IncreaseDetails, IncreasesToggle, useIncreaseView } from '../components/Increases';
import { CompanyMark } from '../components/CompanyBadge';
import {
  InvoicePaper,
  approvalText,
  usePaperOptions,
  PAPER_SIZES,
  PrintSetupSheet,
  type PaperOptions,
} from '../components/DocumentPreview';
import { useT } from '../lib/i18n';
import { useCan, useMayOverride } from '../lib/can';
import {
  AdjustEditor,
  adjustPayload,
  adjustPreview,
  badPercent,
  boxesChanged,
  boxesOf,
  combinedShares,
  mayAdjust,
  useAdjustRights,
  type AdjustBoxes,
  type AdjustRights,
} from '../components/AdjustEditor';
import { errorText } from '../lib/errors';
import { asOutput, printElement, safeName } from '../lib/print';
import { useReportTools } from '../lib/report';
import { STATE_TONE, statusOf } from '../lib/status';
import {
  useCustomerInvoices,
  useDiscountAll,
  useLockInvoices,
  useSetAdjustments,
} from '../lib/queries';
import { PartyLink } from '../components/PartyContact';
import { TableColumns } from '../components/TableColumns';

const field =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** A discount as typed: a percent, an amount in the currency, or an amount a piece. */
interface DiscountDraft {
  mode: 'percent' | 'amount' | 'piece';
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
  // Each box is its own permission (owner, 2026-11-19); the accountant changes the discounts there
  // are, he adds no second one (owner, 2026-11-20).
  const rights = useAdjustRights();
  const canDiscountCombined = can('sales:discount_combined');
  const canLock = can('sales:lock');
  // `?day=` opens on that day (an invoice's own); today otherwise.
  const [params] = useSearchParams();
  const linkedDay = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') ?? '') ? params.get('day')! : null;
  const [from, setFrom] = useState(() => linkedDay ?? companyToday());
  const [to, setTo] = useState(() => linkedDay ?? companyToday());
  const data = useCustomerInvoices(partyId || null, from, to);
  const [options] = usePaperOptions();
  const [party, setParty] = useState<Party | null>(null);
  const shownParty = party?.id === partyId ? party : (data.data?.party ?? null);
  const invoices = data.data?.invoices ?? [];
  const returns = data.data?.returns ?? [];
  const returnsTotal = data.data?.returnsTotal ?? 0;
  const currency = data.data?.currency ?? 'EGP';
  const money = (v: number) => formatMoney(v, currency, locale);

  const setAdjustments = useSetAdjustments();
  const discountAll = useDiscountAll();
  const lock = useLockInvoices();
  const [all, setAll] = useState<DiscountDraft>({ mode: 'percent', value: '' });
  // One invoice printed: the print setup first (paper and what shows).
  const [printing, setPrinting] = useState<SalesDocument | null>(null);
  const canPrint = can('sales:print');
  const posted = invoices.filter((d) => d.type === 'SALES_INVOICE');
  const total = invoices.reduce((s, d) => s + d.grandTotal, 0);
  const discounts = invoices.reduce((s, d) => s + d.discountTotal, 0);
  // Everything settled since the period began (owner, 2026-11-10): money at the counter and after,
  // cheques, discounts given later — so the summary adds up: before + invoices − returns − paid = now.
  const paid = data.data
    ? data.data.previousBalance +
      posted.reduce((n, d) => n + d.grandTotal, 0) -
      returnsTotal -
      data.data.balance
    : 0;
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
          : all.mode === 'piece'
            ? { perPiece: toMinor(v) }
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
                rights={rights}
                busy={setAdjustments.isPending}
                onAdjust={(boxes) =>
                  setAdjustments.mutateAsync({ doc, ...adjustPayload(doc, boxes) }).then(
                    () => true,
                    () => false,
                  )
                }
                paperRef={(el) => {
                  single.current[doc.id] = el;
                }}
                onPrint={canPrint ? () => setPrinting(doc) : undefined}
                canLock={canLock && doc.type === 'SALES_INVOICE'}
                locked={!!doc.locked}
                onToggleLock={() => lock.mutate({ ids: [doc.id], locked: !doc.locked })}
              />
            ))}
            {setAdjustments.error && (
              <p className="text-sm text-destructive">{errorText(t, setAdjustments.error)}</p>
            )}
            {printing && (
              <PrintSetupSheet doc={printing} record onClose={() => setPrinting(null)} />
            )}
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
                busy={false}
                isReturn
                paperRef={(el) => {
                  single.current[doc.id] = el;
                }}
                onPrint={canPrint ? () => setPrinting(doc) : undefined}
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
                {paid !== 0 && <Line label={t('sales.paid')} value={money(paid)} />}
                <div className="my-1 border-t border-line" />
                <Line label={t('together.balance')} value={money(data.data!.balance)} strong />
              </dl>
              {canDiscountCombined && (
                <div className="mt-4 space-y-2 border-t border-line pt-3">
                  <p className="text-xs font-medium text-muted">{t('together.discountAll')}</p>
                  <p className="text-xs text-faint">{t('together.discountAllHint')}</p>
                  <DiscountInputs value={all} onChange={setAll} currency={currency} />
                  {/* What each invoice's discount becomes, before it is given. */}
                  {Number(all.value) > 0 && (
                    <div className="rounded-[var(--radius-app)] bg-surface-2 p-2 text-xs">
                      <p className="mb-1 font-medium text-muted">{t('together.discountAllEach')}</p>
                      <ul className="space-y-0.5">
                        {combinedShares(invoices, all.mode, all.value).map((x) => {
                          const d = invoices.find((i) => i.id === x.id)!;
                          return (
                            <li key={x.id} className="flex justify-between gap-2 tnum">
                              <span>
                                {d.number}
                                {x.percent != null && ` (${formatNumber(x.percent, locale)}%)`}
                                {x.perPiece != null &&
                                  ` (${t('charge.perPieceOf')
                                    .replace('{amount}', money(x.perPiece))
                                    .replace('{pieces}', formatNumber(x.pieces ?? 0, locale))})`}
                              </span>
                              <span className="text-warning">−{money(x.amount)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
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
              {canPrint && (
                <div className="mt-4 grid gap-2">
                  <Button
                    icon="print"
                    onClick={() => {
                      if (!combined.current) return;
                      // Locked once it is really printed (owner, 2026-11-10: opening the print
                      // setup and cancelling locked them all).
                      asOutput({ page: 'sales', kind: 'print' }, () =>
                        printElement(
                          combined.current!,
                          printName(t('together.title')),
                          undefined,
                          lockPostedForPrint,
                        ),
                      );
                    }}
                  >
                    {t('together.printCombined')}
                  </Button>
                  <Button
                    variant="secondary"
                    icon="print"
                    onClick={() => {
                      if (!everything.current) return;
                      asOutput({ page: 'sales', kind: 'print' }, () =>
                        printElement(
                          everything.current!,
                          printName(t('together.title')),
                          undefined,
                          lockPostedForPrint,
                        ),
                      );
                    }}
                  >
                    {t('together.printAll')}
                  </Button>
                </div>
              )}
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
          <div className="w-[47.5rem]">
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
  rights,
  busy,
  onAdjust,
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
  /** The boxes this person may change; none on a return. */
  rights?: AdjustRights;
  busy: boolean;
  /** Saves the boxes; true once saved. */
  onAdjust?: (boxes: AdjustBoxes) => Promise<boolean>;
  onPrint?: () => void;
  paperRef: (el: HTMLDivElement | null) => void;
  canLock?: boolean;
  locked?: boolean;
  onToggleLock?: () => void;
}) {
  const { t, locale } = useT();
  const owner = useMayOverride();
  const [open, setOpen] = useState(false);
  // The discounts it has, filled in when opened (owner, 2026-11-20): changed in place.
  const [boxes, setBoxes] = useState<AdjustBoxes | null>(null);
  const canAdjust = !isReturn && !!rights && mayAdjust(rights) && !!onAdjust;
  const status = statusOf(doc);
  const approval = approvalText(doc.approvalNote, t);
  const money = (v: number) => formatMoney(v, doc.currency, locale);
  const bad = boxes ? badPercent(boxes) : false;
  // What was added, and by whom: behind the eye, for whoever may see increases (owner, 2026-11-20).
  const increases = useIncreaseView();
  const added =
    increases.may &&
    (doc.lines.some((l) => (l.increase ?? 0) > 0) ||
      doc.charges.some((c) => c.kind === 'INCREASE'));
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
        {canAdjust && (!locked || owner) && (
          <Button
            size="sm"
            variant={boxes ? 'primary' : 'secondary'}
            onClick={() => setBoxes((b) => (b ? null : boxesOf(doc)))}
          >
            {t('together.editDiscounts')}
          </Button>
        )}
        {added && <IncreasesToggle on={increases.shown} onChange={increases.setShown} />}
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
        {onPrint && (
          <Button size="sm" variant="secondary" icon="print" className="ms-auto" onClick={onPrint}>
            {t('common.print')}
          </Button>
        )}
      </div>
      {added && increases.shown && (
        <div className="px-3 pb-3">
          <IncreaseDetails doc={doc} />
        </div>
      )}
      {boxes && rights && onAdjust && (
        <AdjustCard
          showIncreases={increases.shown}
          doc={doc}
          boxes={boxes}
          onChange={setBoxes}
          rights={rights}
          busy={busy}
          bad={bad}
          onCancel={() => setBoxes(null)}
          onSave={() => void onAdjust(boxes).then((saved) => saved && setBoxes(null))}
        />
      )}
      {/* The invoice as it prints; its items show when opened. */}
      <div className={open ? 'border-t border-line' : 'hidden'}>
        <InvoicePaper ref={paperRef} doc={doc} options={options} />
      </div>
    </Card>
  );
}

/** The discounts of one invoice being changed: the boxes, the new total, save or leave. */
function AdjustCard({
  showIncreases,
  doc,
  boxes,
  onChange,
  rights,
  busy,
  bad,
  onCancel,
  onSave,
}: {
  showIncreases: boolean;
  doc: SalesDocument;
  boxes: AdjustBoxes;
  onChange: (b: AdjustBoxes) => void;
  rights: AdjustRights;
  busy: boolean;
  bad: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t, locale } = useT();
  const money = (v: number) => formatMoney(v, doc.currency, locale);
  const preview = adjustPreview(doc, boxes);
  const changed = boxesChanged(doc, boxes);
  return (
    <div className="space-y-3 border-t border-line p-3">
      <AdjustEditor
        doc={doc}
        value={boxes}
        onChange={onChange}
        rights={rights}
        showIncreases={showIncreases}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          <span className="text-muted">{t('order.newTotal')}: </span>
          <span className="font-semibold tnum">{money(preview.total)}</span>
          {preview.total !== doc.grandTotal && (
            <span className="ms-2 text-xs text-faint line-through tnum">
              {money(doc.grandTotal)}
            </span>
          )}
        </span>
        <span className="ms-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            icon="check"
            loading={busy}
            disabled={!changed || bad || preview.tooBig}
            onClick={onSave}
          >
            {t('common.save')}
          </Button>
        </span>
      </div>
      {bad && <p className="text-xs text-destructive">{t('error.bad_percent')}</p>}
      {preview.tooBig && <p className="text-xs text-destructive">{t('charge.tooBig')}</p>}
    </div>
  );
}

function DiscountInputs({
  value,
  onChange,
  currency,
  modes = ['percent', 'amount', 'piece'],
}: {
  value: DiscountDraft;
  onChange: (v: DiscountDraft) => void;
  currency: string;
  /** The ways it may be typed. */
  modes?: DiscountDraft['mode'][];
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
        className={`${field} min-w-24 px-1.5`}
        aria-label={t('col.discount')}
        value={value.mode}
        onChange={(e) => onChange({ ...value, mode: e.target.value as DiscountDraft['mode'] })}
      >
        {modes.includes('percent') && <option value="percent">%</option>}
        {modes.includes('amount') && <option value="amount">{currency}</option>}
        {modes.includes('piece') && (
          <option value="piece">
            {currency} {t('invoice.perPiece')}
          </option>
        )}
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
  invoices: rawInvoices,
  returns: rawReturns = [],
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
  // An increase never shows to the customer (owner, 2026-11-20): it is in the prices.
  const invoices = rawInvoices.map(foldIncreases);
  const returns = rawReturns.map(foldIncreases);
  const total = invoices.reduce((s, d) => s + d.grandTotal, 0);
  const back = returns.reduce((s, d) => s + d.grandTotal, 0);
  const discounts = invoices.reduce((s, d) => s + d.discountTotal, 0);
  const postedTotal = invoices
    .filter((d) => d.type === 'SALES_INVOICE')
    .reduce((s, d) => s + d.grandTotal, 0);
  const paid = previousBalance + postedTotal - back - balance;
  const quantity = invoices.reduce(
    (n, d) => n + d.lines.reduce((q, l) => q + (l.unitQuantity || l.quantity), 0),
    0,
  );
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
                {shows('itemCode') && (
                  <th className="w-px whitespace-nowrap px-2 py-1 text-start font-medium">
                    {t('invoice.codeColumn')}
                  </th>
                )}
                <th className="px-2 py-1 text-start font-medium">{t('invoice.itemName')}</th>
                <th className="px-2 py-1 text-end font-medium">{t('sales.unitPrice')}</th>
                <th className="px-2 py-1 text-end font-medium">{t('sales.qty')}</th>
                {anyLineDiscount && (
                  <th className="px-2 py-1 text-end font-medium">{t('col.discount')}</th>
                )}
                <th className="px-2 py-1 text-end font-medium">{t('common.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {doc.lines.map((l) => (
                <tr key={l.id}>
                  {shows('itemCode') && (
                    <td className="whitespace-nowrap px-2 py-1 tnum">
                      <bdi>{l.productCode}</bdi>
                    </td>
                  )}
                  <td className="px-2 py-1">
                    <ItemLink id={l.productId} name={l.productName} />
                  </td>
                  <td className="px-2 py-1 text-end tnum">{money(l.unitPrice)}</td>
                  <td className="px-2 py-1 text-end tnum">
                    {formatNumber(l.unitQuantity || l.quantity, locale)} {l.unitName}
                  </td>
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
      {/* Every charge of the invoice — its discounts and also its tax and additions — so its lines
          add up to its total on paper. */}
      {doc.charges
        .filter((c) => c.amount !== 0)
        .map((c, i) => {
          const off = c.kind === 'DISCOUNT';
          return (
            <div key={i} className="flex justify-between border-t border-line px-2.5 py-1 text-xs">
              <span className="text-muted">
                {c.label ?? t(`charge.${c.kind}`)}
                {c.rate != null && ` (${formatNumber(c.rate, locale)}%)`}
              </span>
              <span className="tnum">
                {off ? '−' : ''}
                {money(c.amount)}
              </span>
            </div>
          );
        })}
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
      {/* What was owed before first (owner, 2026-11-10), then the period, what was paid and now. */}
      {shows('totals') && (
        <dl className="mt-3 space-y-1 border-t-2 border-fg/70 pt-2">
          {shows('previous') && (
            <Line label={t('together.previous')} value={money(previousBalance)} />
          )}
          <Line label={t('together.total')} value={money(total)} strong />
          {discounts > 0 && <Line label={t('together.discountsGiven')} value={money(discounts)} />}
          {back > 0 && <Line label={t('together.returnsTotal')} value={money(-back)} />}
          {back > 0 && <Line label={t('together.net')} value={money(total - back)} strong />}
          {paid !== 0 && <Line label={t('sales.paid')} value={money(paid)} />}
          <div className="border-t border-line pt-1">
            <Line label={t('together.balance')} value={money(balance)} strong />
          </div>
          {shows('quantity') && (
            <Line label={t('invoice.totalQuantity')} value={formatNumber(quantity, locale)} />
          )}
        </dl>
      )}
      {shows('words') && balance > 0 && (
        <p className="mt-3 rounded-[var(--radius-app)] border border-line px-3 py-2 text-xs font-medium">
          {t('together.balance')}: {amountInWords(balance, currency, locale)}
        </p>
      )}
    </div>
  );
}
