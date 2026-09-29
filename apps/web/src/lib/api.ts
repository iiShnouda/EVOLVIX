import type { AuthUser, LoginInput } from '@skb/shared';
import { getAccessToken, useAuth } from '../stores/auth';
import { usePrefs } from '../stores/prefs';

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
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Transparent one-shot refresh on 401 (expired access token).
  if (res.status === 401 && !_retried && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...options, _retried: true });
    useAuth.getState().clear();
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload.message ?? res.statusText, payload.code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
        if (!res.ok) return false;
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
): Promise<{ name: string; bytes: Uint8Array }> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !retried) {
    if (await tryRefresh()) return download(path, body, true);
    useAuth.getState().clear();
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
  return { name: decodeURIComponent(name), bytes: new Uint8Array(await res.arrayBuffer()) };
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  download,
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),

  async login(input: LoginInput): Promise<{ user: AuthUser; accessToken: string }> {
    return request('/auth/login', { method: 'POST', body: input });
  },
  async me(): Promise<AuthUser> {
    return request('/auth/me', { method: 'GET' });
  },
  async refreshSession(): Promise<boolean> {
    return tryRefresh();
  },
  async logout(): Promise<void> {
    await request('/auth/logout', { method: 'POST' }).catch(() => undefined);
    useAuth.getState().clear();
  },
};

export { API_BASE };
