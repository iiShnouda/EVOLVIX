import { create } from 'zustand';
import type { AuthUser } from '@skb/shared';

interface AuthState {
  user: AuthUser | null;
  /** Access token is kept in MEMORY ONLY — never localStorage — to limit XSS token theft. */
  accessToken: string | null;
  status: 'unknown' | 'authenticated' | 'anonymous';
  /** Why the last session ended, shown on the sign-in page (another device, or idle time-out). */
  notice: SessionNotice | null;
  setSession: (user: AuthUser, accessToken: string) => void;
  setAccessToken: (token: string) => void;
  clear: (notice?: SessionNotice) => void;
  setAnonymous: () => void;
}

export type SessionNotice = 'signedInElsewhere' | 'idle';

export const useAuth = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: 'unknown',
  notice: null,
  setSession: (user, accessToken) =>
    set({ user, accessToken, status: 'authenticated', notice: null }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: (notice) =>
    set({ user: null, accessToken: null, status: 'anonymous', notice: notice ?? null }),
  setAnonymous: () => set({ status: 'anonymous' }),
}));

/** Read the current access token outside React (for the api client). */
export const getAccessToken = (): string | null => useAuth.getState().accessToken;
