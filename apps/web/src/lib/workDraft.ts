import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { MAIN_TAB, useTab } from './tabs';
import { create } from 'zustand';
import type { WorkDraft } from '@skb/shared';
import { api } from './api';
import { useAuth } from '../stores/auth';

/**
 * Work in progress is never lost (owner decisions 2026-09-30 and 2026-10-01): an app update, a crash,
 * a closed window or signing in on another device all bring the person back to what they were
 * typing. Every open screen that keeps drafts saves what was typed every few seconds on the server
 * for this person (never on the device — CLAUDE.md rule 1). When the screen opens again (the app
 * reopens the last page after signing in) it takes its draft back once and reads only what it
 * still has: anything an update removed is simply left out.
 *
 * Leaving such a screen inside the app asks first, since what was typed is then thrown away.
 * Signing out forgets every draft (the server does it).
 */

interface Saved<T> {
  /** The screen's draft shape; a different one is dropped. */
  v: number;
  data: T;
  scrollY: number;
}

const screens = new Map<string, () => unknown>();
/** Set just before an update reload, so the next load looks for drafts (a UI flag, no data). */
const RESTORE_FLAG = 'skb.restoreWork';

/** Save the work of every open screen on the server. Resolves when done (failures are skipped). */
export async function saveOpenWork(): Promise<void> {
  const jobs = [...screens.entries()].map(async ([key, snapshot]) => {
    const saved = snapshot();
    if (saved == null) return;
    await api.put('/drafts', { key, data: JSON.stringify(saved) });
  });
  await Promise.allSettled(jobs);
  try {
    sessionStorage.setItem(RESTORE_FLAG, String(Date.now()));
  } catch {
    /* private mode: the work just isn't brought back */
  }
}

/** The question shown when leaving a screen with work on it (see LeavePrompt). */
interface LeaveState {
  ask: { stay: () => void; leave: () => void } | null;
}
export const useLeavePrompt = create<LeaveState>(() => ({ ask: null }));

export const signedIn = () => useAuth.getState().status === 'authenticated';

/**
 * Every open screen that keeps work, by its draft key, with its tab (see tabs.ts): one guard for
 * the whole app asks before the shown tab's page is left (a router keeps only one blocker).
 */
export const guards = new Map<string, { tab: string; pending: () => boolean; drop: () => void }>();
/** Whether a tab has work typed on it. */
export const tabHasWork = (tab: string) =>
  [...guards.values()].some((g) => g.tab === tab && g.pending());
/** Leave a tab's work: nothing is asked and its drafts go. */
export const dropTabWork = (tab: string) =>
  [...guards.values()].filter((g) => g.tab === tab).forEach((g) => g.drop());
const AUTOSAVE_MS = 3000;

/** One take per screen, shared by a screen opened twice at once (React's strict mode does that). */
const takes = new Map<string, Promise<WorkDraft | undefined>>();
function take(key: string): Promise<WorkDraft | undefined> {
  let p = takes.get(key);
  if (!p) {
    p = api.post<WorkDraft | undefined>('/drafts/take', { key }).catch(() => undefined);
    takes.set(key, p);
    setTimeout(() => takes.delete(key), 10_000);
  }
  return p;
}

/** A screen's work is back: the app shows a short note (see UpdateNotice). */
export const RESTORED_EVENT = 'skb:work-restored';

/**
 * Keep this screen's work (see above). `snapshot` returns what to keep (null = nothing worth
 * keeping); `restore` gets it back. Bump `version` when the shape changes. Call the returned
 * `finished()` once the work is saved, just before leaving: nothing is asked and the draft goes.
 */
export function useWorkDraft<T>(
  version: number,
  snapshot: () => T | null,
  restore: (data: T) => void | Promise<void>,
): { finished: () => void } {
  const { pathname, search } = useLocation();
  const tab = useTab().id;
  // A page open in two tabs keeps two drafts; the first tab keeps the keys it always had.
  const key = pathname + search + (tab === MAIN_TAB ? '' : `#${tab}`);
  const latest = useRef({ snapshot, restore });
  latest.current = { snapshot, restore };
  const done = useRef(false);
  const pack = (): Saved<T> | null => {
    const data = latest.current.snapshot();
    return data == null ? null : { v: version, data, scrollY: window.scrollY };
  };

  useEffect(() => {
    screens.set(key, () => (done.current ? null : pack()));
    return () => {
      screens.delete(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  // Bring the work back when the screen opens, then keep saving it while it is open.
  useEffect(() => {
    done.current = false;
    let cancelled = false;
    let last = '';
    let chain: Promise<unknown> = Promise.resolve();
    let restored = false;
    void (async () => {
      const draft = await take(key);
      if (!cancelled && draft) {
        try {
          const saved = JSON.parse(draft.data) as Saved<T>;
          if (saved?.v === version && saved.data != null) {
            await latest.current.restore(saved.data);
            setTimeout(() => window.scrollTo({ top: saved.scrollY ?? 0 }), 300);
            window.dispatchEvent(new Event(RESTORED_EVENT));
          }
        } catch {
          /* a bad draft is dropped */
        }
      }
      restored = true;
      try {
        sessionStorage.removeItem(RESTORE_FLAG);
      } catch {
        /* ignore */
      }
    })();
    const timer = window.setInterval(() => {
      if (!restored || done.current || !signedIn()) return;
      const saved = pack();
      const text = saved ? JSON.stringify({ ...saved, scrollY: 0 }) : '';
      if (text === last) return;
      last = text;
      const body = saved ? JSON.stringify(saved) : null;
      chain = chain.then(() =>
        (body ? api.put('/drafts', { key, data: body }) : api.post('/drafts/take', { key })).catch(
          () => undefined,
        ),
      );
    }, AUTOSAVE_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      // Left inside the app (saved, or the person chose to leave): the draft goes. Signed out or
      // taken by another device: it stays for next time (signing out clears it on the server).
      if (signedIn() && last !== '')
        chain = chain.then(() => api.post('/drafts/take', { key }).catch(() => undefined));
    };
    // Once per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Leaving the screen with work on it asks first (the app's one guard, in shell/Tabs.tsx).
  useEffect(() => {
    guards.set(key, {
      tab,
      pending: () => !done.current && signedIn() && latest.current.snapshot() != null,
      drop: () => {
        done.current = true;
      },
    });
    return () => {
      guards.delete(key);
    };
  }, [key, tab]);

  return {
    finished: () => {
      done.current = true;
    },
  };
}
