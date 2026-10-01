import { Button } from './ui';
import { Sheet } from './Sheet';
import { useT } from '../lib/i18n';
import { useLeavePrompt } from '../lib/workDraft';

/** "You are leaving this page": what was typed on it is thrown away (owner, 2026-10-01). */
export function LeavePrompt() {
  const { t } = useT();
  const ask = useLeavePrompt((s) => s.ask);
  if (!ask) return null;
  return (
    <Sheet title={t('leave.title')} onClose={ask.stay} closeLabel={t('common.close')}>
      <div className="space-y-4">
        <p className="text-sm">{t('leave.body')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={ask.stay}>
            {t('leave.stay')}
          </Button>
          <Button variant="danger" onClick={ask.leave}>
            {t('leave.leave')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
