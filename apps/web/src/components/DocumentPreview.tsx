import { CompanyMark } from './CompanyBadge';
import { ItemLink } from './ItemLink';
import { DocumentActivity } from './DocumentActivity';
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  amountInWords,
  formatDateHM,
  formatMoney,
  formatNumber,
  type Permission,
  type SalesDocument,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Spinner } from './ui';
import { Icon } from './Icon';
import { useNavigate } from 'react-router-dom';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { statusOf } from '../lib/status';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { safeName } from '../lib/print';
import { PrintEditor } from './PrintEditor';
import { CodeName } from './CodeName';
import { PartyLink } from './PartyContact';
import { useReportTools } from '../lib/report';
import { TableColumns } from './TableColumns';
import { useHiddenColumns, usePrintPaper } from '../lib/queries';
import { StateBadge } from './StateBadge';
import { ExchangePrintSheet } from './ExchangePrint';

/** The parts of a printed document a person may leave out (owner, 2026-10-01). */
export const PRINT_PARTS = [
  'company',
  'party',
  'meta',
  'states',
  'lines',
  'totals',
  'notes',
  'staff',
  // Each on its own (owner, 2026-11-10): the rep, the department, the delivery; the item code
  // column; and under the items the previous balance, the total quantity and the amount in words.
  'rep',
  'department',
  'delivery',
  'itemCode',
  'previous',
  'quantity',
  'words',
] as const;
/** What a printout leaves out unless turned on (owner, 2026-10-02: the codes don't show). */
const PRINT_EXTRAS = ['partyCode', 'repCode'] as const;
type PrintPart = (typeof PRINT_PARTS)[number] | (typeof PRINT_EXTRAS)[number];
/** The print options in the order and groups they are offered (owner, 2026-11-10). */
const PRINT_GROUPS: { title: TranslationKey; parts: PrintPart[] }[] = [
  { title: 'print.group.header', parts: ['company', 'states'] },
  { title: 'print.group.party', parts: ['party', 'partyCode', 'delivery'] },
  {
    title: 'print.group.document',
    parts: ['department', 'rep', 'repCode', 'meta', 'notes', 'staff'],
  },
  { title: 'print.group.lines', parts: ['lines', 'itemCode'] },
  { title: 'print.group.totals', parts: ['totals', 'previous', 'quantity', 'words'] },
];
/** Type sizes of a printout, as a scale of the normal one. */
export const PAPER_SIZES = { S: 0.9, M: 1, L: 1.15, XL: 1.3 } as const;
export type PaperTextSize = keyof typeof PAPER_SIZES;

/** How a person prints documents: what shows, the type size and bold, kept per person. */
export interface PaperOptions {
  shows: (part: PrintPart) => boolean;
  size: PaperTextSize;
  bold: boolean;
}

/**
 * Print options (owner, 2026-10-02): every part on or off, the codes off unless turned on, the
 * type size and bold. What is chosen shows at once on the document on screen, which is exactly
 * what prints. Kept per person on the server.
 */
export function usePaperOptions(): [
  PaperOptions,
  {
    toggle: (part: PrintPart) => void;
    setSize: (size: PaperTextSize) => void;
    setBold: (bold: boolean) => void;
  },
] {
  const [skipped, setSkipped] = useHiddenColumns('print.document');
  const [extras, setExtras] = useHiddenColumns('print.document.on');
  const [style, setStyle] = useHiddenColumns('print.style');
  const size =
    (Object.keys(PAPER_SIZES) as PaperTextSize[]).find((s) => style.includes(`size:${s}`)) ?? 'M';
  const bold = style.includes('bold');
  const isExtra = (p: PrintPart) => (PRINT_EXTRAS as readonly string[]).includes(p);
  const shows = (p: PrintPart) => (isExtra(p) ? extras.includes(p) : !skipped.includes(p));
  const saveStyle = (s: PaperTextSize, b: boolean) =>
    setStyle([...(s !== 'M' ? [`size:${s}`] : []), ...(b ? ['bold'] : [])]);
  return [
    { shows, size, bold },
    {
      toggle: (p) => {
        if (isExtra(p))
          setExtras(extras.includes(p) ? extras.filter((x) => x !== p) : [...extras, p]);
        else setSkipped(skipped.includes(p) ? skipped.filter((x) => x !== p) : [...skipped, p]);
      },
      setSize: (s) => saveStyle(s, bold),
      setBold: (b) => saveStyle(size, b),
    },
  ];
}

