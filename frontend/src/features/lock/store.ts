import { CHAT_UNLOCK_MINUTES } from '@zuvo/protocol';
import { create } from 'zustand';

/** Until when locked chats are open, in this tab's session only (never localStorage). */
export const CHATS_UNTIL_KEY = 'zuvo.lock.chats-until';
/** Whether this device should start locked: only a flag, so the lock shows before the API answers. */
export const APP_LOCK_FLAG = 'zuvo.app-lock';
export const CHAT_UNLOCK_MS = CHAT_UNLOCK_MINUTES * 60_000;

export interface SetupRequest {
  /** "reset": the PIN was just reset by email, so the dialog says why it is asking. */
  reason: 'new' | 'reset';
  /** Runs once a PIN is set (e.g. lock the chat that asked for it). */
  onSet?: () => void;
}

interface LockState {
  /** The full-screen app lock is up. */
  appLocked: boolean;
  /** Locked chats are shown until then (ms since epoch), or null. */
  chatsUntil: number | null;
  /** The first lock status of this page load was handled (locks on start). */
  started: boolean;
  /** Whether I have a PIN, from the latest lock status; null until it is known. */
  pinSet: boolean | null;
  setup: SetupRequest | null;
  lockApp: () => void;
  unlockApp: () => void;
  unlockChats: () => void;
  relockChats: () => void;
  requestSetup: (request: SetupRequest) => void;
  closeSetup: () => void;
}

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Storage blocked: the state lasts until the page closes.
  }
}

const session = () => sessionStorage;
const local = () => localStorage;

export function setAppLockFlag(on: boolean) {
  write(local, APP_LOCK_FLAG, on ? '1' : null);
}

let relockTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleRelock(until: number | null) {
  clearTimeout(relockTimer);
  if (until === null) return;
  relockTimer = setTimeout(() => useLockStore.getState().relockChats(), until - Date.now());
}

function storedUntil(): number | null {
  const value = Number(read(session, CHATS_UNTIL_KEY));
  return Number.isFinite(value) && value > Date.now() ? value : null;
}

export const useLockStore = create<LockState>()((set) => ({
  appLocked: read(local, APP_LOCK_FLAG) === '1',
  chatsUntil: null,
  started: false,
  pinSet: null,
  setup: null,
  lockApp: () => {
    useLockStore.getState().relockChats();
    set({ appLocked: true });
  },
  unlockApp: () => set({ appLocked: false }),
  unlockChats: () => {
    const until = Date.now() + CHAT_UNLOCK_MS;
    write(session, CHATS_UNTIL_KEY, String(until));
    scheduleRelock(until);
    set({ chatsUntil: until });
  },
  relockChats: () => {
    write(session, CHATS_UNTIL_KEY, null);
    scheduleRelock(null);
    set({ chatsUntil: null });
  },
  requestSetup: (setup) => set({ setup }),
  closeSetup: () => set({ setup: null }),
}));

/** A reload within the 5 minutes keeps locked chats open for what is left of them. */
export function restoreChatUnlock() {
  const until = storedUntil();
  useLockStore.setState({ chatsUntil: until });
  scheduleRelock(until);
}
restoreChatUnlock();

/** Locked chats are open right now. */
export const useChatsUnlocked = () =>
  useLockStore((state) => state.chatsUntil !== null && state.chatsUntil > Date.now());
