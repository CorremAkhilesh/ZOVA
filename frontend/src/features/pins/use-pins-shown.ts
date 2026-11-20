import type { PinnedMessage } from '@zuvo/protocol';
import { useMemo } from 'react';
import { useLocalDb } from '@/features/chats/queries';
import { useLive } from '@/features/sync/use-live';

/**
 * Pins without messages this device already knows are deleted for everyone. The server unpins them
 * and tells every device; this hides the pin the moment the message shows as deleted here (my own
 * delete, or an update that arrived before the chat's new pins), so a tap never opens a tombstone.
 */
export function useWithoutDeletedPins(chatId: string, pins: PinnedMessage[]): PinnedMessage[] {
  const db = useLocalDb();
  const seqs = pins.map((pin) => pin.seq).join(',');
  const deleted = useLive(async () => {
    if (!db || !seqs) return [];
    const keys = seqs.split(',').map((seq) => [chatId, Number(seq)]);
    const rows = await db.messages.where('[chatId+order]').anyOf(keys).toArray();
    return rows.flatMap((row) => (row.deletedForEveryoneAt && row.seq !== null ? [row.seq] : []));
  }, [db, chatId, seqs]);
  return useMemo(() => {
    // Not looked yet (a moment, it is on this device): show nothing rather than a pin that may be gone.
    if (deleted === undefined) return [];
    const gone = new Set(deleted);
    return gone.size === 0 ? pins : pins.filter((pin) => !gone.has(pin.seq));
  }, [deleted, pins]);
}
