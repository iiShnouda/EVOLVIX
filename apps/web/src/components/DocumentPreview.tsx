import { useRef, type ReactNode } from 'react';
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
}: {
  doc?: SalesDocument;
  loading?: boolean;
  onClose?: () => void;
  /** Extra control in the header, e.g. "Return items" on an invoice. */
  action?: ReactNode;
}) {
  const { t, locale } = useT();
  const { company, details } = useReportTools();
  const paper = useRef<HTMLDivElement>(null);

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
          <div className="min-w-0">
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
            {isQuote && doc.dueDate && (
              <p>
                {t('quote.validUntil')}:{' '}
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
            {doc.departmentName && (
              <p>
                {t('invoice.department')}:{' '}
                <span className="font-medium text-fg">{doc.departmentName}</span>
              </p>
            )}
            {doc.repName && (
              <p>
                {t('invoice.rep')}: <span className="font-medium text-fg">{doc.repName}</span>
              </p>
            )}
            {doc.paidAccountName && doc.paidAmount > 0 && (
              <p>
                {t('money.paidInto')}:{' '}
                <span className="font-medium text-fg">{doc.paidAccountName}</span>
              </p>
            )}
            {doc.priceLevelName && (
              <p>
                {t('invoice.priceLevel')}:{' '}
                <span className="font-medium text-fg">{doc.priceLevelName}</span>
              </p>
            )}
          </div>
        </div>

        <div className="mb-4 rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm">
          <p className="text-xs text-muted">
            {isPurchaseSide ? t('invoice.supplier') : t('sales.customer')}
          </p>
          <p className="font-medium">{doc.partyName}</p>
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
        <div className="overflow-hidden rounded-[var(--radius-app)] border border-line">
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
        </div>

        {/* Totals */}
        <dl className="mt-4 space-y-1.5 text-sm">
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
      </div>

      {/* Staff footer (required on every document) */}
      <div className="flex items-center gap-2 border-t border-line p-4 text-xs text-muted">
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
