import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useLocation } from 'react-router-dom';
import { getAccessToken, useAuth } from '../stores/auth';

const WS_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const viewOf = (pathname: string): string => pathname.split('/')[1] || 'dashboard';

/**
 * Maintains a single presence connection while signed in and reports the current view on
 * navigation. Powers the owner/CEO "who is online and what are they doing" foundation.
 */
export function usePresenceReporter(): void {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  const socketRef = useRef<Socket | null>(null);

  // Establish / tear down the connection with the auth lifecycle.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const token = getAccessToken();
    if (!token) return;

    const socket = io(`${WS_BASE}/presence`, { transports: ['websocket'], auth: { token } });
    socketRef.current = socket;
    socket.on('connect', () =>
      socket.emit('presence:update', { currentView: viewOf(window.location.pathname) }),
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [status]);

  // Report view changes over the existing connection.
  useEffect(() => {
    socketRef.current?.emit('presence:update', { currentView: viewOf(location.pathname) });
  }, [location.pathname]);
}
