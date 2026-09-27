import { create } from 'zustand';
import type { ConnectionState } from '@skb/shared';

interface ConnectionStore {
  state: ConnectionState;
  lastConnectedAt: string | null;
  setState: (state: ConnectionState) => void;
}

export const useConnection = create<ConnectionStore>((set) => ({
  state: 'connecting',
  lastConnectedAt: null,
  setState: (state) =>
    set((prev) => ({
      state,
      lastConnectedAt: state === 'online' ? new Date().toISOString() : prev.lastConnectedAt,
    })),
}));
