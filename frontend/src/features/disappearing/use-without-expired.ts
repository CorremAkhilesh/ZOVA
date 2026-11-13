import { useEffect, useMemo, useRef, useState } from 'react';

/** setTimeout cannot wait longer than this; a later expiry is simply checked again then. */
const MAX_WAIT_MS = 2 ** 31 - 1;

/**
 * `items` without the ones whose time is up, updated the moment the next one expires. For lists
 * that come from React Query or memory rather than Dexie, where the purge cannot reach them.
 * Returns the same array when nothing has expired, so memos downstream stay put.
 */
export function useWithoutExpired<T>(
  items: T[] | undefined,
  expiryOf: (item: T) => string | null | undefined,
): T[] | undefined {
  const read = useRef(expiryOf);
  read.current = expiryOf;
  const [tick, setTick] = useState(0);
  const { live, next } = useMemo(() => {
    // `tick` only makes this run again when the soonest expiry passes.
    void tick;
    const now = Date.now();
    let soonest: number | null = null;
    const kept = (items ?? []).filter((item) => {
      const at = read.current(item);
      if (!at) return true;
      const ms = Date.parse(at);
      if (ms <= now) return false;
      soonest = soonest === null ? ms : Math.min(soonest, ms);
      return true;
    });
    return {
      live: items && kept.length === items.length ? items : items ? kept : undefined,
      next: soonest as number | null,
    };
  }, [items, tick]);
  useEffect(() => {
    if (next === null) return;
    const wait = Math.min(MAX_WAIT_MS, Math.max(0, next - Date.now()) + 50);
    const timer = setTimeout(() => setTick((count) => count + 1), wait);
    return () => clearTimeout(timer);
  }, [next]);
  return live;
}
