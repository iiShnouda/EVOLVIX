import { en, formatDateTime, type TranslationKey } from '@skb/shared';
import { Spinner } from './ui';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useAuditLog } from '../lib/queries';

function label(t: (k: TranslationKey) => string, prefix: string, code: string) {
  const key = `${prefix}.${code}`;
  return key in en ? t(key as TranslationKey) : code.replace(/[._]/g, ' ');
}

/**
 * One document's activity log (owner, 2026-10-19: "don't forget the activity log for everything"):
 * who made, changed, printed, approved or cancelled it, and when. For whoever may see the log.
 */
export function DocumentActivity({ id }: { id: string }) {
  const { t, locale } = useT();
  const can = useCan();
  const allowed = can('audit:view');
  const log = useAuditLog({ resourceId: id, page: 1 }, allowed);
  if (!allowed) return null;
  const rows = log.data?.items ?? [];
  return (
    <section className="space-y-2" data-noprint>
      <h3 className="text-sm font-semibold">{t('invoice.activity')}</h3>
      {log.isLoading ? (
        <div className="grid place-items-center py-4 text-muted">
          <Spinner size={18} />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{t('common.empty')}</p>
      ) : (
        <ul className="divide-y divide-[var(--c-line)] rounded-[var(--radius-app)] border border-line text-sm">
          {rows.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="font-medium">{label(t, 'audit.action', e.action)}</span>
                <span className="ms-2 text-muted">{e.actorName}</span>
                {e.details && <span className="ms-2 text-xs text-faint">{e.details}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted tnum">
                {formatDateTime(e.createdAt, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
