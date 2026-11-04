import { create } from 'zustand';
import type { SyncClient } from './client';
import type { SyncStatus } from './sync-engine';

export type SocketState = 'connecting' | 'connected' | 'unreachable';

interface SyncStore {
  client: SyncClient | null;
  socket: SocketState;
  sync: SyncStatus;
}

/** The running client and its live state, for the screens. The data itself is in Dexie. */
export const useSyncStore = create<SyncStore>(() => ({
  client: null,
  socket: 'connecting',
  sync: 'syncing',
}));
