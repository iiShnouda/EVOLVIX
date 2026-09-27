import { Icon } from './Icon';
import { Button } from './ui';
import { PrefControls } from './shell/PrefControls';
import { useT } from '../lib/i18n';

/**
 * Full-screen gate shown whenever the device cannot reach the company server. By design it
 * shows NO business data — the security model is that nothing is readable while offline.
 */
export function OfflineGate({ onRetry }: { onRetry: () => void }) {
  const { t } = useT();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas p-6 text-center safe-top pb-safe">
      <div className="absolute end-4 top-4 safe-top">
        <PrefControls />
      </div>
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-destructive-soft text-destructive">
        <Icon name="wifiOff" size={30} />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold">{t('offline.title')}</h1>
        <p className="text-sm text-muted">{t('offline.body')}</p>
      </div>
      <Button variant="primary" icon="wifi" onClick={onRetry}>
        {t('offline.reconnect')}
      </Button>
    </div>
  );
}
