import { useSyncExternalStore } from 'react';

export type ResolvedTheme = 'light' | 'dark';

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const read = (): ResolvedTheme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

/** The theme on screen right now (after "system" is resolved), following every change. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, read, () => 'light');
}
