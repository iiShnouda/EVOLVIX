import { CompanyMark } from './CompanyBadge';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  formatDate,
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
const PRINT_PARTS = ['company', 'party', 'meta', 'lines', 'totals', 'notes', 'staff'] as const;
type PrintPart = (typeof PRINT_PARTS)[number];

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
  const { t, locale } = useT();
  const { company, details } = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  // What is left out of the printout, kept per person like hidden columns.
  const [skipped, setSkipped] = useHiddenColumns('print.document');
  const skip = (part: PrintPart) => (skipped.includes(part) ? { 'data-noprint': '' } : {});
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
  const isQuote = doc.type === 'QUOTATION';
  const status = statusOf(doc);
  const isPurchaseSide = doc.type === 'PURCHASE_INVOICE' || doc.type === 'PURCHASE_RETURN';
  const outstanding = doc.grandTotal - doc.paidAmount;
  const lineDiscounts = doc.lines.reduce((sum, l) => sum + l.discount, 0);

  return (
    <div ref={paper} className="flex h-full flex-col">
      <div
        data-noprint
        className="flex items-center justify-between gap-2 border-b border-line p-4"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={status.tone}>{t(status.key as TranslationKey)}</Badge>
          <span className="truncate text-sm font-semibold tnum">{doc.number}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          <PrintOptions skipped={skipped} onChange={setSkipped} />
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

      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <CompanyMark size={48} logoOnly />
          <div className="min-w-0 flex-1" {...skip('company')}>
            <p className="text-base font-bold">{company}</p>
            {details.map((d) => (
              <p key={d} className="break-words text-xs text-muted">
                <bdi>{d}</bdi>
              </p>
            ))}
            <p className="text-xs text-muted">{doc.branchName}</p>
          </div>
          <div className="shrink-0 text-end text-xs text-muted">
            <p className="text-sm font-semibold text-fg">{t(`doc.${doc.type}`)}</p>
            <p className="tnum font-medium text-fg">{doc.number}</p>
            <p className="tnum">{formatDate(doc.issueDate, locale)}</p>
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
                {t('return.against')}:{' '}
                <span className="font-medium text-fg">{doc.sourceNumber}</span>
              </p>
            )}
            <div {...skip('meta')}>
              {doc.status === 'CANCELLED' && doc.cancelReason && (
                <p className="text-destructive">
                  {t('invoice.cancelledReason')}:{' '}
                  <span className="font-medium">{doc.cancelReason}</span>
                </p>
              )}
              {doc.rejectReason && (
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
                  {doc.repCode != null && <span className="tnum"> ({doc.repCode})</span>}
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
          </div>
        </div>

        <div
          className="mb-4 rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm"
          {...skip('party')}
        >
          <p className="text-xs text-muted">
            {isPurchaseSide ? t('invoice.supplier') : t('sales.customer')}
          </p>
          <p className="font-medium">
            {doc.partyName}
            {doc.partyCode != null && (
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

        {/* Line items */}
        <div
          className="overflow-hidden rounded-[var(--radius-app)] border border-line"
          {...skip('lines')}
        >
          <TableColumns id="document.lines">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="p-2 text-start font-medium">{t('inventory.products')}</th>
                  <th className="p-2 text-end font-medium">{t('sales.qty')}</th>
                  <th className="hidden p-2 text-end font-medium sm:table-cell">
                    {t('sales.unitPrice')}
                  </th>
                  <th className="p-2 text-end font-medium">{t('common.total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {doc.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="p-2">
                      {l.productName}
                      {l.warehouseName && (
                        <span className="block text-xs text-muted">{l.warehouseName}</span>
                      )}
                      {l.returnedQuantity > 0 && (
                        <span className="block text-xs text-warning tnum">
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
                    <td className="hidden p-2 text-end tnum sm:table-cell">
                      {formatMoney(l.unitPrice, doc.currency, locale)}
                    </td>
                    <td className="p-2 text-end font-medium tnum">
                      {l.isBonus ? (
                        <span className="text-xs font-medium text-positive">
                          {t('invoice.bonus')}
                        </span>
                      ) : (
                        formatMoney(l.lineTotal, doc.currency, locale)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableColumns>
        </div>

        {/* Totals */}
        <dl className="mt-4 space-y-1.5 text-sm" {...skip('totals')}>
          <Row
            label={t('sales.subtotal')}
            value={formatMoney(doc.subtotal, doc.currency, locale)}
          />
          {doc.charges.length > 0 ? (
            // The invoice's own discounts, taxes and additions, in the order they applied.
            <>
              {lineDiscounts > 0 && (
                <Row
                  label={t('sales.discount')}
                  value={formatMoney(-lineDiscounts, doc.currency, locale)}
                />
              )}
              {doc.charges.map((c, i) => (
                <Row
                  key={i}
                  label={`${c.label ?? t(`charge.${c.kind}`)}${c.rate != null ? ` (${formatNumber(c.rate, locale)}%)` : ''}`}
                  value={formatMoney(
                    c.kind === 'DISCOUNT' || c.kind === 'EXTRA_DISCOUNT' ? -c.amount : c.amount,
                    doc.currency,
                    locale,
                  )}
                />
              ))}
            </>
          ) : (
            <>
              <Row
                label={t('sales.discount')}
                value={formatMoney(doc.discountTotal, doc.currency, locale)}
              />
              <Row label={t('sales.tax')} value={formatMoney(doc.taxTotal, doc.currency, locale)} />
            </>
          )}
          <div className="flex items-center justify-between border-t border-line pt-2 text-base font-semibold">
            <dt>{t('sales.grandTotal')}</dt>
            <dd className="tnum">{formatMoney(doc.grandTotal, doc.currency, locale)}</dd>
          </div>
          {!isQuote && (
            <>
              <Row
                label={isReturn ? t('return.refunded') : t('sales.paid')}
                value={formatMoney(doc.paidAmount, doc.currency, locale)}
              />
              <Row
                label={isReturn ? t('return.onAccount') : t('sales.outstanding')}
                value={formatMoney(outstanding, doc.currency, locale)}
                emphasize={!isReturn && outstanding > 0}
              />
            </>
          )}
        </dl>
        {doc.notes && (
          <p
            className="mt-4 whitespace-pre-wrap rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm"
            {...skip('notes')}
          >
            <span className="block text-xs text-muted">{t('invoice.notes')}</span>
            {doc.notes}
          </p>
        )}
      </div>

      {/* Staff footer (required on every document) */}
      <div
        className="flex items-center gap-2 border-t border-line p-4 text-xs text-muted"
        {...skip('staff')}
      >
        <Icon name="staff" size={14} />
        <span>{t('sales.issuedBy')}:</span>
        <span className="font-medium text-fg">{doc.staffName}</span>
      </div>
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

/** Choose what the printout carries; the columns follow the table's own column choice. */
function PrintOptions({
  skipped,
  onChange,
}: {
  skipped: string[];
  onChange: (next: string[]) => void;
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
    <div ref={box} className="relative">
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
        <div className="absolute end-0 z-30 mt-1 w-56 rounded-[var(--radius-app)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          <p className="px-2 py-1 text-xs font-semibold text-muted">{t('print.options')}</p>
          <PaperChoice />
          {PRINT_PARTS.map((part) => (
            <label
              key={part}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={!skipped.includes(part)}
                onChange={() =>
                  onChange(
                    skipped.includes(part) ? skipped.filter((p) => p !== part) : [...skipped, part],
                  )
                }
              />
              {t(`print.${part}`)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
