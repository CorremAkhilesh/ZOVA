import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { unsubscribeThisDevice } from '@/features/notifications/subscription';
import { clearLocalUserData } from '@/features/sync/wipe';
import { authApi } from './api';
import { type SignedOutReason, useAuthFlow } from './flow-store';
import { setSignedOut } from './session';

/**
 * Signs out (best effort on the server), stops push on this browser, wipes everything stored
 * locally for this user and returns to the welcome screen.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setReason = useAuthFlow((state) => state.setSignedOutReason);

  return useCallback(
    async (reason: SignedOutReason = 'signed-out', callServer = true) => {
      // Push stops first, while the session can still say which subscription is this browser's.
      // A session that already ended took its subscription with it: the browser's copy goes too.
      await unsubscribeThisDevice({ tellServer: callServer });
      if (callServer) await authApi.logout().catch(() => undefined);
      await clearLocalUserData();
      setReason(reason === 'signed-out' ? null : reason);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      setSignedOut(queryClient, reason === 'expired' ? 'expired' : null);
      await navigate({ to: '/' });
    },
    [navigate, queryClient, setReason],
  );
}
