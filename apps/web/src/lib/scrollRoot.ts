/**
 * Where the page scrolls (owner, 2026-10-14): on desktop and tablet the content scrolls inside the
 * main area (marked `data-scroll-root`), not the browser window, so there is one scroll on the
 * inside and no outer bar. On a phone the window scrolls as before. These helpers read and set the
 * right one, so per-tab scroll memory and scroll-to-top work whichever it is.
 */
export function scrollRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-scroll-root]');
}

export function getScroll(): number {
  const el = scrollRoot();
  return el ? el.scrollTop : window.scrollY;
}

export function setScroll(top: number): void {
  const el = scrollRoot();
  if (el) el.scrollTo({ top });
  else window.scrollTo({ top });
}
