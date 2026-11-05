import { create } from 'zustand';
import type { SyncClient } from './client';
import type { SyncStatus } from './sync-engine';

export type SocketState = 'connecting' | 'connected' | 'unreachable';

interface SyncStore {
  client: SyncClient | null;
  socket: SocketState;
  sync: SyncStatus;
  /** Diagnostics: this tab holds the "one tab sends" lock. */
  isLeader: boolean;
  lastHandshakeError: string | null;
  lastProblem: string | null;
}

export const INITIAL_SYNC_STATE = {
  client: null,
  socket: 'connecting',
  sync: 'syncing',
  isLeader: false,
  lastHandshakeError: null,
  lastProblem: null,
} satisfies SyncStore;

/** The running client and its live state, for the screens. The data itself is in Dexie. */
export const useSyncStore = create<SyncStore>(() => INITIAL_SYNC_STATE);
