import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { sessionQuery, useSession } from '@/features/auth/session';
import { useSignOut } from '@/features/auth/use-sign-out';
import { applyAccountChange } from '@/features/settings/chat-settings';
import { startSyncClient } from './client';
import { useSyncStore } from './store';

/**
 * Runs the sync client while the app shell is open: socket, sync, outbox. The server pushes
 * `session:revoked` the moment this session ends, whether revoked on another device, by "This wasn't
 * me", by deactivation or at expiry.
 */
export function useSyncClient(): void {
  const userId = useSession()?.user.id;
  const signOut = useSignOut();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const client = startSyncClient({
      userId,
      onSessionEnded: (reason) => {
        void signOut(reason === 'expired' ? 'expired' : 'signed-out', false);
      },
      onSessionDoubt: () => {
        void queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
      },
      onAccountChange: (change) => applyAccountChange(queryClient, change),
    });
    useSyncStore.setState({ client });
    return () => {
      client.stop();
      useSyncStore.setState({ client: null });
    };
  }, [queryClient, signOut, userId]);
}
