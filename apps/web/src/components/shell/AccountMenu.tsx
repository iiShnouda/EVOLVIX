import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../Icon';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';
import { useWorkBranch, useWorkBranchStore } from '../../stores/workBranch';
import { queryClient } from '../../lib/queryClient';
import { SHOW_COSTS_KEY, useMaySeeCosts } from '../../lib/can';
import { usePreferences } from '../../lib/queries';

export function AccountMenu() {
  const { t } = useT();
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const workBranch = useWorkBranch();
  const pickBranch = useWorkBranchStore((s) => s.pick);
  // Supply prices and profit show only when the person turns them on (owner, 2026-10-02).
  const maySeeCosts = useMaySeeCosts();
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
