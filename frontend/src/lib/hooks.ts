import { useSyncExternalStore } from 'react';

/** Tracks a CSS media query, e.g. `useMediaQuery('(min-width: 768px)')`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Desktop layout (rail + panes) from 768px; below that the single-pane mobile layout. */
export const DESKTOP_QUERY = '(min-width: 768px)';
export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);

/** The browser's online/offline state. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('online', onChange);
      window.addEventListener('offline', onChange);
      return () => {
        window.removeEventListener('online', onChange);
        window.removeEventListener('offline', onChange);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
