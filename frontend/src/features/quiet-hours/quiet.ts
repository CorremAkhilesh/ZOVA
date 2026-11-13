import { DEFAULT_QUIET_HOURS, isQuietAt, passesQuietHours, type QuietHours } from '@zuvo/protocol';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useQuietHoursSettings } from './api';

/** How often "is it quiet?" is asked again, so a schedule starts and ends on time. */
export const QUIET_TICK_MS = 60_000;

interface QuietState {
  settings: QuietHours;
  setSettings: (settings: QuietHours) => void;
}

/** My quiet hours, for code outside React (notifications in Step 18). QuietHoursHost keeps it fresh. */
export const useQuietStore = create<QuietState>()((set) => ({
  settings: DEFAULT_QUIET_HOURS,
  setSettings: (settings) => set({ settings }),
}));

/** Is it quiet now (by my settings, in my timezone)? */
export function isQuietNow(at: Date = new Date()): boolean {
  return isQuietAt(useQuietStore.getState().settings, at);
}

/**
 * Should an incoming message make a sound, toast or notification? Always outside quiet hours; while
 * quiet, only mentions (if allowed) and the chats I let through.
 */
export function shouldAlert(
  message: { chatId: string; mentionsMe: boolean },
  at: Date = new Date(),
): boolean {
  const { settings } = useQuietStore.getState();
  return !isQuietAt(settings, at) || passesQuietHours(settings, message);
}

/** Re-renders every minute, so time-based checks stay right. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), QUIET_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** True while quiet hours are on; follows every change to the settings and the clock. */
export function useQuiet(): boolean {
  const { data } = useQuietHoursSettings();
  const now = useMinuteTick();
  return data ? isQuietAt(data, new Date(now)) : false;
}

/** Copies the fetched settings into the store for `isQuietNow` / `shouldAlert`. */
export function useQuietStoreSync() {
  const { data } = useQuietHoursSettings();
  useEffect(() => {
    useQuietStore.getState().setSettings(data ?? DEFAULT_QUIET_HOURS);
  }, [data]);
}
