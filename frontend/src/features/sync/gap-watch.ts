import { fillRecentGaps } from './gap-fill';
import type { LocalDb } from './local-db';

/** Checks for holes at most this often (each chat has its own pause too, see gap-fill.ts). */
const PAUSE_MS = 10_000;

/**
 * When to look for holes in recent chats: after every finished sync (connect, reconnect, a gap an
 * event proved) and when the app comes back to the front. Local reads only, unless a hole is found.
 */
export function startGapWatch(db: LocalDb, me: string) {
  let last = 0;
  let stopped = false;
  const check = () => {
    const now = Date.now();
    if (stopped || now - last < PAUSE_MS) return;
    last = now;
    void fillRecentGaps(db, me).catch(() => undefined);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') check();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', check);
  return {
    check,
    stop() {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    },
  };
}