/** How the purchase limit was settled on a document, in words (see SalesDocument.approvalNote). */
export function approvalText(note: string | null | undefined, t: ReturnType<typeof useT>['t']) {
  if (!note) return null;
  if (note.startsWith('AUTO:')) return `${t('approval.auto')} ${note.slice(5)}`;
  if (note.startsWith('BY:')) return `${t('approval.by')} ${note.slice(3)}`;
  if (note === 'WITHIN_LIMIT') return t('approval.within');
  return null;
}

/**
 * Printable-style document preview: company, branch, party, lines, totals, staff, status.
 * Works for invoices and returns on both the sales and purchase side. Prints (or saves as PDF)
 * with the company's details from Settings.
 */
export function DocumentPreview({
  doc,
  loading,
  onClose,
  action,
  autoPrint,
  onPrinted,
}: {
  doc?: SalesDocument;
  loading?: boolean;
  onClose?: () => void;
  /** Extra control in the header, e.g. "Return items" on an invoice. */
  action?: ReactNode;
  /** Print it as soon as it shows (after "Save and print"); then `onPrinted`. */
  autoPrint?: boolean;
  onPrinted?: () => void;
}) {
  const { t } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const paper = useRef<HTMLDivElement>(null);
  const [options] = usePaperOptions();
  const ready = !loading && !!doc;
  const canPrint = !!doc && mayPrint(can, doc, 'print');
  const canPdf = !!doc && mayPrint(can, doc, 'pdf');
  // Printing opens the setup first (the paper and what shows), then prints (or saves the PDF) from there.
  const [setup, setSetup] = useState<'print' | 'pdf' | null>(null);
  const [exchangePrint, setExchangePrint] = useState(false);
  useEffect(() => {
    if (autoPrint && ready && canPrint) setSetup('print');
  }, [autoPrint, ready, canPrint]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center py-16 text-muted">
        <Spinner size={26} />
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="grid h-full place-items-center py-16 text-center text-muted">
        <div>
          <Icon name="receipts" size={28} className="mx-auto mb-2 text-faint" />
          <p className="text-sm">{t('sales.preview')}</p>
        </div>
      </div>
    );
  }

  const isReturn = doc.type === 'SALES_RETURN' || doc.type === 'PURCHASE_RETURN';
  const status = statusOf(doc);

  return (
    <div className="flex h-full flex-col">
      <div data-noprint className="space-y-2 border-b border-line p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {/* A return says what it is once, in its title (owner, 2026-10-02). */}
            {!isReturn && !doc.type.startsWith('PURCHASE') && (
              <Badge tone={status.tone}>{t(status.key as TranslationKey)}</Badge>
            )}
            {doc.hasImage &&
              Array.from({ length: Math.max(1, doc.imagePages ?? 1) }, (_, page) => (
                <InvoicePhotoButton
                  key={page}
                  id={doc.id}
                  page={page}
                  pages={Math.max(1, doc.imagePages ?? 1)}
                />
              ))}
            {doc.edited && doc.status !== 'CANCELLED' && (
              <Badge tone="info">{t('state.EDITED')}</Badge>
            )}
            {doc.overLimit && doc.type === 'SALES_INVOICE' && doc.status !== 'CANCELLED' && (
              <Badge tone="warning">{t('state.AWAITING')}</Badge>
            )}
            <span className="truncate text-sm font-semibold tnum">{doc.number}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* The invoice on its own screen, every line, read-only until edited (owner, 2026-10-19). */}
            {doc.type === 'SALES_INVOICE' && (
              <Button
                size="sm"
                variant="ghost"
                icon="eye"
                aria-label={t('invoice.open')}
                title={t('invoice.open')}
                onClick={() => navigate(`/sales/invoices/${doc.id}`)}
              />
            )}
            {doc.type === 'PURCHASE_INVOICE' && (can('labels:print') || can('labels:pdf')) && (
              <Button
                size="sm"
                variant="ghost"
                icon="scan"
                aria-label={t('labels.fromInvoice')}
                title={t('labels.fromInvoice')}
                onClick={() => navigate(`/inventory/labels?doc=${doc.id}`)}
              />
            )}
            {canPrint && (
              <Button
                size="sm"
                variant="ghost"
                icon="print"
                aria-label={t('common.print')}
                title={t('common.print')}
                onClick={() => setSetup('print')}
              />
            )}
            {canPrint && doc.exchangeId && doc.status !== 'CANCELLED' && (
              <Button
                size="sm"
                variant="ghost"
                icon="returns"
                aria-label={t('exchange.print')}
                title={t('exchange.print')}
                onClick={() => setExchangePrint(true)}
              />
            )}
            {canPdf && (
              <Button
                size="sm"
                variant="ghost"
                icon="download"
                aria-label={t('common.pdfHint')}
                title={t('common.pdfHint')}
                onClick={() => setSetup('pdf')}
              >
                {t('common.pdf')}
              </Button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2"
                aria-label={t('common.close')}
              >
                <Icon name="close" size={18} />
              </button>
            )}
          </div>
        </div>
        {/* What can be done with it, on its own row so nothing is squeezed. */}
        {action && <div className="flex flex-wrap items-center gap-1.5">{action}</div>}
      </div>
      <div className="flex-1 overflow-y-auto">
        <InvoicePaper ref={paper} doc={doc} options={options} />
        <div className="px-4 pb-4 sm:px-5">
          <DocumentActivity id={doc.id} />
        </div>
      </div>
      {exchangePrint && <ExchangePrintSheet doc={doc} onClose={() => setExchangePrint(false)} />}
      {setup && (
        <PrintSetupSheet
          doc={doc}
          record
          pdf={setup === 'pdf'}
          onClose={() => {
            setSetup(null);
            if (autoPrint) onPrinted?.();
          }}
        />
      )}
    </div>
  );
}

