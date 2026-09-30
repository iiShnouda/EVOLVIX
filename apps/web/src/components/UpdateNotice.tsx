import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { UPDATING_EVENT } from '../lib/appUpdate';
import { RESTORED_EVENT } from '../lib/workDraft';

/** A short note while the app updates itself, and when a screen's work is back after it. */
export function UpdateNotice() {
  const { t } = useT();
  const [state, setState] = useState<'updating' | 'restored' | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updating = () => setState('updating');
    const restored = () => {
      setState('restored');
      clearTimeout(timer);
      timer = setTimeout(() => setState(null), 5000);
    };
    window.addEventListener(UPDATING_EVENT, updating);
    window.addEventListener(RESTORED_EVENT, restored);
    return () => {
      window.removeEventListener(UPDATING_EVENT, updating);
      window.removeEventListener(RESTORED_EVENT, restored);
      clearTimeout(timer);
    };
  }, []);

  if (!state) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-20 z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm shadow-[var(--shadow-card)] md:bottom-6"
    >
      <Icon name={state === 'updating' ? 'download' : 'check'} size={16} className="text-brand" />
      {t(state === 'updating' ? 'update.saving' : 'update.restored')}
    </div>
  );
}
