import type { MouseEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Permission } from '@skb/shared';
import { useCan } from '../lib/can';

/**
 * Clickable names and numbers everywhere (owner, 2026-11-12: "tapping the customer brings their
 * statement, tapping the invoice number brings the invoice, tapping the item brings its card").
 * Each is plain text for someone who may not open what it leads to, and prints as plain text.
 */
function stop(e: MouseEvent) {
  // A link inside a clickable row opens what it names, not the row.
  e.stopPropagation();
}

export { PartyLink } from './PartyContact';

/** Vouchers open on Cash & Banks. */
const VOUCHERS = new Set([
  'RECEIPT',
  'PAYMENT',
  'EXPENSE',
  'TRANSFER',
  'DISCOUNT',
  'DISCOUNT_RECEIVED',
  'VOUCHER',
]);

/** Where a document opens, and who may open it; null when it doesn't open. */
export function docTarget(
  kind: string | null | undefined,
  id: string,
  can: (p: Permission) => boolean,
): string | null {
  switch (kind) {
    case 'SALES_INVOICE':
    case 'SALES_ORDER':
    case 'QUOTATION':
      return can('sales:view') ? `/sales?doc=${id}` : null;
    case 'SALES_RETURN':
      return can('sales:returns_view') || can('sales:view') ? `/sales?doc=${id}` : null;
    case 'PURCHASE_INVOICE':
      return can('purchases:view') ? `/purchases?doc=${id}` : null;
    case 'PURCHASE_RETURN':
      return can('purchases:returns_view') || can('purchases:view') ? `/purchases?doc=${id}` : null;
    case 'NOTE':
      return can('notes:view_receivable') || can('notes:view_payable') ? `/notes?note=${id}` : null;
    case 'STOCK_TRANSFER':
      return can('transfers:view') ? `/inventory/transfers/${id}` : null;
    default:
      return kind && VOUCHERS.has(kind) && can('vouchers:view') ? `/receipts?voucher=${id}` : null;
  }
}

const PREVIEWED = new Set(['SALES_INVOICE', 'SALES_RETURN', 'PURCHASE_INVOICE', 'PURCHASE_RETURN']);

/**
 * A document's number (an invoice, a return, a receipt or payment, a cheque, a transfer); it opens
 * the document. `onPreview` shows an invoice or return in place (a statement keeps its period).
 */
export function DocLink({
  id,
  kind,
  number,
  onPreview,
  className,
}: {
  id?: string | null;
  kind?: string | null;
  number: ReactNode;
  onPreview?: (id: string, scope: 'sales' | 'purchases') => void;
  className?: string;
}) {
  const can = useCan();
  const navigate = useNavigate();
  const text = <bdi className={`whitespace-nowrap ${className ?? ''}`}>{number}</bdi>;
  const to = id ? docTarget(kind, id, can) : null;
  if (!id || !to) return text;
  return (
    <button
      type="button"
      className={`nav-link whitespace-nowrap text-brand hover:underline ${className ?? ''}`}
      onClick={(e) => {
        stop(e);
        if (onPreview && kind && PREVIEWED.has(kind))
          onPreview(id, kind.startsWith('PURCHASE') ? 'purchases' : 'sales');
        else navigate(to);
      }}
    >
      <bdi>{number}</bdi>
    </button>
  );
}
