import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { Button } from './ui';
import { Logo } from './Logo';
import { useT } from '../lib/i18n';
import { hideBootSplash } from '../lib/bootSplash';

/** Shown instead of a page that failed while drawing: start again, or go to the dashboard. */
export function CrashScreen() {
  const { t } = useT();
  const error = useRouteError();
  useEffect(() => console.error(error), [error]);
  useEffect(hideBootSplash, []);
  return (
    <div className="grid min-h-screen place-items-center bg-canvas p-4 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <Logo size={48} />
        <h1 className="text-lg font-semibold text-fg">{t('crash.title')}</h1>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>
            {t('crash.reload')}
          </Button>
          <Button variant="secondary" onClick={() => window.location.assign('/dashboard')}>
            {t('crash.home')}
          </Button>
        </div>
      </div>
    </div>
  );
}
