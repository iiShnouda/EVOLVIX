import { useState } from 'react';
import { formatDateTime, formatNumber } from '@skb/shared';
import { Button, Card } from './ui';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { saveFile } from '../lib/print';
import { useBackupStatus, useRunBackup } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

const size = (bytes: number, locale: 'en' | 'ar') =>
  bytes >= 1024 * 1024
    ? `${formatNumber(Math.round((bytes / 1024 / 1024) * 10) / 10, locale)} MB`
    : `${formatNumber(Math.max(1, Math.round(bytes / 1024)), locale)} KB`;

/**
 * Backups (النسخ الاحتياطي), for the owner: download one now, encrypted with a passphrase they
 * choose, and see / download the automatic ones the server keeps. Restoring is a server command.
 */
export function BackupsCard() {
  const { t, locale } = useT();
  const status = useBackupStatus();
  const run = useRunBackup();
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const s = status.data;

  async function get(key: string, fetcher: () => Promise<{ name: string; bytes: Uint8Array }>) {
    setBusy(key);
    setError(null);
    setDone(false);
    try {
      const file = await fetcher();
      saveFile(file.name, 'application/octet-stream', file.bytes);
      if (key === 'now') {
        setPass('');
        setAgain('');
        setDone(true);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const valid = pass.length >= 8 && pass === again;

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
        {t('backup.title')}
      </h2>
      <p className="mb-3 text-xs text-faint">{t('backup.intro')}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('backup.passphrase')}</span>
          <input
            className={field}
            type="password"
            autoComplete="new-password"
            dir="ltr"
            maxLength={200}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('backup.again')}</span>
          <input
            className={field}
            type="password"
            autoComplete="new-password"
            dir="ltr"
            maxLength={200}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-warning">{t('backup.keepSafe')}</p>
      {again && pass !== again && (
        <p className="mt-1 text-xs text-destructive">{t('backup.mismatch')}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          icon="download"
          disabled={!valid || busy !== null}
          loading={busy === 'now'}
          onClick={() =>
            void get('now', () => api.download('/backups/download', { passphrase: pass }))
          }
        >
          {t('backup.download')}
        </Button>
        {done && <span className="text-sm text-positive">{t('backup.downloaded')}</span>}
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{errorText(t, error)}</p> : null}

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="mb-1 text-sm font-semibold">{t('backup.automatic')}</h3>
        {!s ? null : s.automatic ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted">
              {t('backup.daily')} {formatNumber(s.hour, locale)}:00 · {t('backup.keeps')}{' '}
              {formatNumber(s.keep, locale)} ·{' '}
              <span className={s.encrypted ? 'text-positive' : 'text-warning'}>
                {s.encrypted ? t('backup.encrypted') : t('backup.notEncrypted')}
              </span>
            </p>
            <p className="break-all text-xs text-faint">
              {t('backup.folder')}: <bdi>{s.folder}</bdi>
            </p>
            {s.nextRunAt && (
              <p className="text-xs text-muted">
                {t('backup.next')}: {formatDateTime(s.nextRunAt, locale)}
              </p>
            )}
            {s.lastError && (
              <p className="text-xs text-destructive">
                {t('backup.failed')}: {s.lastError}
              </p>
            )}
            {s.files.length === 0 ? (
              <p className="text-xs text-muted">{t('backup.none')}</p>
            ) : (
              <ul className="divide-y divide-line rounded-[var(--radius-app)] border border-line">
                {s.files.map((f) => (
                  <li key={f.name} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm tnum">
                        {formatDateTime(f.createdAt, locale)}
                      </span>
                      <span className="text-xs text-faint tnum">
                        {size(f.size, locale)} · <bdi>{f.name}</bdi>
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="download"
                      aria-label={t('common.download')}
                      disabled={busy !== null}
                      loading={busy === f.name}
                      onClick={() =>
                        void get(f.name, () =>
                          api.download(`/backups/files/${encodeURIComponent(f.name)}`),
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            <Button
              size="sm"
              variant="secondary"
              loading={run.isPending}
              onClick={() => run.mutate()}
            >
              {t('backup.runNow')}
            </Button>
            {run.error && <p className="text-xs text-destructive">{errorText(t, run.error)}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted">{t('backup.off')}</p>
        )}
      </div>
      <p className="mt-4 text-xs text-faint">{t('backup.restoreHint')}</p>
    </Card>
  );
}
