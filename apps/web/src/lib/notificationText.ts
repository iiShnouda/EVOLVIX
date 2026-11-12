import {
  formatDate,
  formatMoney,
  formatNumber,
  type AppNotification,
  type Locale,
  type Translate,
} from '@skb/shared';

/**
 * How a notification reads and where it leads, from its kind and facts (the server stores no
 * sentence): one place, so the bell, the pop-up and the system notification agree.
 */

const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** The title: the kind, in the screen language. */
export function notificationTitle(n: AppNotification, t: Translate): string {
  return t(`notify.${n.kind}` as Parameters<Translate>[0]);
}

/** The line under the title: the document, who or where, and the amount where there is one. */
export function notificationDetail(n: AppNotification, t: Translate, locale: Locale): string {
  const d = n.data ?? {};
  const money = n.amount ? formatMoney(n.amount, 'EGP', locale) : null;
  const parts: (string | null | undefined)[] = [];
  switch (n.kind) {
    case 'NOTE_DUE':
    case 'NOTE_OVERDUE':
    case 'NOTE_BOUNCED':
      parts.push(n.documentNumber, n.partyName, n.departmentName, money);
      if (str(d.due)) parts.push(fill(t('notify.due'), { date: formatDate(str(d.due)!, locale) }));
      break;
    case 'STOCK_OUT':
    case 'STOCK_LOW':
      parts.push(n.partyName, n.documentNumber, n.departmentName);
      if (n.kind === 'STOCK_LOW' && num(d.qty) !== undefined)
        parts.push(fill(t('notify.qtyLeft'), { n: formatNumber(num(d.qty)!, locale) }));
      if (n.kind === 'STOCK_LOW' && num(d.level))
        parts.push(fill(t('notify.reorderAt'), { n: formatNumber(num(d.level)!, locale) }));
      break;
    case 'TRANSFER_SENT':
    case 'TRANSFER_RECEIVED':
    case 'TRANSFER_CANCELLED':
      parts.push(
        n.documentNumber,
        n.partyName && n.departmentName ? `${n.partyName} ← ${n.departmentName}` : null,
      );
      break;
    case 'PAYROLL_POSTED':
    case 'PAYROLL_PAID':
      parts.push(
        n.documentNumber,
        num(d.month)
          ? fill(t('notify.month'), { month: num(d.month)!, year: num(d.year) ?? '' })
          : null,
        money,
      );
      break;
    case 'PERIOD_LOCK':
      parts.push(
        str(d.date)
          ? fill(t('notify.lockedTo'), { date: formatDate(str(d.date)!, locale) })
          : t('notify.unlocked'),
      );
      break;
    case 'YEAR_CLOSED':
      parts.push(fill(t('notify.year'), { year: n.documentNumber ?? '' }));
      break;
    case 'UPDATE_AVAILABLE':
      parts.push(fill(t('notify.behind'), { n: formatNumber(n.amount, locale) }));
      break;
    case 'BACKUP_FAILED':
    case 'NEW_SIGNIN':
      break;
    case 'DAILY_SUMMARY':
      parts.push(n.documentNumber ? formatDate(n.documentNumber, locale) : null);
      break;
    case 'RETURN_MADE':
      parts.push(
        n.documentNumber,
        str(d.invoice) ? fill(t('notify.onInvoice'), { number: str(d.invoice)! }) : null,
        n.partyName,
        money,
      );
      break;
    default:
      parts.push(n.documentNumber, n.partyName, n.departmentName, money);
  }
  return parts.filter((p): p is string => !!p).join(' · ');
}

/** Where opening it goes (null = nowhere: it is read where it is). */
export function notificationLink(n: AppNotification): string | null {
  const id = n.documentId;
  switch (n.kind) {
    case 'ORDER_PENDING':
    case 'ORDER_APPROVED':
    case 'ORDER_REJECTED':
      return id ? `/sales?tab=orders&doc=${id}` : null;
    case 'INVOICE_NEW':
    case 'INVOICE_EDITED':
    case 'LIMIT_WAIT':
      return id ? `/sales?doc=${id}` : null;
    case 'RETURN_MADE':
      return id ? `/sales?tab=returns&doc=${id}` : null;
    case 'CASH_SENT':
      return '/handovers?side=in';
    case 'CASH_RECEIVED':
    case 'CASH_CANCELLED':
      return '/handovers?side=out';
    case 'TRANSFER_SENT':
    case 'TRANSFER_RECEIVED':
    case 'TRANSFER_CANCELLED':
      return id ? `/inventory/transfers/${id}` : '/inventory/transfers';
    case 'NOTE_DUE':
    case 'NOTE_OVERDUE':
    case 'NOTE_BOUNCED':
      return id
        ? `/notes?tab=${n.data?.direction === 'PAYABLE' ? 'payable' : 'receivable'}&note=${id}`
        : '/notes';
    case 'STOCK_OUT':
    case 'STOCK_LOW':
      return id ? `/inventory/items/${id}` : '/inventory';
    case 'PAYROLL_POSTED':
    case 'PAYROLL_PAID':
      return '/payroll?tab=runs';
    case 'PERIOD_LOCK':
    case 'YEAR_CLOSED':
      return '/ledger?tab=closing';
    case 'BACKUP_FAILED':
      return '/settings';
    case 'UPDATE_AVAILABLE':
      return '/updates';
    default:
      return null;
  }
}
