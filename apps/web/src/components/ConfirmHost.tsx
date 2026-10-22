import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { answerConfirm, useConfirmStore } from '../lib/confirm';

/**
 * Draws the in-app confirm box (see lib/confirm). Mounted once in the app. Enter confirms, Escape or
 * a click outside cancels; the confirm button is focused so a quick Enter works.
 */
export function ConfirmHost() {
  const { t } = useT();
  const current = useConfirmStore((s) => s.current);

  useEffect(() => {
    if (!current) return;
    (document.querySelector('[data-confirm-ok]') as HTMLElement | null)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answerConfirm(false);
      else if (e.key === 'Enter') answerConfirm(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current]);

  if (!current) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => answerConfirm(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={current.title ?? t('common.confirmTitle')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
              current.danger ? 'bg-destructive-soft text-destructive' : 'bg-brand-soft text-brand'
            }`}
          >
            <Icon name={current.danger && !current.warning ? 'trash' : 'alert'} size={20} />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-base font-semibold">{current.title ?? t('common.confirmTitle')}</h2>
            <p className="whitespace-pre-wrap break-words text-sm text-muted">{current.message}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => answerConfirm(false)}>
            {current.cancelText ?? t('common.cancel')}
          </Button>
          <Button
            data-confirm-ok
            variant={current.danger ? 'danger' : 'primary'}
            onClick={() => answerConfirm(true)}
          >
            {current.confirmText ?? t('common.confirmOk')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
