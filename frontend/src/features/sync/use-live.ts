import { liveQuery } from 'dexie';
import { type DependencyList, useEffect, useState } from 'react';

/**
 * A Dexie query that re-runs when its data changes, in any tab. Undefined until the first answer.
 * Errors are not thrown into the UI: the database closes on sign-out while screens are unmounting.
 */
export function useLive<T>(query: () => Promise<T> | T, deps: DependencyList): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (next) => setValue(() => next),
      error: () => undefined,
    });
    return () => subscription.unsubscribe();
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller lists what the query reads
  }, deps);
  return value;
}
