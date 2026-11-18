import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { Button } from './ui';
import { CompanyMark, CompanyName } from './CompanyBadge';
import { PrefControls } from './shell/PrefControls';
import { WindowControls } from './shell/WindowControls';
import { BootDone } from '../lib/bootSplash';
import { useT } from '../lib/i18n';
import { api, ApiError } from '../lib/api';
import { errorText } from '../lib/errors';
import { useAuth } from '../stores/auth';

const box =
  'h-12 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-[color-mix(in_oklab,var(--c-brand)_22%,transparent)]';

/**
 * The lock screen (owner, 2026-11-18): after the idle time a remembered device shows only this, over
 * the whole window (the app, its top bar and menus are gone, and nothing read is kept). The person's
 * password — or their PIN, if they set one and the company allows it — opens it, checked by the
 * server; five wrong tries sign the device out. "Sign out" leaves without unlocking. The Windows
 * app's minimize and close stay at hand.
 */
export function LockScreen() {
  const { t } = useT();
  const lock = useAuth((s) => s.lock);
  const [usePin, setUsePin] = useState(!!lock?.pin);
  const [secret, setSecret] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pin = usePin && !!lock?.pin;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!secret || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.unlock(pin ? { pin: secret } : { password: secret });
    } catch (err) {
      setSecret('');
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'UNLOCK_SIGNED_OUT') await api.endLocked('unlockFailed');
      else if (code === 'SIGNED_IN_ELSEWHERE') await api.endLocked('signedInElsewhere');
      else if (code === 'NO_SESSION' || code === 'LICENSE_EXPIRED') await api.endLocked();
      else if (code === 'WRONG_UNLOCK' && err instanceof ApiError)
        setError(t('lock.left').replace('{n}', String(err.payload?.left ?? '')));
      else {
        if (code === 'PIN_NOT_ALLOWED') setUsePin(false);
        setError(errorText(t, err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center overflow-y-auto bg-canvas px-4 py-16 safe-top pb-safe"
    >
      <BootDone />
      <div className="absolute end-4 top-4 flex items-center gap-2 safe-top">
        <PrefControls />
        <WindowControls className="border-s border-line ps-2" />
      </div>
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-[380px] space-y-5 rounded-2xl border border-line bg-surface p-6 text-center shadow-[0_20px_60px_-30px_rgba(15,23,42,.45)] sm:p-8"
      >
        <div className="flex flex-col items-center gap-2">
          <CompanyMark size={52} className="rounded-2xl" />
          <CompanyName className="text-base font-semibold text-muted" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand">
            <Icon name="lock" size={24} />
          </span>
          <h1 id="lock-title" className="text-xl font-bold">
            {t('lock.title')}
          </h1>
          <p className="text-lg font-semibold">
            <bdi>{lock?.name}</bdi>
          </p>
          <p className="text-sm text-muted">{t(pin ? 'lock.hintPin' : 'lock.hint')}</p>
        </div>

        {pin ? (
          <input
            key="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={6}
            aria-label={t('lock.pin')}
            dir="ltr"
            value={secret}
            onChange={(e) => setSecret(e.target.value.replace(/\D/g, ''))}
            className={`${box} text-center text-2xl tracking-[0.5em] tnum`}
          />
        ) : (
          <span className="relative block">
            <input
              key="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              autoFocus
              aria-label={t('auth.password')}
              dir="ltr"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className={`${box} pe-11`}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-canvas hover:text-fg"
              aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
              title={show ? t('auth.hidePassword') : t('auth.showPassword')}
            >
              <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
            </button>
          </span>
        )}

        {error && (
          <p role="alert" className="rounded-[var(--radius-app)] bg-destructive-soft px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" loading={busy} disabled={!secret}>
          {t('lock.unlock')}
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          {lock?.pin ? (
            <button
              type="button"
              className="font-medium text-brand hover:underline"
              onClick={() => {
                setUsePin((v) => !v);
                setSecret('');
                setError(null);
              }}
            >
              {t(pin ? 'lock.usePassword' : 'lock.usePin')}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="font-medium text-muted hover:text-destructive"
            onClick={() => void api.endLocked()}
          >
            {t('auth.signOut')}
          </button>
        </div>
      </form>
    </div>
  );
}
