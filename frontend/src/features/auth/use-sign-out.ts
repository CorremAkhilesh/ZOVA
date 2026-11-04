import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { authApi } from './api';
import { type SignedOutReason, useAuthFlow } from './flow-store';
import { setSignedOut } from './session';

/** Signs out (best effort on the server), clears cached data and returns to the welcome screen. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setReason = useAuthFlow((state) => state.setSignedOutReason);

  return useCallback(
    async (reason: SignedOutReason = 'signed-out', callServer = true) => {
      if (callServer) await authApi.logout().catch(() => undefined);
      setReason(reason === 'signed-out' ? null : reason);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      setSignedOut(queryClient, reason === 'expired' ? 'expired' : null);
      await navigate({ to: '/' });
    },
    [navigate, queryClient, setReason],
  );
}
