import type { TranslationKey } from '@skb/shared';
import { Badge } from './ui';
import { useT } from '../lib/i18n';
import { statusOf } from '../lib/status';

/**
 * A document's state as a badge. "Waiting for payment" is for the screen only and never prints
 * (owner, 2026-10-03): a printed invoice does not say it.
 */
export function StateBadge({ doc }: { doc: Parameters<typeof statusOf>[0] }) {
  const { t } = useT();
  const status = statusOf(doc);
  const badge = <Badge tone={status.tone}>{t(status.key as TranslationKey)}</Badge>;
  return status.key === 'state.DUE' ? <span data-noprint>{badge}</span> : badge;
}
