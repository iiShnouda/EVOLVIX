import { companyToday, type DocumentStatus } from '@skb/shared';
import type { Tone } from '../components/ui';

export const STATUS_TONE: Record<DocumentStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING: 'info',
  CONFIRMED: 'info',
  PAID: 'positive',
  PARTIALLY_PAID: 'warning',
  OVERDUE: 'destructive',
  CANCELLED: 'neutral',
  RETURNED: 'warning',
  REJECTED: 'destructive',
};

export const KPI_TONE_MAP: Record<string, Tone> = {
  positive: 'positive',
  warning: 'warning',
  destructive: 'destructive',
  info: 'info',
  neutral: 'neutral',
};

/** Where a quotation stands: open, became an invoice, cancelled, or past its date. */
export type QuoteState = 'OPEN' | 'WON' | 'CANCELLED' | 'EXPIRED';

export const QUOTE_TONE: Record<QuoteState, Tone> = {
  OPEN: 'info',
  WON: 'positive',
  CANCELLED: 'neutral',
  EXPIRED: 'warning',
};

export function quoteState(doc: { status: DocumentStatus; dueDate?: string | null }): QuoteState {
  if (doc.status === 'CONFIRMED') return 'WON';
  if (doc.status === 'CANCELLED') return 'CANCELLED';
  return doc.dueDate && doc.dueDate.slice(0, 10) < companyToday() ? 'EXPIRED' : 'OPEN';
}

/** A document's status label key and tone (a quotation has its own states). */
export function statusOf(doc: { type: string; status: DocumentStatus; dueDate?: string | null }): {
  key: string;
  tone: Tone;
} {
  if (doc.type === 'QUOTATION') {
    const s = quoteState(doc);
    return { key: `quote.state.${s}`, tone: QUOTE_TONE[s] };
  }
  // A pending invoice: waiting, approved, cancelled, or past the days it holds its goods.
  if (doc.type === 'SALES_ORDER') {
    if (doc.status === 'REJECTED') return { key: 'order.state.REJECTED', tone: 'destructive' };
    const s = quoteState(doc);
    return { key: `order.state.${s}`, tone: QUOTE_TONE[s] };
  }
  return { key: `status.${doc.status}`, tone: STATUS_TONE[doc.status] };
}
