import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../Icon';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';
import { useWorkBranch, useWorkBranchStore } from '../../stores/workBranch';
import { queryClient } from '../../lib/queryClient';
import { SHOW_COSTS_KEY, useMaySeeProfit } from '../../lib/can';
import { useCompanySettings, usePreferences } from '../../lib/queries';
import { confirm } from '../../lib/confirm';
import { Sheet } from '../Sheet';
import { Button } from '../ui';
import { ApiError } from '../../lib/api';
import { errorText } from '../../lib/errors';

export function AccountMenu() {
  const { t } = useT();
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const workBranch = useWorkBranch();
  const pickBranch = useWorkBranchStore((s) => s.pick);
  // Profit shows only when the person turns it on (owner, 2026-10-02; profit only since 2026-10-17).
  const maySeeCosts = useMaySeeProfit();
  const prefs = usePreferences();
  const showCosts = prefs.data?.[SHOW_COSTS_KEY] === '1';
  // Locking by hand (owner, 2026-11-18): on a remembered device, when idle locks rather than signs out.
  const remembered = useAuth((s) => s.remembered);
  const settings = useCompanySettings().data;
  const canLock = remembered && (settings?.idleAction ?? 'LOCK') === 'LOCK';
  const [pinOpen, setPinOpen] = useState(false);
  const toggleCosts = () => {
    const value = showCosts ? '' : '1';
    queryClient.setQueryData<Record<string, string>>(['preferences'], (old) => ({
      ...(old ?? {}),
      [SHOW_COSTS_KEY]: value,
    }));
    void api.put('/preferences', { key: SHOW_COSTS_KEY, value }).catch(() => undefined);
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;
  const initials = user.fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // People who work in more than one branch pick where new documents go.
  const branches = (user.branches ?? []).filter((b) => b.isActive || b.id === workBranch);
  const current = branches.find((b) => b.id === workBranch);
  const switchTo = (branchId: string) => {
    if (branchId === workBranch) return;
    pickBranch(user.id, branchId);
    setOpen(false);
    void queryClient.invalidateQueries();
  };

  const logout = async () => {
    await api.logout();
    navigate('/login', { replace: true });
  };

  const logoutEverywhere = async () => {
    if (!(await confirm({ message: t('auth.signOutAllConfirm'), danger: true }))) return;
    await api.logoutAll();
    navigate('/login', { replace: true });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-line bg-surface p-1 pe-2.5 transition-colors hover:bg-surface-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-fg">
          {initials}
        </span>
        <span className="hidden text-start sm:block">
          <span className="block text-sm font-medium leading-tight">{user.fullName}</span>
          <span className="block text-xs leading-tight text-muted">
            {user.roleName ?? t(`role.${user.role}`)}
            {branches.length > 1 && current && (
              <>
                {' · '}
                <bdi>{current.name}</bdi>
              </>
            )}
          </span>
        </span>
        <Icon name="chevronDown" size={16} className="text-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute end-0 z-40 mt-2 w-60 overflow-hidden rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-pop)]"
        >
          <div className="border-b border-line p-3">
            <p className="text-sm font-semibold">{user.fullName}</p>
            <p className="text-xs text-muted">{user.email}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted">
              <Icon name="building" size={14} />
              <span>
                {branches.length > 1 ? t('branch.working') : t('auth.activeBranch')}
                {current && (
                  <>
                    {': '}
                    <bdi>{current.name}</bdi>
                  </>
                )}
              </span>
            </div>
            <DeviceStatus />
          </div>
          {branches.length > 1 && (
            <div
              className="border-b border-line py-1"
              role="group"
              aria-label={t('branch.working')}
            >
              {branches.map((b) => (
                <button
                  key={b.id}
                  role="menuitemradio"
                  aria-checked={b.id === workBranch}
                  onClick={() => switchTo(b.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm transition-colors hover:bg-surface-2"
                >
                  <span className="grid w-4 place-items-center text-brand">
                    {b.id === workBranch && <Icon name="check" size={16} />}
                  </span>
                  <bdi className="min-w-0 flex-1 truncate">{b.name}</bdi>
                </button>
              ))}
            </div>
          )}
          {maySeeCosts && (
            <button
              role="menuitemcheckbox"
              aria-checked={showCosts}
              onClick={toggleCosts}
              className="flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-start text-sm transition-colors hover:bg-surface-2"
            >
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${showCosts ? 'bg-brand' : 'bg-line'}`}
                aria-hidden
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${showCosts ? 'start-[18px]' : 'start-0.5'}`}
                />
              </span>
              <span className="min-w-0 flex-1">{t('costs.show')}</span>
            </button>
          )}
          {canLock && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void api.lock();
              }}
              className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-sm transition-colors hover:bg-surface-2"
            >
              <Icon name="lock" size={18} className="text-muted" />
              <span className="min-w-0 flex-1 text-start">{t('lock.now')}</span>
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setPinOpen(true);
            }}
            className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-sm transition-colors hover:bg-surface-2"
          >
            <Icon name="key" size={18} className="text-muted" />
            <span className="min-w-0 flex-1 text-start">{t('pin.title')}</span>
          </button>
          <button
            role="menuitem"
            onClick={logoutEverywhere}
            className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-sm transition-colors hover:bg-surface-2"
          >
            <Icon name="shield" size={18} className="text-muted" />
            <span className="min-w-0 flex-1 text-start">{t('auth.signOutAll')}</span>
          </button>
          <button
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-destructive transition-colors hover:bg-surface-2"
          >
            <Icon name="logout" size={18} />
            {t('auth.signOut')}
          </button>
        </div>
      )}
      {pinOpen && <PinSheet onClose={() => setPinOpen(false)} />}
    </div>
  );
}

