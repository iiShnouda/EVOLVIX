import { useEffect } from 'react';
import { API_BASE } from './api';
import { useConnection } from '../stores/connection';

const POLL_MS = 15_000;
const TIMEOUT_MS = 6_000;

/**
 * Polls the server health endpoint to drive the online/connecting/offline state. Because
 * the app is server-authoritative, this state gates whether any data screen is shown.
 */
export function useConnectionMonitor(): void {
  const setState = useConnection((s) => s.setState);

  useEffect(() => {
    let cancelled = false;

    async function ping(initial = false): Promise<void> {
      if (initial) setState('connecting');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${API_BASE}/health`, { signal: controller.signal });
        if (!cancelled) setState(res.ok ? 'online' : 'offline');
      } catch {
        if (!cancelled) setState('offline');
      } finally {
        clearTimeout(timer);
      }
    }

    void ping(true);
    const interval = setInterval(() => void ping(), POLL_MS);
    const onOnline = () => void ping(true);
    const onOffline = () => setState('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [setState]);
}
