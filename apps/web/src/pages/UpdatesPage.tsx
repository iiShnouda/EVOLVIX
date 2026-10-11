import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  formatDate,
  formatDateTime,
  type Release,
  type SystemUpdates,
  type UpdateStep,
} from '@skb/shared';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useSystemUpdates } from '../lib/queries';

const STEPS = ['download', 'build', 'restart'] as const satisfies readonly UpdateStep[];
const KNOWN_ERRORS = [
  'no_connection',
  'local_changes',
  'build_failed',
  'start_failed',
  'timed_out',
  'updater_not_running',
] as const;

/**
 * The owner's updates (owner, 2026-10-11: "see whether there's a new version, what it brings and
 * fixes, press Update and it updates; else it says up to date"). The server's own updater does the
 * work (see UpdateService on the server); this page asks it to look or to update and follows it.
 * Below, what each version brought.
 */
export function UpdatesPage() {
  const { t } = useT();
  const updates = useSystemUpdates();
  const u = updates.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.updates')}
        subtitle={u ? `${t('updates.current')}: ${u.version}` : undefined}
      />
      {updates.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : !u ? (
        <Card className="text-sm text-destructive">{errorText(t, updates.error)}</Card>
      ) : (
        <>
          <StatusCard u={u} offline={updates.isError} />
          {u.coming.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted">{t('updates.whatsNew')}</h2>
              {u.coming.map((r) => (
                <ReleaseCard key={r.version} release={r} fresh />
              ))}
            </section>
          )}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted">{t('updates.history')}</h2>
            {u.installed.map((r, i) => (
              <ReleaseCard key={r.version} release={r} current={i === 0} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

/** Where the server stands: up to date, a new version, looking, updating, or what went wrong. */
function StatusCard({ u, offline }: { u: SystemUpdates; offline: boolean }) {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(what: 'check' | 'apply') {
    if (what === 'apply' && !window.confirm(t('updates.confirm'))) return;
    setBusy(what);
    setError(null);
    try {
      await api.post(`/system/updates/${what}`);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(null);
      await qc.invalidateQueries({ queryKey: ['system', 'updates'] });
    }
  }

  // While the server restarts into the new version it doesn't answer for a moment.
  const working =
    u.state === 'waiting' ||
    u.state === 'checking' ||
    u.state === 'updating' ||
    (offline && u.state !== 'idle');
  const newest = u.coming[0]?.version;
  const checked = u.checkedAt
    ? `${t('updates.checkedAt')}: ${formatDateTime(u.checkedAt, locale)}`
    : null;
  const failure =
    u.state === 'failed'
      ? t(
          KNOWN_ERRORS.includes(u.error as (typeof KNOWN_ERRORS)[number])
            ? (`updates.error.${u.error}` as 'updates.error.build_failed')
            : 'updates.error.generic',
        )
      : null;

  if (!u.enabled)
    return (
      <Card className="flex items-start gap-3">
        <Icon name="update" size={22} className="mt-0.5 shrink-0 text-muted" />
        <div className="space-y-1">
          <p className="font-semibold">{t('updates.offTitle')}</p>
          <p className="text-sm text-muted">{t('updates.off')}</p>
        </div>
      </Card>
    );

  const tone = failure
    ? 'border-destructive/40'
    : u.available
      ? 'border-brand/40'
      : 'border-positive/40';
  return (
    <Card className={`space-y-4 border ${tone}`}>
      <div className="flex flex-wrap items-center gap-4">
        <span
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${
            failure
              ? 'bg-destructive-soft text-destructive'
              : u.available || working
                ? 'bg-brand-soft text-brand'
                : 'bg-positive-soft text-positive'
          }`}
        >
          {working ? (
            <Spinner size={22} />
          ) : (
            <Icon name={failure ? 'alert' : u.available ? 'update' : 'check'} size={24} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">
            {u.state === 'updating' || (offline && u.state !== 'idle')
              ? t('updates.updating')
              : u.state === 'waiting' || u.state === 'checking'
                ? t('updates.checking')
                : failure
                  ? t('updates.failed')
                  : u.available
                    ? newest
                      ? `${t('updates.newVersion')} ${newest}`
                      : t('updates.newChanges')
                    : t('updates.upToDate')}
          </p>
          {failure ? (
            <p className="text-sm text-destructive">{failure}</p>
          ) : u.state === 'idle' && u.step === 'done' && u.finishedAt ? (
            <p className="text-sm text-muted">
              {t('updates.updatedAt')}: {formatDateTime(u.finishedAt, locale)}
            </p>
          ) : (
            checked && !working && <p className="text-sm text-muted">{checked}</p>
          )}
        </div>
        {!working && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {(u.available || failure) && (
              <Button
                icon="update"
                loading={busy === 'apply'}
                disabled={!!busy}
                onClick={() => void send('apply')}
                className="flex-1 sm:flex-none"
              >
                {t(failure ? 'updates.retry' : 'updates.updateNow')}
              </Button>
            )}
            <Button
              variant="secondary"
              icon="search"
              loading={busy === 'check'}
              disabled={!!busy}
              onClick={() => void send('check')}
              className="flex-1 sm:flex-none"
            >
              {t('updates.check')}
            </Button>
          </div>
        )}
      </div>

      {u.state === 'updating' && (
        <ol className="grid grid-cols-3 gap-2 text-center text-xs">
          {STEPS.map((s, i) => {
            const at = Math.max(0, STEPS.indexOf(u.step as (typeof STEPS)[number]));
            const done = i < at;
            const now = i === at;
            return (
              <li key={s} className="space-y-1.5">
                <span
                  className={`block h-1.5 rounded-full ${done ? 'bg-positive' : now ? 'animate-pulse bg-brand' : 'bg-surface-2'}`}
                />
                <span
                  className={
                    now ? 'font-semibold text-brand' : done ? 'text-positive' : 'text-muted'
                  }
                >
                  {t(`updates.step.${s}`)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}

/** One version: what it brought, the date, and the apps that go with it. */
function ReleaseCard({
  release,
  fresh,
  current,
}: {
  release: Release;
  fresh?: boolean;
  current?: boolean;
}) {
  const { t, locale } = useT();
  const text = (n: { ar: string; en: string }) => (locale === 'ar' ? n.ar : n.en);
  const apps = Object.entries(release.apps ?? {}) as ['windows' | 'android', string][];
  return (
    <Card className={`space-y-3 ${fresh ? 'border border-brand/40' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold" dir="ltr">
          {release.version}
        </h3>
        {current && (
          <span className="rounded-full bg-positive-soft px-2 py-0.5 text-xs font-semibold text-positive">
            {t('updates.installed')}
          </span>
        )}
        {fresh && (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">
            {t('updates.new')}
          </span>
        )}
        {release.date && (
          <span className="ms-auto text-xs text-muted tnum">
            {formatDate(release.date, locale)}
          </span>
        )}
      </div>
      {release.features.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted">{t('updates.features')}</p>
          <ul className="space-y-1.5 text-sm">
            {release.features.map((n, i) => (
              <li key={i} className="flex gap-2">
                <Icon name="plus" size={16} className="mt-0.5 shrink-0 text-brand" />
                <span>{text(n)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {release.fixes.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted">{t('updates.fixes')}</p>
          <ul className="space-y-1.5 text-sm">
            {release.fixes.map((n, i) => (
              <li key={i} className="flex gap-2">
                <Icon name="check" size={16} className="mt-0.5 shrink-0 text-positive" />
                <span>{text(n)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {apps.length > 0 && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2 text-xs text-muted">
          {apps.map(([app, v]) => (
            <span key={app}>
              {t(`updates.app.${app}`)}: <bdi className="font-semibold text-fg">{v}</bdi>
            </span>
          ))}
        </p>
      )}
    </Card>
  );
}
