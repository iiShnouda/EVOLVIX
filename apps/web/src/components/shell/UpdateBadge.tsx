import { useCan } from '../../lib/can';
import { useT } from '../../lib/i18n';
import { useSystemUpdates } from '../../lib/queries';

/** A dot beside the menu's "Updates" when a new version is out (the owner's, 2026-10-11). */
export function UpdateBadge({ className = '' }: { className?: string }) {
  const { t } = useT();
  const can = useCan();
  const on = can('system:update');
  const updates = useSystemUpdates(on);
  if (!on || !updates.data?.available) return null;
  return (
    <span
      role="status"
      aria-label={t('updates.available')}
      title={t('updates.available')}
      className={`block h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-surface ${className}`}
    />
  );
}
