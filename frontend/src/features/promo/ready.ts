import { useEffect, useState } from 'react';

/** How long the chat list stays on its own before a promo may appear. */
export const PROMO_DELAY_MS = 1500;
/** The longest a promo waits for the browser to be idle after that. */
const IDLE_TIMEOUT_MS = 2000;

/**
 * True once the chat rows have been on screen for a moment and the browser is idle: promos never
 * compete with the first screen (they would become its largest paint, or move it). Stays true.
 */
export function usePromoReady(rowsShown: boolean, delayMs = PROMO_DELAY_MS): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!rowsShown || ready) return;
    let idle: number | undefined;
    const timer = setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idle = window.requestIdleCallback(() => setReady(true), { timeout: IDLE_TIMEOUT_MS });
      } else {
        setReady(true);
      }
    }, delayMs);
    return () => {
      clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
    };
  }, [delayMs, ready, rowsShown]);
  return ready;
}
