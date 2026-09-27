import { formatDate, formatMoney, formatNumber, type SalesDocument } from '@skb/shared';
import { Badge, Button, Spinner } from './ui';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { STATUS_TONE } from '../lib/status';

/** Printable-style document preview: company, branch, party, lines, totals, staff, status. */
export function DocumentPreview({
  doc,
  loading,
  onClose,
}: {
  doc?: SalesDocument;
  loading?: boolean;
  onClose?: () => void;
}) {
  const { t, locale } = useT();

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

  const outstanding = doc.grandTotal - doc.paidAmount;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line p-4">
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[doc.status]}>{t(`status.${doc.status}`)}</Badge>
          <span className="text-sm font-semibold tnum">{doc.number}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon="print" aria-label={t('common.print')} />
          <Button size="sm" variant="ghost" icon="download" aria-label={t('common.download')} />
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
          <div>
            <p className="text-base font-bold">{t('app.name')}</p>
            <p className="text-xs text-muted">{doc.branchName}</p>
          </div>
          <div className="text-end text-xs text-muted">
            <p>{t('doc.SALES_INVOICE')}</p>
            <p className="tnum">{formatDate(doc.issueDate, locale)}</p>
          </div>
        </div>

        <div className="mb-4 rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm">
          <p className="text-xs text-muted">{t('sales.customer')}</p>
          <p className="font-medium">{doc.partyName}</p>
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
                  <td className="p-2">{l.productName}</td>
                  <td className="p-2 text-end tnum">{formatNumber(l.quantity, locale)}</td>
                  <td className="hidden p-2 text-end tnum sm:table-cell">
                    {formatMoney(l.unitPrice, doc.currency, locale)}
                  </td>
                  <td className="p-2 text-end font-medium tnum">
                    {formatMoney(l.lineTotal, doc.currency, locale)}
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
          <Row
            label={t('sales.discount')}
            value={formatMoney(doc.discountTotal, doc.currency, locale)}
          />
          <Row label={t('sales.tax')} value={formatMoney(doc.taxTotal, doc.currency, locale)} />
          <div className="flex items-center justify-between border-t border-line pt-2 text-base font-semibold">
            <dt>{t('sales.grandTotal')}</dt>
            <dd className="tnum">{formatMoney(doc.grandTotal, doc.currency, locale)}</dd>
          </div>
          <Row label={t('sales.paid')} value={formatMoney(doc.paidAmount, doc.currency, locale)} />
          <Row
            label={t('sales.outstanding')}
            value={formatMoney(outstanding, doc.currency, locale)}
            emphasize={outstanding > 0}
          />
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
