/**
 * The Windows app (apps/windows, WebView2) has no title bar of its own (owner, 2026-11-10: "remove
 * minimize and maximize and put something inside the program to close it or put it in the
 * taskbar"): it defines `window.SKBDesktop` in every page it opens, and the page shows its
 * minimize / close buttons. Older copies of the app don't define it, so then nothing shows.
 */
export interface DesktopWindow {
  minimize(): void;
  /** Asks first, as the app always does: exit, exit and sign out, or stay. */
  close(): void;
  /** The window menu (server address…) at the mouse. */
  menu?(): void;
}

export function desktopWindow(): DesktopWindow | undefined {
  if (typeof window === 'undefined') return undefined;
  const app = (window as unknown as { SKBDesktop?: Partial<DesktopWindow> }).SKBDesktop;
  return app && typeof app.minimize === 'function' && typeof app.close === 'function'
    ? (app as DesktopWindow)
    : undefined;
}
