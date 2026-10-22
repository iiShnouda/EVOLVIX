import { create } from 'zustand';

/**
 * An in-app confirm box (owner, 2026-10-12: a nicer dialog than the browser's "<host> says …").
 * Call `confirm(...)` and await the answer; the dialog is drawn once by `<ConfirmHost/>` in the app
 * shell. Pass a ready-made (translated) message, or an object for a title and custom buttons.
 */
export interface ConfirmOptions {
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  /** A destructive action (delete): the confirm button is red. */
  danger?: boolean;
  /** A warning rather than a delete: the warning sign instead of the bin. */
  warning?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface ConfirmStore {
  current: Pending | null;
}

export const useConfirmStore = create<ConfirmStore>(() => ({ current: null }));

/** Ask the person to confirm; resolves true when they accept, false when they cancel or dismiss. */
export function confirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === 'string' ? { message: options } : options;
  return new Promise<boolean>((resolve) => {
    // A second request supersedes the first (the first is treated as cancelled).
    const existing = useConfirmStore.getState().current;
    existing?.resolve(false);
    useConfirmStore.setState({ current: { ...opts, resolve } });
  });
}

/** Close the dialog with the person's answer (used by the host). */
export function answerConfirm(ok: boolean): void {
  const current = useConfirmStore.getState().current;
  useConfirmStore.setState({ current: null });
  current?.resolve(ok);
}
