import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  NAV_ITEMS,
  companyTimeZone,
  en,
  formatNumber,
  type ActivityEvent,
  type PresenceEntry,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { usePresence } from '../lib/queries';
import { onActivity, onPresenceChanged } from '../lib/presence';
import { useAuth } from '../stores/auth';

/** A code's label in the screen language, or the code made readable. */
function codeLabel(t: (k: TranslationKey) => string, prefix: string, code: string) {
  const key = `${prefix}.${code}`;
  return key in en ? t(key as TranslationKey) : code.replace(/[._]/g, ' ');
}

/** Used the app within this long: active; otherwise idle. */
const ACTIVE_MS = 2 * 60_000;

/** A screen key as its menu name, e.g. "sales" → "Sales". */
function screenName(t: (k: TranslationKey) => string, view: string | null) {
  if (!view) return null;
  const item = NAV_ITEMS.find((n) => n.key === view || n.path === `/${view}`);
  return item ? t(item.labelKey) : view;
}

/**
 * Who's online now (المتصلون الآن): each person signed in, their branch, which app they use,
 * the screen they're on, and whether they're using it or idle. Updates live.
 */
export function PresencePage() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user?.id);
  const can = useCan();
  const seesActivity = can('audit:view');
  const { data, isLoading } = usePresence(true);
  const [now, setNow] = useState(Date.now());
  const [feed, setFeed] = useState<ActivityEvent[]>([]);

  // The live feed of what people are doing in the app (owner, 2026-10-12), for those who may read
  // the activity log. It keeps the latest few lines; nothing is stored.
  useEffect(() => {
    if (!seesActivity) return;
    return onActivity((ev) => {
      const e = ev as ActivityEvent;
      if (e && e.id) setFeed((cur) => [e, ...cur.filter((x) => x.id !== e.id)].slice(0, 40));
    });
  }, [seesActivity]);

  // Live: refresh when someone comes, goes or changes screen (at most once a second).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onPresenceChanged(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void qc.invalidateQueries({ queryKey: ['presence'] }), 1000);
    });
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      off();
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [qc]);

  const minutes = (iso: string) =>
    Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: companyTimeZone(),
    });
  const active = (p: PresenceEntry) => now - new Date(p.lastActiveAt).getTime() < ACTIVE_MS;
  const people = data ?? [];
  const activeCount = people.filter(active).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('presence.title')}
        subtitle={
          data
            ? `${formatNumber(people.length, locale)} ${t('presence.online')} · ${formatNumber(activeCount, locale)} ${t('presence.activeNow')}`
            : t('presence.subtitle')
        }
      />
      {isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : people.length === 0 ? (
        <Card>
          <EmptyState title={t('presence.empty')} icon="presence" />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {people.map((p) => {
            const on = active(p);
            return (
              <Card key={p.userId} className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
                      {p.fullName
                        .split(/\s+/)
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join('')}
                      <span
                        className={`absolute bottom-0 end-0 h-3 w-3 rounded-full border-2 border-[var(--c-surface)] ${on ? 'bg-positive' : 'bg-warning'}`}
                        aria-hidden
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {p.fullName}
                        {p.userId === me && (
                          <span className="ms-1 text-xs text-muted">({t('staff.you')})</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {t(`role.${p.role}` as TranslationKey)}
                        {p.branchName && ` · ${p.branchName}`}
                      </p>
                    </div>
                  </div>
                  <Badge tone={on ? 'positive' : 'warning'}>
                    {on
                      ? t('presence.active')
                      : `${t('presence.idle')} ${formatNumber(minutes(p.lastActiveAt), locale)} ${t('presence.min')}`}
                  </Badge>
                </div>
                <ul className="space-y-1 border-t border-line pt-2 text-sm">
                  {p.windows.map((w, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">
                          {t(`presence.device.${w.device}` as TranslationKey)}
                        </span>
                        {w.currentView && (
                          <span className="text-muted"> · {screenName(t, w.currentView)}</span>
                        )}
                      </span>
                      <span className="text-xs text-faint tnum">
                        {w.ip && <bdi>{w.ip}</bdi>} · {t('presence.since')} {time(w.connectedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {seesActivity && (
        <Card className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-positive" />
            </span>
            <h2 className="text-sm font-semibold">{t('presence.liveActivity')}</h2>
          </div>
          {feed.length === 0 ? (
            <p className="py-3 text-sm text-muted">{t('presence.liveWaiting')}</p>
          ) : (
            <ul className="max-h-96 space-y-0.5 overflow-y-auto">
              {feed.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line py-1.5 text-sm last:border-0"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{e.actorName || t('audit.unknown')}</span>{' '}
                    <span className="text-brand">{codeLabel(t, 'audit.action', e.action)}</span>{' '}
                    <span className="text-muted">{codeLabel(t, 'audit.resource', e.resource)}</span>
                    {e.details && (
                      <>
                        {' '}
                        — <bdi className="text-fg">{e.details}</bdi>
                      </>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-faint tnum">
                    {e.device && (
                      <>
                        {t(`audit.device.${e.device}` as 'audit.device.web')}
                        {' · '}
                      </>
                    )}
                    {time(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
