import type { MouseEvent } from 'react';
import { Icon } from '../Icon';
import { useT } from '../../lib/i18n';
import { desktopWindow } from '../../lib/desktop';

/**
 * Minimize and close for the Windows app, whose window has no title bar (owner, 2026-11-10).
 * Only inside that app; a right-click opens its window menu, as on a title bar.
 */
export function WindowControls({ className }: { className?: string }) {
  const { t } = useT();
  const app = desktopWindow();
  if (!app) return null;
  const menu = (e: MouseEvent) => {
    if (!app.menu) return;
    e.preventDefault();
    app.menu();
  };
  const base =
    'grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors focus-visible:outline-2';
  return (
    <div
      className={`flex shrink-0 items-center gap-0.5 ${className ?? ''}`}
      onContextMenu={menu}
      data-ui="window-controls"
    >
      <button
        type="button"
        onClick={() => app.minimize()}
        title={t('shell.minimize')}
        aria-label={t('shell.minimize')}
        className={`${base} hover:bg-surface-2 hover:text-fg`}
      >
        <Icon name="minimize" size={18} />
      </button>
      <button
        type="button"
        onClick={() => app.close()}
        title={t('shell.close')}
        aria-label={t('shell.close')}
        className={`${base} hover:bg-destructive hover:text-white`}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
