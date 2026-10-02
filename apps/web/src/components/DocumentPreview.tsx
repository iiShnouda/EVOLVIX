import { CompanyMark } from './CompanyBadge';
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  formatDate,
  formatDateHM,
  formatMoney,
  formatNumber,
  type SalesDocument,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Spinner } from './ui';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { statusOf } from '../lib/status';
import { printElement, safeName } from '../lib/print';
import { useReportTools } from '../lib/report';
import { TableColumns } from './TableColumns';
import { useHiddenColumns, usePrintPaper } from '../lib/queries';

/** The parts of a printed document a person may leave out (owner, 2026-10-01). */
const PRINT_PARTS = [
  'company',
  'party',
  'meta',
  'states',
  'lines',
  'totals',
  'notes',
  'staff',
] as const;
/** What a printout leaves out unless turned on (owner, 2026-10-02: the codes don't show). */
const PRINT_EXTRAS = ['partyCode', 'repCode'] as const;
type PrintPart = (typeof PRINT_PARTS)[number] | (typeof PRINT_EXTRAS)[number];
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
  const paper = useRef<HTMLDivElement>(null);
  const [options, setOptions] = usePaperOptions();
  const ready = !loading && !!doc;
  useEffect(() => {
    if (!autoPrint || !ready || !paper.current || !doc) return;
    printElement(paper.current, safeName(`${t(`doc.${doc.type}`)} ${doc.number}`));
    onPrinted?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint, ready]);

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
            {!isReturn && <Badge tone={status.tone}>{t(status.key as TranslationKey)}</Badge>}
            {doc.edited && doc.status !== 'CANCELLED' && (
              <Badge tone="info">{t('state.EDITED')}</Badge>
            )}
            {doc.overLimit && doc.type === 'SALES_INVOICE' && doc.status !== 'CANCELLED' && (
              <Badge tone="warning">{t('state.AWAITING')}</Badge>
            )}
            <span className="truncate text-sm font-semibold tnum">{doc.number}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <PrintOptions options={options} onChange={setOptions} />
            <Button
              size="sm"
              variant="ghost"
              icon="print"
              aria-label={t('common.printPdf')}
              title={t('common.printPdf')}
              onClick={() =>
                paper.current &&
                printElement(paper.current, safeName(`${t(`doc.${doc.type}`)} ${doc.number}`))
              }
            />
            {onClose && (
              <button
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 lg:hidden"
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
      </div>
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
  const isInvoice = doc.type === 'SALES_INVOICE' || doc.type === 'PURCHASE_INVOICE';
  const isPurchaseSide = doc.type === 'PURCHASE_INVOICE' || doc.type === 'PURCHASE_RETURN';
  const outstanding = doc.grandTotal - doc.paidAmount;
  const lineDiscounts = doc.lines.reduce((sum, l) => sum + l.discount, 0);
  // The discount column only when a line has one (owner, 2026-10-02).
  const anyLineDiscount = doc.lines.some((l) => l.discount > 0);
  const status = statusOf(doc);
  const approval = approvalText(doc.approvalNote, t);
  const money = (v: number) => formatMoney(v, doc.currency, locale);

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
          {doc.type === 'SALES_INVOICE' && doc.dueDate && (
            <p>
              {t('invoice.dueDate')}:{' '}
              <span className="font-medium text-fg tnum">{formatDate(doc.dueDate, locale)}</span>
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
          {isReturn && doc.sourceNumber && (
            <p className="tnum">
              {t('return.against')}: <span className="font-medium text-fg">{doc.sourceNumber}</span>
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
              {doc.departmentName && (
                <p>
                  {t('invoice.department')}:{' '}
                  <span className="font-medium text-fg">{doc.departmentName}</span>
                </p>
              )}
              {doc.repName && (
                <p>
                  {t('invoice.rep')}: <span className="font-medium text-fg">{doc.repName}</span>
                  {shows('repCode') && doc.repCode != null && (
                    <span className="tnum"> ({doc.repCode})</span>
                  )}
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
      {shows('states') && (isInvoice || doc.type === 'SALES_ORDER') && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          <Badge tone={status.tone}>{t(status.key as TranslationKey)}</Badge>
          {doc.edited && doc.status !== 'CANCELLED' && (
            <Badge tone="info">{t('state.EDITED')}</Badge>
          )}
          {doc.overLimit && doc.status !== 'CANCELLED' && (
            <Badge tone="warning">{t('approval.waiting')}</Badge>
          )}
          {approval && <span className="text-muted">{approval}</span>}
        </div>
      )}

      {shows('party') && (
        <div className="mb-4 rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm">
          <p className="text-xs text-muted">
            {isPurchaseSide ? t('invoice.supplier') : t('sales.customer')}
          </p>
          <p className="font-medium">
            {doc.partyName}
            {shows('partyCode') && doc.partyCode != null && (
              <span className="ms-1.5 text-xs font-normal text-muted tnum">
                {t('common.code')} {doc.partyCode}
              </span>
            )}
          </p>
          {doc.deliveryMethod && doc.deliveryMethod !== 'PICKUP' && (
            <div className="mt-2 border-t border-line pt-2 text-xs text-muted">
              <p>
                {t('delivery.method')}:{' '}
                <span className="font-medium text-fg">{t(`delivery.${doc.deliveryMethod}`)}</span>
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

      {/* Line items: quantity, price of one, its discount (only if any) and the total. */}
      {shows('lines') && (
        <div className="overflow-hidden rounded-[var(--radius-app)] border border-line">
          <TableColumns id="document.lines">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="p-2 text-start font-medium">{t('inventory.products')}</th>
                  <th className="p-2 text-end font-medium">{t('sales.qty')}</th>
                  <th className="p-2 text-end font-medium">{t('sales.unitPrice')}</th>
                  {anyLineDiscount && (
                    <th className="p-2 text-end font-medium">{t('col.discount')}</th>
                  )}
                  <th className="p-2 text-end font-medium">{t('common.total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {doc.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="p-2">
                      {l.productName}
                      {l.warehouseName && (
                        <span className="block text-xs text-muted" data-noprint>
                          {l.warehouseName}
                        </span>
                      )}
                      {l.returnedQuantity > 0 && (
                        <span className="block text-xs text-warning tnum" data-noprint>
                          {t('return.alreadyReturned')}: {formatNumber(l.returnedQuantity, locale)}{' '}
                          {l.baseUnitName}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-end tnum">
                      {formatNumber(l.unitQuantity || l.quantity, locale)}{' '}
                      <span className="text-xs text-muted">{l.unitName}</span>
                      {l.unitFactor > 1 && (
                        <span className="block text-xs text-muted">
                          = {formatNumber(l.quantity, locale)} {l.baseUnitName}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-end tnum">{money(l.unitPrice)}</td>
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
                        money(l.lineTotal)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableColumns>
        </div>
      )}

      {shows('totals') && (
        <dl className="mt-4 space-y-1.5 text-sm">
          <Row label={t('sales.subtotal')} value={money(doc.subtotal)} />
          {lineDiscounts > 0 && <Row label={t('sales.discount')} value={money(-lineDiscounts)} />}
          {/* The invoice's own discounts and additions, in the order they applied; tax only when
              there is some (owner, 2026-10-02). */}
          {doc.charges
            .filter((c) => c.amount !== 0 && c.kind !== 'TAX')
            .map((c, i) => (
              <Row
                key={i}
                label={`${c.label ?? t(`charge.${c.kind}`)}${c.rate != null ? ` (${formatNumber(c.rate, locale)}%)` : ''}`}
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
                value={money(doc.paidAmount)}
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

/**
 * Choose what the printout carries, its type size and bold; the columns follow the table's own
 * column choice. Every change shows at once on the document behind it.
 */
export function PrintOptions({
  options,
  onChange,
}: {
  options: PaperOptions;
  onChange: ReturnType<typeof usePaperOptions>[1];
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={box} className="relative" data-noprint>
      <Button
        size="sm"
        variant="ghost"
        icon="settings"
        aria-label={t('print.options')}
        title={t('print.options')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="absolute end-0 z-30 mt-1 max-h-[70vh] w-60 overflow-y-auto rounded-[var(--radius-app)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          <p className="px-2 py-1 text-xs font-semibold text-muted">{t('print.options')}</p>
          <PaperChoice />
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
          <div className="my-1 border-t border-line" />
          {[...PRINT_PARTS, ...PRINT_EXTRAS].map((part) => (
            <label
              key={part}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2"
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
      )}
    </div>
  );
}