/**
 * One document as it prints, with the person's print options (what shows, type size, bold).
 * Shown on screen exactly as it prints.
 */
export function InvoicePaper({
  doc,
  options,
  ref,
}: {
  doc: SalesDocument;
  options: PaperOptions;
  ref?: Ref<HTMLDivElement>;
}) {
  const { t, locale } = useT();
  const { company, details } = useReportTools();
  const shows = options.shows;
  const isReturn = doc.type === 'SALES_RETURN' || doc.type === 'PURCHASE_RETURN';
  const isQuote = doc.type === 'QUOTATION';
  const isPurchaseSide = doc.type === 'PURCHASE_INVOICE' || doc.type === 'PURCHASE_RETURN';
  // An invoice's account is settled oldest first (owner, 2026-10-02): what is left on it is the
  // server's figure when it sends one; paid is the rest.
  const outstanding =
    doc.owed != null && !doc.type.endsWith('RETURN') ? doc.owed : doc.grandTotal - doc.paidAmount;
  const paidSoFar =
    doc.owed != null && !doc.type.endsWith('RETURN') ? doc.grandTotal - doc.owed : doc.paidAmount;
  const lineDiscounts = doc.lines.reduce((sum, l) => sum + l.discount, 0);
  // The discount column only when a line has one (owner, 2026-10-02).
  const anyLineDiscount = doc.lines.some((l) => l.discount > 0);
  // …and the increase column only when a line has one (owner, 2026-11-19). A line shows without its
  // share of the invoice's increase, which shows in the totals.
  const anyLineIncrease = doc.lines.some((l) => (l.increase ?? 0) > 0);
  const docIncreases = doc.lines.reduce((sum, l) => sum + (l.docIncrease ?? 0), 0);
  const approval = approvalText(doc.approvalNote, t);
  const money = (v: number) => formatMoney(v, doc.currency, locale);
  const delivery =
    shows('delivery') && !!doc.deliveryMethod && doc.deliveryMethod !== 'PICKUP' && !isPurchaseSide;
  const withCode = shows('itemCode') && doc.lines.some((l) => l.productCode);
  // What the customer owed before it: the server sends it only to whoever may see their balance.
  const previous = shows('previous') ? (doc.previousBalance ?? null) : null;
  const totalQuantity = doc.lines.reduce((n, l) => n + (l.unitQuantity || l.quantity), 0);

  return (
    <div
      ref={ref}
      className="p-4 sm:p-5"
      style={options.size !== 'M' ? { zoom: PAPER_SIZES[options.size] } : undefined}
      {...(options.bold ? { 'data-paper-bold': '' } : {})}
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        {shows('company') && (
          <>
            <CompanyMark size={48} logoOnly />
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold">{company}</p>
              {details.map((d) => (
                <p key={d} className="break-words text-xs text-muted">
                  <bdi>{d}</bdi>
                </p>
              ))}
              <p className="text-xs text-muted">{doc.branchName}</p>
            </div>
          </>
        )}
        <div className="ms-auto shrink-0 text-end text-xs text-muted">
          <p className="text-sm font-semibold text-fg">{t(`doc.${doc.type}`)}</p>
          <p className="tnum font-medium text-fg">{doc.number}</p>
          {/* The day and the hour and minute it was made (owner, 2026-10-02). */}
          <p className="tnum">{formatDateHM(doc.issueDate, locale)}</p>
          {doc.enteredAt && (
            <p className="text-warning">
              {t('doc.enteredAt')}{' '}
              <span className="tnum">{formatDateHM(doc.enteredAt, locale)}</span>
            </p>
          )}
          {isQuote && doc.invoiceNumber && (
            <p>
              {t('quote.becameInvoice')}:{' '}
              <span className="font-medium text-fg tnum">{doc.invoiceNumber}</span>
            </p>
          )}
          {doc.type === 'SALES_INVOICE' && doc.sourceNumber && (
            <p>
              {t('quote.from')}:{' '}
              <span className="font-medium text-fg tnum">{doc.sourceNumber}</span>
            </p>
          )}
          {doc.exchangeNumber && (
            <p className="tnum">
              {t('exchange.with')}:{' '}
              <span className="font-medium text-fg">{doc.exchangeNumber}</span>
            </p>
          )}
          {isReturn && doc.sourceNumber && (
            <p className="tnum">
              {t('return.against')}: <span className="font-medium text-fg">{doc.sourceNumber}</span>
            </p>
          )}
          {shows('department') && doc.departmentName && (
            <p>
              {t('invoice.department')}:{' '}
              <span className="font-medium text-fg">{doc.departmentName}</span>
            </p>
          )}
          {shows('rep') && doc.repName && (
            <p>
              {t('invoice.rep')}:{' '}
              <span className="font-medium text-fg">
                <CodeName code={shows('repCode') ? doc.repCode : null} name={doc.repName} />
              </span>
            </p>
          )}
          {shows('meta') && (
            <div>
              {doc.status === 'CANCELLED' && doc.cancelReason && (
                <p className="text-destructive">
                  {t('invoice.cancelledReason')}:{' '}
                  <span className="font-medium">{doc.cancelReason}</span>
                </p>
              )}
              {doc.rejectReason && doc.status !== 'CANCELLED' && (
                <p className="text-destructive">
                  {t('order.rejectedBecause')}{' '}
                  <span className="font-medium">{doc.rejectReason}</span>
                </p>
              )}
              {doc.paidAccountName && doc.paidAmount > 0 && (
                <p>
                  {t('money.paidInto')}:{' '}
                  <span className="font-medium text-fg">{doc.paidAccountName}</span>
                </p>
              )}
              {/* Sales invoices don't show a price level (owner decision 2026-09-30). */}
              {isPurchaseSide && doc.priceLevelName && (
                <p>
                  {t('invoice.priceLevel')}:{' '}
                  <span className="font-medium text-fg">{doc.priceLevelName}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Where it stands: paid or not, changed, waiting for the accountant — all of them. */}
      {shows('states') && (doc.type === 'SALES_INVOICE' || doc.type === 'SALES_ORDER') && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          <StateBadge doc={doc} />
          {doc.edited && doc.status !== 'CANCELLED' && (
            <Badge tone="info">{t('state.EDITED')}</Badge>
          )}
          {doc.overLimit && doc.status !== 'CANCELLED' && (
            <Badge tone="warning">{t('approval.waiting')}</Badge>
          )}
          {approval && <span className="text-muted">{approval}</span>}
        </div>
      )}

      {/* The customer, and beside it how the goods reach them: each can be left out. */}
      {(shows('party') || delivery) && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {shows('party') && (
            <div className="min-w-0 flex-1 basis-48 rounded-[var(--radius-app)] bg-surface-2 p-3">
              <p className="text-xs text-muted">
                {isPurchaseSide ? t('invoice.supplier') : t('sales.customer')}
              </p>
              <p className="font-medium">
                <PartyLink
                  id={doc.partyId}
                  code={shows('partyCode') ? doc.partyCode : null}
                  name={doc.partyName}
                />
              </p>
            </div>
          )}
          {delivery && (
            <div className="min-w-0 flex-1 basis-48 rounded-[var(--radius-app)] border border-line p-3 text-xs text-muted">
              <p>
                {t('delivery.method')}:{' '}
                <span className="font-medium text-fg">{t(`delivery.${doc.deliveryMethod!}`)}</span>
                {doc.deliveryStatus && <> · {t(`delivery.status.${doc.deliveryStatus}`)}</>}
              </p>
              {(doc.carrierName || doc.driverName) && (
                <p>
                  {doc.carrierName ? t('delivery.carrier') : t('delivery.driver')}:{' '}
                  <span className="font-medium text-fg">{doc.carrierName ?? doc.driverName}</span>
                </p>
              )}
              {doc.deliveryAddress && (
                <p className="break-words">
                  {t('delivery.address')}: <span className="text-fg">{doc.deliveryAddress}</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Line items (owner, 2026-11-10): code, name, price of one, quantity, its discount (only
          when a line has one) and the total. */}
      {shows('lines') && (
        <div className="overflow-x-auto rounded-[var(--radius-app)] border border-line">
          <TableColumns id="invoice.lines">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  {withCode && (
                    <th className="w-px whitespace-nowrap p-2 text-start font-medium">
                      {t('invoice.codeColumn')}
                    </th>
                  )}
                  <th className="p-2 text-start font-medium">{t('invoice.itemName')}</th>
                  <th className="p-2 text-end font-medium">{t('sales.unitPrice')}</th>
                  <th className="p-2 text-end font-medium">{t('sales.qty')}</th>
                  {anyLineIncrease && (
                    <th className="p-2 text-end font-medium">{t('col.increase')}</th>
                  )}
                  {anyLineDiscount && (
                    <th className="p-2 text-end font-medium">{t('col.discount')}</th>
                  )}
                  <th className="p-2 text-end font-medium">{t('common.total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {doc.lines.map((l) => (
                  <tr key={l.id}>
                    {withCode && (
                      <td className="whitespace-nowrap p-2 text-xs tnum">
                        <bdi>{l.productCode}</bdi>
                      </td>
                    )}
                    <td className="p-2">
                      <ItemLink id={l.productId} name={l.productName} />
                      {l.warehouseName && (
                        <span className="block text-xs text-muted" data-noprint>
                          {l.warehouseName}
                        </span>
                      )}
                      {l.reason && (
                        <span className="block text-xs text-muted">
                          {t(`return.reason.${l.reason}` as TranslationKey)}
                          {l.reasonNote ? `: ${l.reasonNote}` : ''}
                          {l.damaged ? ` · ${t(`return.damaged.${l.damaged}`)}` : ''}
                        </span>
                      )}
                      {l.returnedQuantity > 0 && (
                        <span className="block text-xs text-warning tnum" data-noprint>
                          {t('return.alreadyReturned')}: {formatNumber(l.returnedQuantity, locale)}{' '}
                          {l.baseUnitName}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-end tnum">{money(l.unitPrice)}</td>
                    <td className="p-2 text-end tnum">
                      {formatNumber(l.unitQuantity || l.quantity, locale)}{' '}
                      <span className="text-xs text-muted">{l.unitName}</span>
                      {l.unitFactor > 1 && (
                        <span className="block text-xs text-muted">
                          = {formatNumber(l.quantity, locale)} {l.baseUnitName}
                        </span>
                      )}
                    </td>
                    {anyLineIncrease && (
                      <td className="p-2 text-end tnum">
                        {(l.increase ?? 0) > 0 ? money(l.increase!) : ''}
                      </td>
                    )}
                    {anyLineDiscount && (
                      <td className="p-2 text-end tnum">
                        {l.discount > 0 ? money(l.discount) : ''}
                      </td>
                    )}
                    <td className="p-2 text-end font-medium tnum">
                      {l.isBonus ? (
                        <span className="text-xs font-medium text-positive">
                          {t('invoice.bonus')}
                        </span>
                      ) : (
                        money(l.lineTotal - (l.docIncrease ?? 0))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableColumns>
        </div>
      )}

      {/* Under the items (owner, 2026-11-10): what was owed before, then how many pieces. */}
      {(previous != null || shows('quantity')) && (
        <dl className="mt-4 space-y-1.5 text-sm">
          {previous != null && <Row label={t('invoice.previousBalance')} value={money(previous)} />}
          {shows('quantity') && (
            <Row label={t('invoice.totalQuantity')} value={formatNumber(totalQuantity, locale)} />
          )}
        </dl>
      )}
      {shows('totals') && (
        <dl className="mt-2 space-y-1.5 text-sm">
          <Row label={t('sales.subtotal')} value={money(doc.subtotal - docIncreases)} />
          {lineDiscounts > 0 && <Row label={t('sales.discount')} value={money(-lineDiscounts)} />}
          {/* The invoice's own discounts and additions, in the order they applied; tax only when
              there is some (owner, 2026-10-02). */}
          {doc.charges
            .filter((c) => c.amount !== 0 && c.kind !== 'TAX')
            .map((c, i) => (
              <Row
                key={i}
                label={`${c.label ?? t(`charge.${c.kind}`)}${c.rate != null ? ` (${formatNumber(c.rate, locale)}%)` : ''}${
                  // An amount a piece: "(20.00 × 48 pieces)".
                  c.perPiece
                    ? ` (${t('charge.perPieceOf')
                        .replace('{amount}', money(c.perPiece))
                        .replace(
                          '{pieces}',
                          formatNumber(Math.round(c.amount / c.perPiece), locale),
                        )})`
                    : ''
                }`}
                value={money(
                  c.kind === 'DISCOUNT' || c.kind === 'EXTRA_DISCOUNT' ? -c.amount : c.amount,
                )}
              />
            ))}
          {doc.charges.length === 0 && doc.discountTotal - lineDiscounts > 0 && (
            <Row label={t('sales.discount')} value={money(-(doc.discountTotal - lineDiscounts))} />
          )}
          {doc.taxTotal > 0 && <Row label={t('sales.tax')} value={money(doc.taxTotal)} />}
          <div className="flex items-center justify-between border-t border-line pt-2 text-base font-semibold">
            <dt>{t('sales.grandTotal')}</dt>
            <dd className="tnum">{money(doc.grandTotal)}</dd>
          </div>
          {!isQuote && doc.type !== 'SALES_ORDER' && (
            <>
              <Row
                label={isReturn ? t('return.refunded') : t('sales.paid')}
                value={money(paidSoFar)}
              />
              <Row
                label={isReturn ? t('return.onAccount') : t('sales.outstanding')}
                value={money(outstanding)}
                emphasize={!isReturn && outstanding > 0}
              />
            </>
          )}
        </dl>
      )}
      {/* The total in words, in the language it prints in. */}
      {shows('words') && doc.grandTotal > 0 && (
        <p className="mt-3 rounded-[var(--radius-app)] border border-line px-3 py-2 text-sm font-medium">
          {amountInWords(doc.grandTotal, doc.currency, locale)}
        </p>
      )}
      {shows('notes') && doc.notes && (
        <p className="mt-4 whitespace-pre-wrap rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm">
          <span className="block text-xs text-muted">{t('invoice.notes')}</span>
          {doc.notes}
        </p>
      )}

      {/* Staff footer */}
      {shows('staff') && (
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-xs text-muted">
          <Icon name="staff" size={14} />
          <span>{t('sales.issuedBy')}:</span>
          <span className="font-medium text-fg">{doc.staffName}</span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`tnum ${emphasize ? 'font-semibold text-destructive' : ''}`}>{value}</dd>
    </div>
  );
}

/** A4 or A5, for every printout (owner, 2026-10-01). */
function PaperChoice() {
  const { t } = useT();
  const [size, setSize] = usePrintPaper();
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
      <span>{t('print.paper')}</span>
      <div className="flex overflow-hidden rounded-md border border-line">
        {(['A4', 'A5'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSize(s)}
            aria-pressed={size === s}
            className={`px-2.5 py-1 text-xs font-semibold ${size === s ? 'bg-brand text-brand-fg' : 'hover:bg-surface-2'}`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the printout carries: the paper, type size, bold and each part (shared by the menu and the setup). */
function PrintOptionsPanel({
  options,
  onChange,
  withPaper = true,
}: {
  options: PaperOptions;
  onChange: ReturnType<typeof usePaperOptions>[1];
  /** The paper size here too (the print editor has its own). */
  withPaper?: boolean;
}) {
  const { t } = useT();
  return (
    <>
      {withPaper && <PaperChoice />}
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
        <span>{t('print.textSize')}</span>
        <div className="flex overflow-hidden rounded-md border border-line">
          {(Object.keys(PAPER_SIZES) as PaperTextSize[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange.setSize(s)}
              aria-pressed={options.size === s}
              className={`px-2 py-1 text-xs font-semibold ${options.size === s ? 'bg-brand text-brand-fg' : 'hover:bg-surface-2'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
        <input
          type="checkbox"
          checked={options.bold}
          onChange={(e) => onChange.setBold(e.target.checked)}
        />
        <span className="font-bold">{t('print.bold')}</span>
      </label>
      {PRINT_GROUPS.map((g) => (
        <fieldset key={g.title} className="mt-1 border-t border-line pt-1">
          <legend className="px-2 text-xs font-semibold text-muted">{t(g.title)}</legend>
          <div className="grid grid-cols-2 gap-x-1 lg:grid-cols-1">
            {g.parts.map((part) => (
              <label
                key={part}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={options.shows(part)}
                  onChange={() => onChange.toggle(part)}
                />
                {t(`print.${part}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </>
  );
}

/**
 * Before printing (owner, 2026-10-02: "when I press print, show the invoice's layout and the
 * paper", then "let me take things off and change them, then print"): the document's own options
 * beside the print editor, which follows them until the copy is changed by hand.
 */
export function PrintSetupSheet({
  doc,
  onClose,
  onPrinted,
  record,
  pdf = false,
}: {
  doc: SalesDocument;
  onClose: () => void;
  onPrinted?: () => void;
  /** Printing it is its own permission: the server is asked (and notes it) first. */
  record?: boolean;
  /** Save it as PDF (its own permission) rather than print it. */
  pdf?: boolean;
}) {
  const { t } = useT();
  const can = useCan();
  const [options, setOptions] = usePaperOptions();
  const [paper, setPaper] = useState<HTMLDivElement | null>(null);
  const [refused, setRefused] = useState<unknown>(null);
  const beforePrint = async () => {
    const path = printPath(doc);
    if (!record || !path) return true;
    try {
      await api.post(pdf ? `${path}?kind=pdf` : path, {});
      return true;
    } catch (e) {
      setRefused(e);
      return false;
    }
  };
  return (
    <>
      {/* The document as the options make it; the editor copies it. */}
      <div className="hidden">
        <InvoicePaper ref={setPaper} doc={doc} options={options} />
      </div>
      <PrintEditor
        source={paper}
        live
        zoomable={false}
        fileTitle={safeName(`${t(`doc.${doc.type}`)} ${doc.number}`)}
        onClose={onClose}
        onPrinted={onPrinted}
        beforePrint={beforePrint}
        pdf={pdf}
        side={
          <>
            {refused != null && (
              <p className="mb-2 text-sm text-destructive">{errorText(t, refused)}</p>
            )}
            {/* The options are a permission of their own (owner, 2026-11-12). */}
            {can('print:settings') && (
              <PrintOptionsPanel options={options} onChange={setOptions} withPaper={false} />
            )}
          </>
        }
      />
    </>
  );
}

/** Where a document's print is asked for, by its kind (none for a quotation). */
function printPath(doc: SalesDocument): string | null {
  switch (doc.type) {
    case 'SALES_INVOICE':
      return `/sales/invoices/${doc.id}/print`;
    case 'SALES_RETURN':
      return `/sales/returns/${doc.id}/print`;
    case 'SALES_ORDER':
      return `/sales/orders/${doc.id}/print`;
    case 'PURCHASE_INVOICE':
      return `/purchases/invoices/${doc.id}/print`;
    case 'PURCHASE_RETURN':
      return `/purchases/returns/${doc.id}/print`;
    default:
      return null;
  }
}

/** Whether this person may print (or save as PDF) this kind of document. */
export function mayPrint(
  can: (p: Permission) => boolean,
  doc: SalesDocument,
  kind: 'print' | 'pdf' = 'print',
): boolean {
  return can(`${doc.type.startsWith('PURCHASE') ? 'purchases' : 'sales'}:${kind}`);
}

/**
 * Opens a page of the photos of the supplier's own invoice kept with a purchase invoice (owner,
 * 2026-10-17; several pages 2026-10-19).
 */
function InvoicePhotoButton({ id, page, pages }: { id: string; page: number; pages: number }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-brand hover:underline"
      onClick={async () => {
        setBusy(true);
        try {
          const file = await api.download(`/purchases/invoices/${id}/image?page=${page}`);
          const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.type }));
          window.open(url, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="camera" size={12} />
      {t('additems.invoicePhoto')}
      {pages > 1 ? ` ${page + 1}` : ''}
    </button>
  );
}
