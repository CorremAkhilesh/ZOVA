import { useQuery } from '@tanstack/react-query';
import { type SessionState, sessionQuery } from '@/features/auth/session';

const myId = (state: SessionState) => (state.status === 'signed-in' ? state.data.user.id : null);

/**
 * The signed-in user's id, for screens that render many times over (message bubbles, list rows).
 *
 * `useSession()` carries the session's 5-minute poll and its refetch on focus, and TanStack Query
 * runs a timer per observer: with one per bubble, an open chat held ~80 timers, each refetching the
 * session on its own. This observer reads the same cached session without either, and re-renders
 * only when the id changes. The app shell's `useSession()` keeps the session fresh.
 */
export function useMyId(): string | null {
  const { data } = useQuery({
    ...sessionQuery,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    select: myId,
  });
  return data ?? null;
}
