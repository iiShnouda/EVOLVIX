import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../Icon';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';

export function AccountMenu() {
  const { t } = useT();
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
          <span className="block text-xs leading-tight text-muted">{t(`role.${user.role}`)}</span>
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
              <span>{t('auth.activeBranch')}</span>
            </div>
          </div>
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
