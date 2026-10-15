import type { AuthUser, LoginInput } from '@skb/shared';
import { getAccessToken, useAuth, type SessionNotice } from '../stores/auth';
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
  if (res.status === 401 && !_retried && path !== '/auth/refresh' && path !== '/auth/login') {
    if ((await codeOf(res)) === SIGNED_IN_ELSEWHERE) endSession('signedInElsewhere');
    else {
      const refreshed = await tryRefresh();
      if (refreshed) return request<T>(path, { ...options, _retried: true });
      if (useAuth.getState().status !== 'anonymous') endSession();
    }
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload.message ?? res.statusText, payload.code);
  }
  // 202/204 and any empty body (e.g. an accepted request) carry nothing to parse.
  if (res.status === 204 || res.status === 202) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
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
          if (res.status === 401 && (await codeOf(res)) === SIGNED_IN_ELSEWHERE)
            endSession('signedInElsewhere');
          return false;
        }
        const data = (await res.json()) as { user: AuthUser; accessToken: string };
        useAuth.getState().setSession(data.user, data.accessToken);
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
    else if (useAuth.getState().status !== 'anonymous') endSession();
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
): Promise<T> {
  const token = getAccessToken();
  const form = new FormData();
  form.append('file', file, 'photo');
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...branchHeader() },
    body: form,
  });
  if (res.status === 401 && !retried) {
    if ((await codeOf(res)) === SIGNED_IN_ELSEWHERE) endSession('signedInElsewhere');
    else if (await tryRefresh()) return upload(path, file, true, method);
    else if (useAuth.getState().status !== 'anonymous') endSession();
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

  async login(input: LoginInput): Promise<{ user: AuthUser; accessToken: string }> {
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
};

export { API_BASE };
