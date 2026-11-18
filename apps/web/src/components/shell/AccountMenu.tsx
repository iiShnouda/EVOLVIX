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
import { usePreferences } from '../../lib/queries';
import { confirm } from '../../lib/confirm';
import { usePrefs } from '../../stores/prefs';
import { stepZoom, ZOOM_MAX, ZOOM_MIN } from '../../lib/zoom';

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
        className="flex items-center gap-2 rounded-full border border-line bg-surface p-1 pe-2.5 transition-colors hover:bg-surface-2 max-xs:pe-1"
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
        <Icon name="chevronDown" size={16} className="text-muted max-xs:hidden" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute end-0 z-40 mt-2 max-h-[calc(100dvh-5rem)] w-64 overflow-y-auto rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-pop)]"
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
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${showCosts ? 'start-[1.125rem]' : 'start-0.5'}`}
                />
              </span>
              <span className="min-w-0 flex-1">{t('costs.show')}</span>
            </button>
          )}
          <ZoomRow />
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
    </div>
  );
}

/**
 * The app's zoom (owner, 2026-11-18): smaller or bigger, laid out again for the screen (lib/zoom.ts).
 * Also Ctrl/⌘ with + − 0 on a computer; the phone's own pinch still works.
 */
function ZoomRow() {
  const { t } = useT();
  const zoom = usePrefs((s) => s.zoom);
  const setZoom = usePrefs((s) => s.setZoom);
  const btn =
    'grid h-9 w-9 place-items-center rounded-lg border border-line text-fg transition-colors hover:bg-surface-2 disabled:opacity-40';
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 text-sm"
      role="group"
      aria-label={t('zoom.label')}
    >
      <Icon name="search" size={18} className="text-muted" />
      <span className="min-w-0 flex-1">{t('zoom.label')}</span>
      <button
        type="button"
        className={btn}
        onClick={() => setZoom(stepZoom(zoom, -1))}
        disabled={zoom <= ZOOM_MIN}
        title={t('zoom.out')}
        aria-label={t('zoom.out')}
      >
        <Icon name="minimize" size={16} />
      </button>
      <button
        type="button"
        className="h-9 min-w-[3.25rem] rounded-lg px-1 text-center text-sm font-medium tnum transition-colors hover:bg-surface-2"
        onClick={() => setZoom(1)}
        title={t('zoom.reset')}
        aria-label={t('zoom.reset')}
        dir="ltr"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => setZoom(stepZoom(zoom, 1))}
        disabled={zoom >= ZOOM_MAX}
        title={t('zoom.in')}
        aria-label={t('zoom.in')}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
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
