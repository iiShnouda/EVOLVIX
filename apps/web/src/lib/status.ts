import type { DocumentStatus } from '@skb/shared';
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
};

export const KPI_TONE_MAP: Record<string, Tone> = {
  positive: 'positive',
  warning: 'warning',
  destructive: 'destructive',
  info: 'info',
  neutral: 'neutral',
};
