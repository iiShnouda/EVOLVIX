import { useNavigate } from 'react-router-dom';
import { useT } from '../lib/i18n';
import { useHomePath } from '../lib/home';
import { Button } from './ui';
import { Icon } from './Icon';

/** A page opened by its address without permission (owner, 2026-10-24): said once, plainly. */
export function NotAllowedPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const home = useHomePath();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-faint">
        <Icon name="key" size={26} />
      </div>
      <h1 className="text-lg font-semibold">{t('notAllowed.title')}</h1>
      <Button variant="secondary" onClick={() => navigate(home, { replace: true })}>
        {t('notAllowed.home')}
      </Button>
    </div>
  );
}
