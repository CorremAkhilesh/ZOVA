import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { type SessionResponse, sessionResponseSchema } from '@zuvo/protocol';
import { ApiClientError } from '@/lib/api-client';
import { authApi } from './api';

export type SessionState =
  | { status: 'signed-in'; data: SessionResponse; offline?: boolean }
  | { status: 'signed-out'; reason: 'expired' | null };

const SNAPSHOT_KEY = 'zuvo-session';

/**
 * Last known session (user + expiry, no tokens) so the installed app still opens offline.
 * The cookie stays the source of truth: the server decides on every request.
 */
export const sessionSnapshot = {
  save(session: SessionResponse) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(session));
    } catch {
      // Storage unavailable (private mode): offline start just won't work.
    }
  },
  load(): SessionResponse | null {
    try {
      const parsed = sessionResponseSchema.safeParse(
        JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? 'null'),
      );
      if (!parsed.success || Date.parse(parsed.data.session.expiresAt) <= Date.now()) return null;
      return parsed.data;
    } catch {
      return null;
    }
  },
  clear() {
    try {
      localStorage.removeItem(SNAPSHOT_KEY);
    } catch {
      // ignore
    }
  },
};

export async function fetchSessionState(): Promise<SessionState> {
  try {
    const data = await authApi.me();
    sessionSnapshot.save(data);
    return { status: 'signed-in', data };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      sessionSnapshot.clear();
      return {
        status: 'signed-out',
        reason: error.apiError?.code === 'SESSION_EXPIRED' ? 'expired' : null,
      };
    }
    if (error instanceof ApiClientError && error.isNetworkError) {
      const snapshot = sessionSnapshot.load();
      if (snapshot) return { status: 'signed-in', data: snapshot, offline: true };
    }
    throw error;
  }
}

/**
 * A revoked session is pushed over the socket (`session:revoked`, see use-session-socket). These
 * are the fallbacks for when no socket is connected: a check whenever the app regains focus or
 * visibility, and a slow background refresh.
 */
export const SESSION_POLL_MS = 5 * 60_000;

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: fetchSessionState,
  staleTime: 10_000,
  refetchInterval: SESSION_POLL_MS,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: 'always',
  retry: false,
});

export function setSignedIn(queryClient: QueryClient, data: SessionResponse) {
  sessionSnapshot.save(data);
  const state: SessionState = { status: 'signed-in', data };
  queryClient.setQueryData(sessionQuery.queryKey, state);
}

export function setSignedOut(queryClient: QueryClient, reason: 'expired' | null = null) {
  sessionSnapshot.clear();
  const state: SessionState = { status: 'signed-out', reason };
  queryClient.setQueryData(sessionQuery.queryKey, state);
}

/** The signed-in session inside the app shell (guards guarantee it is there). */
export function useSession(): SessionResponse | null {
  const { data } = useQuery(sessionQuery);
  return data?.status === 'signed-in' ? data.data : null;
}
