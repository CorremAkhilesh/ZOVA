import { PRESENCE_WATCH_MAX } from '@zuvo/protocol';
import { useEffect } from 'react';
import { useSyncStore } from './store';

/** Scrolling changes the visible rows many times a second; the server hears the result. */
const SEND_DELAY_MS = 500;

/**
 * Who this tab wants to know about: the open chat, then the visible chat list rows, at most 100.
 * The server gets the whole list each time, so nothing is ever left subscribed by mistake.
 */
export class PresenceWatchList {
  private readonly counts = new Map<string, number>();
  private readonly priority = new Map<string, number>();

  add(userId: string, important: boolean): () => void {
    const counts = important ? this.priority : this.counts;
    counts.set(userId, (counts.get(userId) ?? 0) + 1);
    return () => {
      const left = (counts.get(userId) ?? 1) - 1;
      if (left > 0) counts.set(userId, left);
      else counts.delete(userId);
    };
  }

  current(max: number = PRESENCE_WATCH_MAX): string[] {
    return [...new Set([...this.priority.keys(), ...this.counts.keys()])].slice(0, max);
  }
}

const watchList = new PresenceWatchList();
let sendTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleSend() {
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => {
    // A client that is not connected yet asks for the current list itself once it is.
    useSyncStore.getState().client?.watchPresence(watchList.current());
  }, SEND_DELAY_MS);
}

function watch(userId: string, important: boolean) {
  const stop = watchList.add(userId, important);
  scheduleSend();
  return () => {
    stop();
    scheduleSend();
  };
}

/** The person in the open chat: always watched. */
export function usePresenceWatch(userId: string | undefined): void {
  useEffect(() => (userId ? watch(userId, true) : undefined), [userId]);
}

/** The people in an open group, as many as the limit allows. */
export function usePresenceWatchMany(userIds: string[]): void {
  const key = userIds.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the list's contents
  useEffect(() => {
    const stops = userIds.slice(0, PRESENCE_WATCH_MAX).map((userId) => watchList.add(userId, true));
    scheduleSend();
    return () => {
      for (const stop of stops) stop();
      scheduleSend();
    };
  }, [key]);
}

/** A chat list row: watched only while on screen. */
export function usePresenceWatchWhileVisible(
  element: React.RefObject<HTMLElement | null>,
  userId: string | undefined,
): void {
  useEffect(() => {
    const target = element.current;
    if (!userId || !target) return;
    // Without IntersectionObserver every row counts as visible; the 100 limit still holds.
    if (typeof IntersectionObserver === 'undefined') return watch(userId, false);
    let stop: (() => void) | null = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !stop) stop = watch(userId, false);
      else if (!entry?.isIntersecting && stop) {
        stop();
        stop = null;
      }
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
      stop?.();
    };
  }, [element, userId]);
}

/** What the sync client asks for after connecting, or when told privacy changed. */
export const currentWatchList = () => watchList.current();
