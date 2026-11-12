import { useEffect } from 'react';
import { useLockStore } from './store';

const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'] as const;
const CHECK_MS = 1000;

/**
 * Locks the app after `minutes` with no pointer, keyboard or touch while the tab is visible, or
 * when the tab comes back after being hidden for that long. Null: app lock is off.
 */
export function useIdleLock(minutes: number | null) {
  const locked = useLockStore((state) => state.appLocked);
  useEffect(() => {
    if (minutes === null || locked) return;
    const idleMs = minutes * 60_000;
    let last = Date.now();
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    const lock = () => useLockStore.getState().lockApp();
    const touch = () => {
      last = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= idleMs) lock();
      hiddenAt = null;
      last = Date.now();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - last >= idleMs) lock();
    }, CHECK_MS);
    for (const name of ACTIVITY) window.addEventListener(name, touch, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      for (const name of ACTIVITY) window.removeEventListener(name, touch);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [minutes, locked]);
}
