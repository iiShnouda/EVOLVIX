import { createTranslator, type AuthUser, type LoginInput } from '@skb/shared';
import { confirm } from './confirm';
import { errorText } from './errors';
import { getAccessToken, useAuth, type LockInfo, type SessionNotice } from '../stores/auth';
import { usePrefs } from '../stores/prefs';
import { getWorkBranch, useWorkBranchStore } from '../stores/workBranch';
import { queryClient } from './queryClient';

// Default to a relative "/api" (same-origin) so the API can serve the web app as one unit.
// In split-server dev the Vite proxy forwards /api to the API; in a split deploy set VITE_API_URL.
const API_BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    /** The server's number for the request, to quote to the owner when it failed on the server. */
    readonly requestId?: string,
    /** The rest of the server's answer (e.g. how many tries are left). */
    readonly payload?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Internal: prevents infinite refresh recursion. */
  _retried?: boolean;
}

/** The branch new documents go to (the server checks the person may use it). */
function branchHeader(): Record<string, string> {
  const branch = getWorkBranch();
  return branch ? { 'X-Branch': branch } : {};
}

/** The server ends a session when the same account signs in on another device. */
const SIGNED_IN_ELSEWHERE = 'SIGNED_IN_ELSEWHERE';

/**
 * The session is over: forget the token and everything read with it (nothing of the business is
 * kept on the device), and say why on the sign-in page when another device took the account.
 */
function endSession(notice?: SessionNotice): void {
  queryClient.clear();
  useAuth.getState().clear(notice);
}

/**
 * The screen locked (owner, 2026-11-18): forget the token and everything read with it, as when
 * signing out, but keep the session on the server for the password or PIN to open. Other tabs of the
 * app lock too.
 */
function lockSession(lock: LockInfo, tell = true): void {
  queryClient.clear();
  useAuth.getState().setLocked(lock);
  if (tell) lockChannel?.postMessage(lock);
}

/** The app's other tabs in this browser: one locking locks them all. */
const lockChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('skb-lock');
if (lockChannel)
  lockChannel.onmessage = (e: MessageEvent<LockInfo>) => {
    if (useAuth.getState().status === 'authenticated' && typeof e.data?.name === 'string')
      lockSession({ name: e.data.name, pin: !!e.data.pin }, false);
  };

/** Answers that a refresh can't help (signing in, unlocking). */
const NO_REFRESH = ['/auth/refresh', '/auth/login', '/auth/unlock', '/auth/lock/end'];

/** An access token refused because the screen is locked: the lock screen comes up. */
const LOCKED = 'LOCKED';

async function codeOf(res: Response): Promise<string | undefined> {
  const payload = (await res
    .clone()
    .json()
    .catch(() => ({}))) as { code?: string };
  return payload.code;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, _retried, headers, ...rest } = options;
  const token = getAccessToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    // Send the refresh cookie for auth endpoints; harmless elsewhere.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      // Names of branches, warehouses, items… come back in the screen language.
      'Accept-Language': usePrefs.getState().locale,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...branchHeader(),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Transparent one-shot refresh on 401 (expired access token).
  if (res.status === 401 && !_retried && !NO_REFRESH.includes(path)) {
    if ((await codeOf(res)) === SIGNED_IN_ELSEWHERE) endSession('signedInElsewhere');
    else {
      const refreshed = await tryRefresh();
      if (refreshed) return request<T>(path, { ...options, _retried: true });
      if (useAuth.getState().status === 'authenticated') endSession();
    }
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const error = new ApiError(
      res.status,
      payload.message ?? res.statusText,
      payload.code,
      payload.requestId ?? res.headers.get('X-Request-Id') ?? undefined,
      payload,
    );
    // A rule the owner may go past (owner, 2026-10-22): warn them what it is, and only if they
    // choose to go on, send it again saying so. Everyone else just gets the refusal.
    if (res.headers.get(OWNER_CAN_OVERRIDE) === '1' && !hasOverride(headers)) {
      const t = createTranslator(usePrefs.getState().locale);
      const go = await confirm({
        title: t('owner.warnTitle'),
        message: `${errorText(t, error)}\n${t('owner.warnAsk')}`,
        confirmText: t('owner.goOn'),
        danger: true,
        warning: true,
      });
      if (go)
        return request<T>(path, {
          ...options,
          headers: { ...(headers as Record<string, string> | undefined), [OWNER_OVERRIDE]: '1' },
        });
    }
    throw error;
  }
  // 202/204 and any empty body (e.g. an accepted request) carry nothing to parse.
  if (res.status === 204 || res.status === 202) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The owner confirms going past a rule; the server says when a refusal is one they may pass. */
const OWNER_OVERRIDE = 'X-Owner-Override';
const OWNER_CAN_OVERRIDE = 'X-Owner-Can-Override';

