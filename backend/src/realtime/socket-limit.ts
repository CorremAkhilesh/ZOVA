/** A small per-socket rate limit, for events too frequent and too unimportant for a shared counter. */
export function windowLimit(max: number, windowMs: number, now: () => number = Date.now) {
  let started = 0;
  let count = 0;
  return () => {
    const time = now();
    if (time - started >= windowMs) {
      started = time;
      count = 0;
    }
    count += 1;
    return count <= max;
  };
}

/** Per socket and event, per window: far above what the app sends, far below a scripted flood. */
export const EVENT_WINDOW_MS = 10_000;
const DEFAULT_EVENT_LIMIT = 60;
const EVENT_LIMITS: Record<string, number> = {
  // Each change is announced to every contact watching: the app sends one after a minute away.
  'presence:active': 6,
  'window:state': 30,
  'voice:played': 30,
  // Opening chats one after another, and catching up after a reconnect.
  'read:update': 60,
  'delivered:update': 120,
  // Call signalling has its own, tighter shared limits too (call-handlers.ts).
  'call:signal': 300,
};

/**
 * One limiter per event for one socket. Checked before validation and the session lookup, so a
 * flood costs no database work and no broadcast.
 */
export function eventLimiter(now: () => number = Date.now) {
  const limits = new Map<string, () => boolean>();
  return (event: string): boolean => {
    let allowed = limits.get(event);
    if (!allowed) {
      allowed = windowLimit(EVENT_LIMITS[event] ?? DEFAULT_EVENT_LIMIT, EVENT_WINDOW_MS, now);
      limits.set(event, allowed);
    }
    return allowed();
  };
}
