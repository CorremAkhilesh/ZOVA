import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSyncStore } from '@/features/sync/store';
import { connectPlayer } from './player';
import { rowToTrack, senderOf } from './track';
import { trackLabels } from './use-track';

/** Gives the player what only the signed-in client has: its database and the server. */
export function useConnectPlayer() {
  const client = useSyncStore((state) => state.client);
  const { t } = useTranslation();
  useEffect(() => {
    if (!client) return;
    connectPlayer({
      reportPlayed: (track) => {
        if (track.messageId) void client.markPlayed(track.key, track.chatId, track.messageId);
      },
      nextAfter: async (track) => {
        const next = await client.messageAfter(track.key);
        if (!next) return null;
        const labels = trackLabels(t);
        // Each note names its own sender: the next one may be someone else's, or mine.
        const sender = await senderOf(client.db, next, client.userId, labels);
        return rowToTrack(next, client.userId, sender, labels);
      },
    });
    return () => connectPlayer(null);
  }, [client, t]);
}