function hasOverride(headers: HeadersInit | undefined): boolean {
  return !!headers && (headers as Record<string, string>)[OWNER_OVERRIDE] === '1';
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Partial<LockInfo> & {
            code?: string;
          };
          if (res.status === 401 && body.code === SIGNED_IN_ELSEWHERE)
            endSession('signedInElsewhere');
          else if (res.status === 401 && body.code === LOCKED)
            lockSession({ name: body.name ?? '', pin: !!body.pin });
          return false;
        }
        const data = (await res.json()) as {
          user: AuthUser;
          accessToken: string;
          remembered?: boolean;
        };
        useAuth.getState().setSession(data.user, data.accessToken, data.remembered);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/** A file from the server (e.g. a backup): GET, or POST with a JSON body. Held only in memory. */
async function download(
  path: string,
  body?: unknown,
  retried = false,
): Promise<{ name: string; type: string; bytes: Uint8Array }> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...branchHeader(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !retried) {
    if ((await codeOf(res)) === SIGNED_IN_ELSEWHERE) endSession('signedInElsewhere');
    else if (await tryRefresh()) return download(path, body, true);
    else if (useAuth.getState().status === 'authenticated') endSession();
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload.message ?? res.statusText, payload.code);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const name =
    /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ??
    /filename="?([^";]+)"?/i.exec(disposition)?.[1] ??
    'download';
  return {
    name: decodeURIComponent(name),
    type: res.headers.get('content-type') ?? '',
    bytes: new Uint8Array(await res.arrayBuffer()),
  };
}

/** Send one file (multipart, field "file") with PUT (or POST); the reply is JSON. */
async function upload<T>(
  path: string,
  file: Blob,
  retried = false,
  method: 'PUT' | 'POST' = 'PUT',
  name = 'photo',
): Promise<T> {
  const token = getAccessToken();
  const form = new FormData();
  form.append('file', file, name);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...branchHeader() },
    body: form,
  });
  if (res.status === 401 && !retried) {
    if ((await codeOf(res)) === SIGNED_IN_ELSEWHERE) endSession('signedInElsewhere');
    else if (await tryRefresh()) return upload(path, file, true, method, name);
    else if (useAuth.getState().status === 'authenticated') endSession();
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload.message ?? res.statusText, payload.code);
  }
  return (await res.json()) as T;
}

/** End the session on the server, forget this person's working branch, and clear the device. */
async function signOut(path: string, notice?: SessionNotice): Promise<void> {
  await request(path, { method: 'POST' }).catch(() => undefined);
  forgetDevice(notice);
}

/** This device is signed out (the server already ended it): forget the working branch and clear. */
function forgetDevice(notice?: SessionNotice): void {
  const user = useAuth.getState().user;
  if (user)
    useWorkBranchStore.setState((s) => {
      const byUser = { ...s.byUser };
      delete byUser[user.id];
      return { byUser };
    });
  endSession(notice);
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  download,
  upload,
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  async login(
    input: LoginInput,
  ): Promise<{ user: AuthUser; accessToken: string; remembered?: boolean }> {
    return request('/auth/login', { method: 'POST', body: input });
  },
  async me(): Promise<AuthUser> {
    return request('/auth/me', { method: 'GET' });
  },
  async refreshSession(): Promise<boolean> {
    return tryRefresh();
  },
  /** Signing out starts everything afresh: the server forgets the last page and drafts. */
  logout: (notice?: SessionNotice) => signOut('/auth/logout', notice),
  /** Sign the account out of every device (lost or virus-hit device); this one included. */
  logoutAll: () => signOut('/auth/logout-all'),
  /**
   * The app sat idle (or the person locks it): the server locks a remembered device (the lock
   * screen comes up, nothing is kept) or signs any other one out.
   */
  async lock(): Promise<void> {
    if (useAuth.getState().status !== 'authenticated') return;
    const res = await request<{ locked: boolean; name?: string; pin?: boolean }>('/auth/lock', {
      method: 'POST',
    }).catch(() => null);
    if (res?.locked) lockSession({ name: res.name ?? '', pin: !!res.pin });
    // Refreshing on the way found it locked already.
    else if (useAuth.getState().status === 'locked') return;
    else if (res) forgetDevice('idle');
    else await signOut('/auth/logout', 'idle');
  },
  /** Open the locked screen: the server checks the password or PIN. Throws its refusal. */
  async unlock(secret: { password: string } | { pin: string }): Promise<void> {
    const data = await request<{ user: AuthUser; accessToken: string; remembered?: boolean }>(
      '/auth/unlock',
      { method: 'POST', body: secret },
    );
    useAuth.getState().setSession(data.user, data.accessToken, data.remembered);
  },
  /** "Sign out" on the lock screen: the device is signed out without unlocking it. */
  async endLocked(notice?: SessionNotice): Promise<void> {
    await request('/auth/lock/end', { method: 'POST' }).catch(() => undefined);
    endSession(notice);
  },
};

export { API_BASE };
