import { useEffect, useRef } from 'react';
import { api } from './api';
import { useAuth } from '../stores/auth';
import { usePrefs } from '../stores/prefs';

/** Activity that counts as "the person is here" and resets the idle clock. */
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/**
 * Sign out on its own after a stretch with no activity (owner, 2026-10-14: a device left open, or a
 * virus-hit machine, shouldn't keep a live session). The delay is a per-device preference (0 =
 * never). It only runs while signed in; the server session ends too, so nothing is left to reuse.
 */
export function useIdleLogout(): void {
  const status = useAuth((s) => s.status);
  const idleMinutes = usePrefs((s) => s.idleMinutes);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (status !== 'authenticated' || idleMinutes <= 0) return;
    const ms = idleMinutes * 60_000;

    const sign = () => {
      // Guard against a stray timer after the session already ended elsewhere.
      if (useAuth.getState().status === 'authenticated') void api.logout('idle');
    };
    const reset = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(sign, ms);
    };

    reset();
    for (const e of ACTIVITY) window.addEventListener(e, reset, { passive: true });
    // Coming back to a tab that sat idle in the background counts the time it was away.
    const onVisible = () => {
      if (document.visibilityState === 'visible') reset();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearTimeout(timer.current);
      for (const e of ACTIVITY) window.removeEventListener(e, reset);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, idleMinutes]);
}
