import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { useAuthFlow } from './flow-store';
import { type SessionState, sessionQuery } from './session';

const load = (queryClient: QueryClient) => queryClient.ensureQueryData(sessionQuery);

function rememberReason(state: SessionState) {
  if (state.status === 'signed-out' && state.reason === 'expired') {
    useAuthFlow.getState().setSignedOutReason('expired');
  }
}

/** App screens: signed in with a display name; otherwise to welcome or the name step. */
export async function requireCompleteSession(queryClient: QueryClient) {
  const state = await load(queryClient);
  if (state.status === 'signed-out') {
    rememberReason(state);
    throw redirect({ to: '/' });
  }
  if (state.data.needsProfile) throw redirect({ to: '/welcome/name' });
  return state.data;
}

/** Name step: signed in, and only while the name is still missing. */
export async function requireNeedsProfile(queryClient: QueryClient) {
  const state = await load(queryClient);
  if (state.status === 'signed-out') throw redirect({ to: '/' });
  if (!state.data.needsProfile) throw redirect({ to: '/chats' });
}

/** Welcome and code screens: only when signed out. */
export async function requireSignedOut(queryClient: QueryClient) {
  const state = await load(queryClient);
  rememberReason(state);
  if (state.status === 'signed-in') {
    throw redirect({ to: state.data.needsProfile ? '/welcome/name' : '/chats' });
  }
}

/** Admin screens: anyone else goes back to Settings (the API enforces this too). */
export async function requireAdmin(queryClient: QueryClient) {
  const state = await load(queryClient);
  if (state.status !== 'signed-in' || state.data.user.role !== 'admin') {
    throw redirect({ to: '/settings' });
  }
}
