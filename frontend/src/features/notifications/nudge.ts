import { create } from 'zustand';
import type { PushStatus } from './status';

/**
 * The team relies on notifications, so the app keeps asking until they are on:
 * - a full-screen step the first time on a device ("Turn on notifications"; on an iPhone outside the
 *   installed app, "Add to Home Screen" first; when blocked, how to unblock), which can be put off
 * - after "Later", a banner at the top until push is on (it cannot be closed)
 */
export type Nudge = 'screen' | 'banner' | null;

/** "Later" was chosen on this device: the banner from now on, no full-screen step. */
export const NUDGE_LATER_KEY = 'zuvo.push.onboarding-later';
/** End-to-end and screenshot tests only: no step and no banner over the screens they look at. */
export const NUDGE_OFF_KEY = 'zuvo.push.nudge-off';

const NEEDS_ACTION: readonly PushStatus[] = ['ask', 'ios-install', 'denied', 'off'];

export function nudgeFor(
  status: PushStatus | undefined,
  device: { later: boolean; off: boolean; screenOpen: boolean },
): Nudge {
  if (!status || device.off || !NEEDS_ACTION.includes(status)) return null;
  if (device.screenOpen) return 'screen';
  // Turned off on purpose in Settings: a reminder, never the full-screen step.
  if (status === 'off' || device.later) return 'banner';
  return 'screen';
}

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

interface NudgeState {
  later: boolean;
  off: boolean;
  /** The full-screen step reopened from the banner ("How to"). */
  screenOpen: boolean;
  putOff: () => void;
  openScreen: () => void;
  reload: () => void;
}

export const useNudgeStore = create<NudgeState>()((set) => ({
  later: read(NUDGE_LATER_KEY),
  off: read(NUDGE_OFF_KEY),
  screenOpen: false,
  putOff: () => {
    try {
      localStorage.setItem(NUDGE_LATER_KEY, String(Date.now()));
    } catch {
      // Storage blocked: "Later" lasts until the page closes.
    }
    set({ later: true, screenOpen: false });
  },
  openScreen: () => set({ screenOpen: true }),
  reload: () => set({ later: read(NUDGE_LATER_KEY), off: read(NUDGE_OFF_KEY), screenOpen: false }),
}));
