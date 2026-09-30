import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import type { WorkDraft } from '@skb/shared';
import { api } from './api';

/**
 * Work in progress survives an app update (owner decision 2026-09-30). Just before the new version
 * loads, every open screen that keeps drafts hands over what was typed; it is saved on the server
 * for this person (never on the device — CLAUDE.md rule 1). The new version opens at the same
 * address, the screen takes its draft back once and reads only what it still has: anything the
 * update removed is simply left out.
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

function restoring(): boolean {
  try {
    const at = Number(sessionStorage.getItem(RESTORE_FLAG));
    return at > 0 && Date.now() - at < 5 * 60_000;
  } catch {
    return false;
  }
}

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
 * Keep this screen's work through an app update. `snapshot` returns what to keep (null = nothing
 * worth keeping); `restore` gets it back after the update. Bump `version` when the shape changes.
 */
export function useWorkDraft<T>(
  version: number,
  snapshot: () => T | null,
  restore: (data: T) => void | Promise<void>,
): void {
  const { pathname, search } = useLocation();
  const key = pathname + search;
  const latest = useRef({ snapshot, restore });
  latest.current = { snapshot, restore };

  useEffect(() => {
    screens.set(key, () => {
      const data = latest.current.snapshot();
      return data == null
        ? null
        : ({ v: version, data, scrollY: window.scrollY } satisfies Saved<T>);
    });
    return () => {
      screens.delete(key);
    };
  }, [key, version]);

  useEffect(() => {
    if (!restoring()) return;
    let cancelled = false;
    void (async () => {
      const draft = await take(key);
      if (cancelled || !draft) return;
      let saved: Saved<T>;
      try {
        saved = JSON.parse(draft.data) as Saved<T>;
      } catch {
        return;
      }
      if (saved?.v !== version || saved.data == null) return;
      await latest.current.restore(saved.data);
      setTimeout(() => window.scrollTo({ top: saved.scrollY ?? 0 }), 300);
      window.dispatchEvent(new Event(RESTORED_EVENT));
      try {
        sessionStorage.removeItem(RESTORE_FLAG);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
