import { Link } from 'react-router-dom';
import { addDays, formatDate } from '@skb/shared';
import { useCan } from '../lib/can';
import { useT } from '../lib/i18n';
import { useLicense } from '../lib/queries';

/** Tells the owner when the subscription is about to end or has ended (owner, 2026-10-15). */
export function LicenseBanner() {
  const { t, locale } = useT();
  const can = useCan();
  const owner = can('license:manage');
  const { data } = useLicense(owner);
  if (!owner || !data) return null;
  const { state, expiresAt } = data;
  if (state !== 'ending' && state !== 'grace' && state !== 'expired' && state !== 'invalid')
    return null;
  const day = expiresAt
    ? formatDate(state === 'grace' ? addDays(expiresAt, 7) : expiresAt, locale)
    : '';
  const tone =
    state === 'ending' ? 'bg-warning-soft text-warning' : 'bg-destructive-soft text-destructive';
  return (
    <Link
      to="/license"
      className={`mb-4 block rounded-[var(--radius-app)] px-4 py-2.5 text-sm font-medium ${tone}`}
    >
      {t(`license.banner.${state}`).replace('{date}', day)}
    </Link>
  );
}
