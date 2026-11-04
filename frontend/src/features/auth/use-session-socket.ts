import { useQueryClient } from '@tanstack/react-query';
import type { ClientToServerEvents, ServerToClientEvents } from '@zuvo/protocol';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { sessionQuery } from './session';
import { useSignOut } from './use-sign-out';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * While the app shell is open, keeps a socket to the API (same origin; Vite proxies it in
 * development). The server pushes `session:revoked` the moment this session ends, whether revoked
 * on another device, by "This wasn't me", by deactivation or at expiry.
 */
export function useSessionSocket(): void {
  const signOut = useSignOut();
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket: AppSocket = io({ path: '/socket.io', withCredentials: true });
    socket.on('session:revoked', ({ reason }) => {
      void signOut(reason === 'expired' ? 'expired' : 'signed-out', false);
    });
    // Refused on reconnect: the session ended while we were away. Ask the API to confirm.
    socket.on('connect_error', () => {
      void queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
    });
    return () => {
      socket.disconnect();
    };
  }, [queryClient, signOut]);
}
