import { create } from 'zustand';

/** Push on this device: '0' when turned off here. Absent means on (once the browser allows it). */
export const PUSH_ENABLED_KEY = 'zuvo.push.enabled';
/** The chat list's "Get notified" card was closed on this device. */
export const PUSH_CARD_DISMISSED_KEY = 'zuvo.push.card-dismissed';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

interface PushPrefs {
  enabled: boolean;
  cardDismissed: boolean;
  setEnabled: (enabled: boolean) => void;
  dismissCard: () => void;
  /** Reads storage again (tests, another tab). */
  reload: () => void;
}

const fromStorage = () => ({
  enabled: read(PUSH_ENABLED_KEY) !== '0',
  cardDismissed: read(PUSH_CARD_DISMISSED_KEY) === '1',
});

/** Per-device choices, kept in localStorage (never synced: each device decides for itself). */
export const usePushPrefs = create<PushPrefs>()((set) => ({
  ...fromStorage(),
  setEnabled: (enabled) => {
    write(PUSH_ENABLED_KEY, enabled ? '1' : '0');
    set({ enabled });
  },
  dismissCard: () => {
    write(PUSH_CARD_DISMISSED_KEY, '1');
    set({ cardDismissed: true });
  },
  reload: () => set(fromStorage()),
}));
