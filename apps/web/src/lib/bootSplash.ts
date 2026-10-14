import { useEffect } from 'react';

/**
 * One start-up screen (owner, 2026-10-14: "there are two loading screens"): the animated Evolvix
 * splash in index.html stays on top until the app has something real to show — the sign-in page,
 * the app itself, or "not connected" — and then fades away. There is no second React splash.
 */
export function hideBootSplash(): void {
  const boot = document.getElementById('boot');
  if (!boot || boot.classList.contains('leaving')) return;
  boot.classList.add('leaving');
  window.setTimeout(() => boot.remove(), 250);
}

/** Mount where a real screen renders: the splash goes away as soon as it appears. */
export function BootDone(): null {
  useEffect(hideBootSplash, []);
  return null;
}
