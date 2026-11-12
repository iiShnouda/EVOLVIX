import { ApiError, API_BASE } from './api';
import { getAccessToken } from '../stores/auth';

/** This build's number (vite.config.ts writes it into the code). */
declare const __APP_BUILD__: string;

export type ClientErrorKind = 'render' | 'error' | 'rejection';

/** At most this many reports from one opening of the app, each different error once. */
const MAX_REPORTS = 10;
const sent = new Set<string>();

/**
 * Tell the server about an error the app ran into on this device (owner, 2026-11-12), so the owner
 * sees it in the server's log: what went wrong, where in the code, the page (its address only, no
 * query), the app's build and the browser. Nothing the person was working on is sent; emails and
 * long numbers in the message are hidden. Only while signed in; never retried.
 */
export function reportClientError(kind: ClientErrorKind, error: unknown): void {
  try {
    const token = getAccessToken();
    if (!token || sent.size >= MAX_REPORTS) return;
    // A refused or failed request is already in the server's log with its request number.
    if (error instanceof ApiError) return;
    const message = scrub(
      error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? ''),
    ).slice(0, 500);
    if (!message || /ResizeObserver loop/i.test(message)) return;
    const stack = error instanceof Error && error.stack ? scrub(error.stack).slice(0, 4000) : '';
    const key = `${kind}|${message}`;
    if (sent.has(key)) return;
    sent.add(key);
    void fetch(`${API_BASE}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        kind,
        message,
        stack,
        route: window.location.pathname.slice(0, 200),
        version: typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : '',
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reporting must never cause an error of its own.
  }
}

function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***')
    .replace(/\d{6,}/g, '***')
    .replace(/[?#][^\s)]*/g, '');
}

/** Errors nobody caught and promises nobody waited for, reported once each. */
export function watchClientErrors(): void {
  window.addEventListener('error', (e) => {
    // Another site's script (an extension) is none of the app's business.
    if (e.filename && !e.filename.startsWith(window.location.origin)) return;
    reportClientError('error', e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => reportClientError('rejection', e.reason));
}
