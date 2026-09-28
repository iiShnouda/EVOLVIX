import { create } from 'zustand';
import type { AuthUser } from '@skb/shared';

interface AuthState {
  user: AuthUser | null;
  /** Access token is kept in MEMORY ONLY — never localStorage — to limit XSS token theft. */
  accessToken: string | null;
  status: 'unknown' | 'authenticated' | 'anonymous';
  setSession: (user: AuthUser, accessToken: string) => void;
  setAccessToken: (token: string) => void;
  clear: () => void;
  setAnonymous: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: 'unknown',
  setSession: (user, accessToken) => set({ user, accessToken, status: 'authenticated' }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ user: null, accessToken: null, status: 'anonymous' }),
  setAnonymous: () => set({ status: 'anonymous' }),
}));

/** Read the current access token outside React (for the api client). */
export const getAccessToken = (): string | null => useAuth.getState().accessToken;
