import { useState, type FormEvent, type ReactNode } from 'react';
import { loginSchema } from '@skb/shared';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { Logo, Wordmark } from '../components/Logo';
import { CompanyMark, CompanyName } from '../components/CompanyBadge';
import { PrefControls } from '../components/shell/PrefControls';
import { useT } from '../lib/i18n';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../stores/auth';
import { GetApps } from '../components/GetApps';
import { useConnection } from '../stores/connection';
import { errorText } from '../lib/errors';

/** A labelled box with an icon at its start. */
function Field({
  label,
  icon,
  children,
  end,
}: {
  label: string;
  icon: string;
  children: ReactNode;
  end?: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <span className="flex h-12 items-center gap-2 rounded-[var(--radius-app)] border border-line bg-surface px-3 transition focus-within:border-brand focus-within:ring-2 focus-within:ring-[color-mix(in_oklab,var(--c-brand)_22%,transparent)]">
        <Icon name={icon} size={18} className="shrink-0 text-muted" />
        {children}
        {end}
      </span>
    </label>
  );
}

const input =
  'h-full min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:outline-none';

/**
 * Sign-in (owner, 2026-10-01): the company's own name and logo first, Evolvix underneath. An account
 * works on one device at a time; when another device takes it, this page says so.
 */
export function LoginPage() {
  const { t } = useT();
  const setSession = useAuth((s) => s.setSession);
  const notice = useAuth((s) => s.notice);
  const connection = useConnection((s) => s.state);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password, rememberDevice: remember });
    if (!parsed.success) {
      setError(t('auth.invalidCredentials'));
      return;
    }
    setLoading(true);
    try {
      const { user, accessToken } = await api.login(parsed.data);
      // The app then opens the page the person was on (kept on the server).
      setSession(user, accessToken);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') {
        setError(t('auth.invalidCredentials'));
      } else if (err instanceof ApiError) {
        setError(errorText(t, err));
      } else {
        setError(t('common.errorBody'));
      }
    } finally {
      setLoading(false);
    }
  };

  const online = connection !== 'offline';

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel (desktop) */}
      <aside
        className="relative hidden overflow-hidden p-12 text-brand-fg lg:flex lg:flex-col lg:justify-between"
        style={{
          background:
            'linear-gradient(150deg, var(--c-brand) 0%, color-mix(in oklab, var(--c-brand) 62%, #050816) 100%)',
        }}
      >
        <Logo
          size={520}
          className="pointer-events-none absolute -bottom-28 -end-32 opacity-[0.07] blur-[1px]"
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,.7) 1px, transparent 0)',
            backgroundSize: '26px 26px',
          }}
        />

        <div className="relative flex items-center gap-4">
          <CompanyMark size={64} className="rounded-2xl shadow-lg ring-1 ring-white/30" />
          <CompanyName className="text-2xl font-bold leading-tight" />
        </div>

        <div className="relative max-w-md space-y-6">
          <h2 className="text-4xl font-bold leading-tight">{t('auth.welcome')}</h2>
          <ul className="space-y-3 text-sm">
            {(
              [
                ['shield', 'auth.secure'],
                ['device', 'auth.oneDevice'],
              ] as const
            ).map(([icon, key]) => (
              <li key={key} className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/12 ring-1 ring-white/20">
                  <Icon name={icon} size={18} />
                </span>
                <span className="opacity-95">{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 opacity-85">
            {t('auth.poweredBy')}
            <Logo size={22} className="rounded-md ring-1 ring-white/25" />
            <Wordmark plain className="text-sm" />
          </span>
          <span className="opacity-60">© {new Date().getFullYear()}</span>
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex flex-col items-center justify-center px-5 py-16 safe-top pb-safe">
        <div className="absolute end-4 top-4 flex items-center gap-2 safe-top">
          <PrefControls />
        </div>

        <form
          onSubmit={onSubmit}
          className="w-full max-w-[400px] space-y-6 rounded-2xl border border-line bg-surface p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,.45)] sm:p-8"
        >
          <div className="flex flex-col items-center gap-3 text-center lg:hidden">
            <CompanyMark size={60} className="rounded-2xl" />
            <CompanyName className="text-xl font-bold" />
          </div>
          <div className="space-y-1 text-center lg:text-start">
            <h1 className="text-2xl font-bold">{t('auth.signIn')}</h1>
            <p className="text-sm text-muted">{t('auth.welcome')}</p>
          </div>

          {notice && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-[var(--radius-app)] border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm text-warning"
            >
              <Icon
                name={notice === 'idle' ? 'lock' : 'device'}
                size={18}
                className="mt-0.5 shrink-0"
              />
              {t(notice === 'idle' ? 'auth.idleSignedOut' : 'auth.signedInElsewhere')}
            </div>
          )}

          <div className="space-y-4">
            <Field label={t('auth.email')} icon="user">
              <input
                type="text"
                autoComplete="username"
                autoFocus
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${input} text-start`}
              />
            </Field>
            <Field
              label={t('auth.password')}
              icon="lock"
              end={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-canvas hover:text-fg"
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  title={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
                </button>
              }
            >
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${input} text-start`}
              />
            </Field>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--c-brand)]"
            />
            <span>
              <span className="font-medium">{t('auth.rememberDevice')}</span>
              {remember && (
                <span className="block text-xs text-muted">{t('auth.rememberHint')}</span>
              )}
            </span>
          </label>

          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-[var(--radius-app)] bg-destructive-soft px-3 py-2 text-sm text-destructive"
            >
              <Icon name="alert" size={16} className="shrink-0" />
              {error}
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            className="h-12 w-full text-base"
            loading={loading}
            disabled={!online}
          >
            {loading ? t('auth.signingIn') : t('auth.signIn')}
          </Button>

          <p
            className={`flex items-center justify-center gap-2 text-xs ${online ? 'text-muted' : 'text-destructive'}`}
          >
            <span
              className={`h-2 w-2 rounded-full ${online ? 'bg-positive' : 'bg-destructive'}`}
              aria-hidden="true"
            />
            {online ? t('auth.connectionHealthy') : t('auth.connectionUnreachable')}
          </p>
        </form>

        <div className="mt-6 w-full max-w-[400px] space-y-3">
          <GetApps compact />
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted lg:hidden">
            {t('auth.poweredBy')} <Logo size={16} /> <Wordmark className="text-xs" />
          </p>
        </div>
      </main>
    </div>
  );
}
