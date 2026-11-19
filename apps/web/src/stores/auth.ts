import { create } from 'zustand';
import type { AuthUser } from '@skb/shared';

/** A locked screen (owner, 2026-11-18): whose it is, and whether their PIN may open it. */
export interface LockInfo {
  name: string;
  pin: boolean;
}

interface AuthState {
  user: AuthUser | null;
  /** Access token is kept in MEMORY ONLY — never localStorage — to limit XSS token theft. */
  accessToken: string | null;
  /**
   * 'locked': the idle time locked a remembered device. Nothing is held (no user, no token, no
   * data); only the server opens it again, with the password or PIN.
   */
  status: 'unknown' | 'authenticated' | 'anonymous' | 'locked';
  /** This device was remembered at sign-in (so idle locks it instead of signing out). */
  remembered: boolean;
  lock: LockInfo | null;
  /** Why the last session ended, shown on the sign-in page (another device, or idle time-out). */
  notice: SessionNotice | null;
  setSession: (user: AuthUser, accessToken: string, remembered?: boolean) => void;
  setAccessToken: (token: string) => void;
  clear: (notice?: SessionNotice) => void;
  setAnonymous: () => void;
  setLocked: (lock: LockInfo) => void;
}

export type SessionNotice = 'signedInElsewhere' | 'idle' | 'unlockFailed';

export const useAuth = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: 'unknown',
  remembered: false,
  lock: null,
  notice: null,
  setSession: (user, accessToken, remembered) =>
    set((s) => ({
      user,
      accessToken,
      status: 'authenticated',
      notice: null,
      lock: null,
      remembered: remembered ?? s.remembered,
    })),
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: (notice) =>
    set({
      user: null,
      accessToken: null,
      status: 'anonymous',
      notice: notice ?? null,
      lock: null,
      remembered: false,
    }),
  setAnonymous: () => set((s) => (s.status === 'locked' ? s : { status: 'anonymous' })),
  setLocked: (lock) =>
    set({ user: null, accessToken: null, status: 'locked', lock, notice: null, remembered: true }),
}));

/** Read the current access token outside React (for the api client). */
export const getAccessToken = (): string | null => useAuth.getState().accessToken;
