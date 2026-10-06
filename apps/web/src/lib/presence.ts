import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api';
import { getAccessToken, useAuth } from '../stores/auth';

/**
 * Live presence over the server's SignalR hub (`/hubs/presence`), spoken directly in its JSON
 * protocol over a WebSocket — no client library needed. Every signed-in window reports the
 * screen it shows and, while its person is using it, that they're still there. Only the fact
 * that something changed comes back (to people who may see presence); the list itself is read
 * from `GET /api/presence`. Nothing is kept on the device.
 */

const RS = '\u001e';
const HUB = `${import.meta.env.VITE_API_URL ?? ''}/hubs/presence`;
const listeners = new Set<() => void>();

const bell = new Set<() => void>();
const chat = new Set<(conversationId: string) => void>();

/** Run `fn` when a conversation of the staff chat changes ('' = the person's own chat state). */
export function onChat(fn: (conversationId: string) => void): () => void {
  chat.add(fn);
  return () => {
    chat.delete(fn);
  };
}

/** Run `fn` when the server says this person's bell has something new. */
export function onNotify(fn: () => void): () => void {
  bell.add(fn);
  return () => {
    bell.delete(fn);
  };
}

/** Run `fn` when someone comes online, goes offline or changes screen. */
export function onPresenceChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The screen a path shows: its first segment, as in the navigation keys. */
export const viewOf = (pathname: string): string => pathname.split('/')[1] || 'dashboard';

/** Seconds until an access token expires (0 when it can't be read). */
function secondsLeft(token: string): number {
  try {
    const part = token.split('.')[1] ?? '';
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    return (payload.exp ?? 0) - Date.now() / 1000;
  } catch {
    return 0;
  }
}

/** Keeps this window's presence connection open while signed in, and reports its screen. */
export function usePresenceReporter(): void {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  const report = useRef<(view: string) => void>(() => undefined);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastInput = Date.now();
    const onInput = () => {
      lastInput = Date.now();
    };
    const inputs = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    inputs.forEach((e) => window.addEventListener(e, onInput, { passive: true }));

    const write = (msg: object) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg) + RS);
    };
    report.current = (view) => write({ type: 1, target: 'UpdateView', arguments: [view] });

    const open = async () => {
      let token = getAccessToken();
      if (token && secondsLeft(token) < 30) {
        await api.refreshSession();
        token = getAccessToken();
      }
      if (stopped || !token) return;
      const url = new URL(HUB, window.location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('access_token', token);
      const socket = new WebSocket(url);
      ws = socket;
      let ready = false;
      socket.onopen = () => socket.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS);
      socket.onmessage = (e) => {
        for (const part of String(e.data).split(RS)) {
          if (!part) continue;
          const msg = JSON.parse(part) as {
            type?: number;
            target?: string;
            error?: string;
            arguments?: unknown[];
          };
          if (!ready) {
            ready = true;
            if (msg.error) {
              socket.close();
              return;
            }
            attempt = 0;
            report.current(viewOf(window.location.pathname));
          } else if (msg.type === 1 && msg.target === 'presence:changed') {
            listeners.forEach((fn) => fn());
          } else if (msg.type === 1 && msg.target === 'notify') {
            bell.forEach((fn) => fn());
          } else if (msg.type === 1 && msg.target === 'chat') {
            const id = String(msg.arguments?.[0] ?? '');
            chat.forEach((fn) => fn(id));
          } else if (msg.type === 7) {
            socket.close();
          }
        }
      };
      socket.onclose = () => {
        if (ws === socket) ws = null;
        if (!stopped)
          retry = setTimeout(() => void open(), Math.min(30_000, 1000 * 2 ** attempt++));
      };
    };

    // Keep the connection alive, and say "still here" while the person is using the app.
    const beat = setInterval(() => {
      write({ type: 6 });
      if (Date.now() - lastInput < 60_000 && document.visibilityState === 'visible')
        report.current(viewOf(window.location.pathname));
    }, 15_000);
    void open();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(beat);
      inputs.forEach((e) => window.removeEventListener(e, onInput));
      report.current = () => undefined;
      ws?.close();
    };
  }, [status]);

  useEffect(() => {
    report.current(viewOf(location.pathname));
  }, [location.pathname]);
}
