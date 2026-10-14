import { confirm } from '../lib/confirm';
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
import { Logo } from '../components/Logo';
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
    if (what === 'apply' && !(await confirm({ message: t('updates.confirm') }))) return;
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
      <Card className="flex flex-col items-center gap-2 py-8 text-center">
        <Logo size={56} />
        <p className="text-lg font-semibold">{t('updates.offTitle')}</p>
        <p className="max-w-sm text-sm text-muted">{t('updates.off')}</p>
      </Card>
    );

  // iOS "Software Update" style (owner, 2026-10-13): the app's own icon and name front and centre,
  // one big state line, and full-width rounded buttons underneath.
  const bigTitle =
    u.state === 'updating' || (offline && u.state !== 'idle')
      ? t('updates.updating')
      : u.state === 'waiting' || u.state === 'checking'
        ? t('updates.checking')
        : failure
          ? t('updates.failed')
          : u.available
            ? newest
              ? `Evolvix ${newest}`
              : t('updates.newChanges')
            : t('updates.upToDate');
  const updatedLine =
    u.state === 'idle' && u.step === 'done' && u.finishedAt
      ? `${t('updates.updatedAt')}: ${formatDateTime(u.finishedAt, locale)}`
      : null;
  const subLine = failure
    ? failure
    : updatedLine
      ? updatedLine
      : u.available
        ? (checked ?? `${t('updates.current')}: ${u.version}`)
        : `${t('updates.current')}: ${u.version}`;
  const dotTone = failure
    ? 'bg-destructive text-white'
    : u.available || working
      ? 'bg-brand text-brand-fg'
      : 'bg-positive text-white';

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col items-center gap-3 px-6 pb-6 pt-8 text-center">
        <span className="relative">
          <Logo size={64} className="drop-shadow-[0_10px_26px_rgba(79,70,229,0.4)]" />
          <span
            className={`absolute -bottom-1 grid h-7 w-7 place-items-center rounded-full border-4 border-surface end-[-6px] ${dotTone}`}
          >
            {working ? (
              <Spinner size={14} />
            ) : (
              <Icon name={failure ? 'alert' : u.available ? 'update' : 'check'} size={14} />
            )}
          </span>
        </span>
        <div className="space-y-1">
          <p className="text-xl font-bold" dir="auto">
            {bigTitle}
          </p>
          <p className={`text-sm ${failure ? 'text-destructive' : 'text-muted'}`}>{subLine}</p>
        </div>
      </div>

      {u.state === 'updating' && (
        <ol className="grid grid-cols-3 gap-2 px-6 pb-5 text-center text-xs">
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

      {!working && (
        <div className="space-y-2 border-t border-line p-4">
          {(u.available || failure) && (
            <Button
              size="lg"
              icon="update"
              loading={busy === 'apply'}
              disabled={!!busy}
              onClick={() => void send('apply')}
              className="w-full !rounded-2xl"
            >
              {t(failure ? 'updates.retry' : 'updates.updateNow')}
            </Button>
          )}
          <Button
            size="lg"
            variant={u.available || failure ? 'ghost' : 'secondary'}
            icon="search"
            loading={busy === 'check'}
            disabled={!!busy}
            onClick={() => void send('check')}
            className="w-full !rounded-2xl"
          >
            {t('updates.check')}
          </Button>
        </div>
      )}
      {error && <p className="px-4 pb-4 text-sm text-destructive">{error}</p>}
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
