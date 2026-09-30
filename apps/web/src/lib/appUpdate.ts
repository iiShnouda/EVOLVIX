import { registerSW } from 'virtual:pwa-register';
import { queryClient } from './queryClient';
import { saveOpenWork } from './workDraft';

/**
 * The app updates itself soon after a new version is put on the server (owner decision
 * 2026-09-30), for every person on every device. It looks for one every minute and whenever the
 * app comes back to the front. When one is there it waits until nothing is being saved and no
 * window (sheet) is open, keeps the open screens' work (see workDraft), and reloads at the same
 * place in the new version.
 *
 * Two ways a new version is seen: the service worker (installed app, HTTPS) finds a new app shell,
 * or — where there is no service worker (plain HTTP on the office network, development) — the
 * build number in /version.json differs from this one's.
 */

/** This build's number (vite.config.ts writes it into the code and into /version.json). */
declare const __APP_BUILD__: string;

export const UPDATING_EVENT = 'skb:updating';
const CHECK_EVERY = 60_000;
/** After this long, update even if a sheet is still open (its typing is the only thing lost). */
const WAIT_AT_MOST = 10 * 60_000;

let started = false;
let applying = false;

function busy(): boolean {
  return queryClient.isMutating() > 0 || !!document.querySelector('[role="dialog"]');
}

async function whenIdle(): Promise<void> {
  const since = Date.now();
  while (busy() && Date.now() - since < WAIT_AT_MOST) {
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Keep the work, then load the new version (`reload` swaps the service worker or reloads). */
async function apply(reload: () => Promise<void> | void): Promise<void> {
  if (applying) return;
  applying = true;
  await whenIdle();
  window.dispatchEvent(new Event(UPDATING_EVENT));
  await saveOpenWork();
  await reload();
  // If the new service worker didn't take over and reload by itself, reload anyway.
  setTimeout(() => window.location.reload(), 4000);
}

export function startAppUpdates(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  let registration: ServiceWorkerRegistration | undefined;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => void apply(() => updateSW(true)),
    onRegisteredSW: (_url, reg) => {
      registration = reg;
    },
  });

  const check = async () => {
    if (applying) return;
    // With a service worker the new shell must come through it (it serves the cached one).
    if (registration && navigator.serviceWorker?.controller) {
      await registration.update().catch(() => undefined);
      return;
    }
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { build } = (await res.json()) as { build?: string };
      if (build && build !== __APP_BUILD__) void apply(() => window.location.reload());
    } catch {
      /* offline: try again later */
    }
  };

  setInterval(() => void check(), CHECK_EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  window.addEventListener('focus', () => void check());
}
