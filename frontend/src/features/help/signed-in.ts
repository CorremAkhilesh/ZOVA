import { useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { sessionQuery } from '@/features/auth/session';

/**
 * Signed in, as far as this tab already knows. It never asks the server: Help is public, and a
 * signed-out visitor's pages must not load anything about anyone.
 */
export function useKnownSignedIn(): boolean {
  const queryClient = useQueryClient();
  const read = () => queryClient.getQueryData(sessionQuery.queryKey)?.status === 'signed-in';
  return useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    read,
    read,
  );
}
