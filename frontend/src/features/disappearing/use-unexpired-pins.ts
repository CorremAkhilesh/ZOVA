import type { PinnedMessage } from '@zuvo/protocol';
import { useMemo, useRef } from 'react';
import { useLocalDb } from '@/features/chats/queries';
import { useLive } from '@/features/sync/use-live';
import { useWithoutExpired } from './use-without-expired';

/**
 * Pins without the disappearing messages they point at once those are gone. The pin itself does
 * not say when its message goes, so this remembers it from the local copy: after the purge has
 * removed that copy, the pin stays hidden until the server sends the chat's new pins.
 */
export function useUnexpiredPins(chatId: string, pins: PinnedMessage[]): PinnedMessage[] {
  const db = useLocalDb();
  const known = useRef(new Map<string, string>());
  const seqs = pins.map((pin) => pin.seq).join(',');
  const expiries = useLive(async () => {
    if (!db || !seqs) return [];
    const keys = seqs.split(',').map((seq) => [chatId, Number(seq)]);
    const rows = await db.messages.where('[chatId+order]').anyOf(keys).toArray();
    return rows.flatMap((row) => (row.expiresAt ? [[row.seq, row.expiresAt] as const] : []));
  }, [db, chatId, seqs]);
  const withExpiry = useMemo(() => {
    for (const [seq, at] of expiries ?? []) known.current.set(`${chatId}:${seq}`, at);
    return pins.map((pin) => ({ pin, at: known.current.get(`${chatId}:${pin.seq}`) ?? null }));
  }, [chatId, expiries, pins]);
  return (useWithoutExpired(withExpiry, (item) => item.at) ?? []).map((item) => item.pin);
}
