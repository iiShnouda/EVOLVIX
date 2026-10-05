import { useEffect, type ReactNode } from 'react';
import { Button } from './ui';

/**
 * A form over the page: a bottom sheet on a phone, a centred panel on wider screens. Escape or a
 * tap outside closes it.
 */
export function Sheet({
  title,
  onClose,
  closeLabel,
  children,
  wide = false,
  fill = false,
  top = false,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
  /** true = a wider panel; 'full' = as wide as the screen allows (big tables). */
  wide?: boolean | 'full';
  /**
   * The panel keeps its height and only a part inside scrolls (owner, 2026-10-01: in the item
   * search only the list moves): the children get a column that fills the panel.
   */
  fill?: boolean;
  /** Over every other sheet (the print editor, opened from inside one). */
  top?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 ${top ? 'z-[60]' : 'z-50'} flex items-end justify-center bg-black/40 sm:items-center sm:p-4`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[92vh] w-full ${fill ? 'flex h-[92vh] flex-col overflow-hidden' : 'overflow-auto'} rounded-t-[var(--radius-app)] border border-line bg-surface p-4 shadow-xl sm:rounded-[var(--radius-app)] sm:p-5 ${wide === 'full' ? 'sm:max-w-6xl' : wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button
            variant="ghost"
            size="sm"
            icon="close"
            onClick={onClose}
            aria-label={closeLabel}
          />
        </div>
        {fill ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
      </div>
    </div>
  );
}
