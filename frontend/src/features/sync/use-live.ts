import { liveQuery } from 'dexie';
import { type DependencyList, useEffect, useState } from 'react';
import { useSyncStore } from './store';

const RETRY_MS = 2000;
const REFRESH_MS = 20_000;

const listeners = new Set<() => void>();
let stopWatching: (() => void) | undefined;

function refreshAll() {
  if (document.visibilityState === 'visible') for (const listener of listeners) listener();
}

function watchForRefresh(listener: () => void) {
  listeners.add(listener);
  if (!stopWatching) {
    const timer = setInterval(refreshAll, REFRESH_MS);
    window.addEventListener('focus', refreshAll);
    document.addEventListener('visibilitychange', refreshAll);
    stopWatching = () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshAll);
      document.removeEventListener('visibilitychange', refreshAll);
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopWatching?.();
      stopWatching = undefined;
    }
  };
}

/**
 * A Dexie query that re-runs when its data changes, in any tab. Undefined until the first answer.
 *
 * Dexie only re-reads after a write, so a read that fails, or a change from another tab that never
 * arrives, would leave the screen showing old data until the next write, however long that takes.
 * So a failed read is tried again, and a visible screen reads again now and then and on coming back.
 * Errors are not thrown into the UI: the database closes on sign-out while screens are unmounting.
 */
export function useLive<T>(query: () => Promise<T> | T, deps: DependencyList): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => watchForRefresh(() => setReads((count) => count + 1)), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller lists what the query reads
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    const subscription = liveQuery(query).subscribe({
      next: (next) => setValue(() => next),
      error: (error: unknown) => {
        const problem = `local read failed: ${error instanceof Error ? error.name : 'unknown'}`;
        console.error(`[live] ${problem}`);
        useSyncStore.setState({ lastProblem: problem });
        clearTimeout(retry);
        retry = setTimeout(() => setReads((count) => count + 1), RETRY_MS);
      },
    });
    return () => {
      clearTimeout(retry);
      subscription.unsubscribe();
    };
  }, [...deps, reads]);
  return value;
}
