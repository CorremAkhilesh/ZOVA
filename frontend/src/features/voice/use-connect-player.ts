import { useEffect } from 'react';
import { useSyncStore } from '@/features/sync/store';
import { connectPlayer } from './player';
import { rowToTrack } from './track';

/** Gives the player what only the signed-in client has: its database and the server. */
export function useConnectPlayer() {
  const client = useSyncStore((state) => state.client);
  useEffect(() => {
    if (!client) return;
    connectPlayer({
      reportPlayed: (track) => {
        if (track.messageId) void client.markPlayed(track.key, track.chatId, track.messageId);
      },
      nextAfter: async (track) => {
        const next = await client.messageAfter(track.key);
        return next ? rowToTrack(next, client.userId, track) : null;
      },
    });
    return () => connectPlayer(null);
  }, [client]);
}
