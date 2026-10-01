import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginSchema } from '@skb/shared';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { Logo, Wordmark } from '../components/Logo';
import { CompanyMark, CompanyName } from '../components/CompanyBadge';
import { PrefControls } from '../components/shell/PrefControls';
import { ConnectionBadge } from '../components/shell/ConnectionBadge';
import { useT } from '../lib/i18n';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../stores/auth';
import { GetApps } from '../components/GetApps';
import { useConnection } from '../stores/connection';

export function LoginPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const connection = useConnection((s) => s.state);

  const [email, setEmail] = useState('owner@skb.local');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password, rememberDevice: remember });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setLoading(true);
    try {
      const { user, accessToken } = await api.login(parsed.data);
      setSession(user, accessToken);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') {
        setError(t('auth.invalidCredentials'));
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('common.errorBody'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-2">
      {/* Brand panel (desktop) */}
      <div className="relative hidden flex-col justify-between bg-brand p-10 text-brand-fg lg:flex">
        <div className="flex items-center gap-3">
          <Logo size={48} className="rounded-[13px] ring-1 ring-white/25" />
          <Wordmark plain className="text-2xl" />
        </div>
        <div className="space-y-4">
          {/* The company's own name and logo (owner, 2026-10-01). */}
          <div className="flex items-center gap-4">
            <CompanyMark size={72} className="rounded-2xl ring-1 ring-white/25" />
            <CompanyName className="text-3xl font-bold leading-tight" />
          </div>
          <h2 className="max-w-sm text-2xl font-semibold leading-snug">{t('auth.welcome')}</h2>
          <ul className="space-y-2 text-sm opacity-90">
            {(['parties.theyOweUs', 'nav.inventory', 'nav.analytics'] as const).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <Icon name="check" size={16} /> {t(k)}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs opacity-70">© {new Date().getFullYear()} {t('app.name')}</p>
      </div>

      {/* Form panel */}
      <div className="relative flex items-center justify-center p-6 safe-top pb-safe">
        <div className="absolute end-4 top-4 flex items-center gap-2 safe-top">
          <ConnectionBadge />
          <PrefControls />
        </div>

        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
          <div className="space-y-3 lg:hidden">
            <div className="flex items-center gap-3">
              <Logo size={52} />
              <Wordmark className="text-2xl" />
            </div>
            <div className="flex items-center gap-2">
              <CompanyMark size={32} />
              <CompanyName className="text-base font-semibold" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t('auth.signIn')}</h1>
            <p className="mt-1 text-sm text-muted">{t('auth.welcome')}</p>
          </div>

          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t('auth.email')}</span>
              <input
                type="text"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t('auth.password')}</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand"
              />
            </label>
          </div>

          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-muted">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 accent-[var(--c-brand)]"
              />
              {t('auth.rememberDevice')}
            </label>
            <button type="button" className="font-medium text-brand hover:underline">
              {t('auth.forgotPassword')}
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-[var(--radius-app)] bg-destructive-soft px-3 py-2 text-sm text-destructive"
            >
              <Icon name="close" size={16} />
              {error}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" loading={loading}>
            {loading ? t('auth.signingIn') : t('auth.signIn')}
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
            <Icon name={connection === 'online' ? 'wifi' : 'wifiOff'} size={14} />
            {connection === 'online'
              ? t('auth.connectionHealthy')
              : t('auth.connectionUnreachable')}
          </p>
          <GetApps compact />
        </form>
      </div>
    </div>
  );
}