const pinBox =
  'h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand';

/**
 * One's own PIN for the lock screen (owner, 2026-11-18): 4–6 digits, kept hashed on the server, set
 * or changed with the password; or removed.
 */
function PinSheet({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const state = useQuery({
    queryKey: ['auth', 'pin'],
    queryFn: () => api.get<{ hasPin: boolean; allowed: boolean }>('/auth/pin'),
  });
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const run = async (action: () => Promise<unknown>, saved = true) => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await action();
      setPin('');
      setPassword('');
      setDone(saved);
      await state.refetch();
    } catch (e) {
      setError(e instanceof ApiError ? errorText(t, e) : t('error.generic'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={t('pin.title')} onClose={onClose} closeLabel={t('common.close')}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('pin.hint')}</p>
        {state.data && !state.data.allowed && (
          <p className="text-sm text-warning">{t('pin.off')}</p>
        )}
        {state.data && (
          <p className="text-sm font-medium">{t(state.data.hasPin ? 'pin.has' : 'pin.none')}</p>
        )}
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('pin.new')}</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            dir="ltr"
            className={`${pinBox} tnum tracking-[0.3em]`}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('pin.password')}</span>
          <input
            type="password"
            autoComplete="current-password"
            dir="ltr"
            className={pinBox}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {done && <p className="text-sm text-positive">{t('pin.saved')}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {state.data?.hasPin && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => api.del('/auth/pin'), false)}
            >
              {t('pin.clear')}
            </Button>
          )}
          <Button
            icon="check"
            loading={busy}
            disabled={pin.length < 4 || !password}
            onClick={() => void run(() => api.put('/auth/pin', { pin, password }))}
          >
            {t('pin.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Sign out on its own after a stretch of no use (owner, 2026-10-14). Kept on this device. */
interface DevicesInfo {
  thisKind: 'MOBILE' | 'DESKTOP';
  mobile: { signedIn: boolean; online: boolean };
  desktop: { signedIn: boolean; online: boolean };
}

/**
 * The person's own two devices (owner, 2026-10-12): a phone and a computer, both usable at once, and
 * whether each is connected right now — so they can tell if the other device is running. Refreshed
 * every little while while the menu is open.
 */
function DeviceStatus() {
  const { t } = useT();
  const q = useQuery({
    queryKey: ['auth', 'devices'],
    queryFn: () => api.get<DevicesInfo>('/auth/devices'),
    refetchInterval: 20000,
    staleTime: 10000,
  });
  const d = q.data;
  if (!d) return null;
  const row = (kind: 'MOBILE' | 'DESKTOP', label: string) => {
    const s = kind === 'MOBILE' ? d.mobile : d.desktop;
    const state = s.online
      ? 'devices.online'
      : s.signedIn
        ? 'devices.offline'
        : 'devices.signedOut';
    return (
      <div key={kind} className="flex items-center gap-2">
        <Icon name="device" size={14} />
        <span className="flex-1">
          {label}
          {d.thisKind === kind && ` · ${t('devices.thisOne')}`}
        </span>
        <span className={`inline-flex items-center gap-1 ${s.online ? 'text-positive' : ''}`}>
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              s.online ? 'bg-positive' : s.signedIn ? 'bg-warning' : 'bg-surface-2'
            }`}
          />
          {t(state as 'devices.online')}
        </span>
      </div>
    );
  };
  return (
    <div className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-muted">
      {row('MOBILE', t('devices.phone'))}
      {row('DESKTOP', t('devices.computer'))}
    </div>
  );
}
