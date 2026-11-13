import type { LocalDb } from '@/features/sync/local-db';

/**
 * Removes this device's copies of messages whose time ran out, on a timer and when the app opens,
 * so a device that was offline when the server deleted them forgets them too. Returns how many.
 */
export async function purgeExpired(db: LocalDb, now = Date.now()): Promise<number> {
  const cutoff = new Date(now).toISOString();
  const expired = await db.messages.where('expiresAt').belowOrEqual(cutoff).toArray();
  if (expired.length === 0) return 0;
  await removeMessages(
    db,
    expired.map((row) => ({ key: row.key, chatId: row.chatId, seq: row.seq })),
  );
  return expired.length;
}

/** messages:expired from the server: these positions are gone in this chat. */
export async function applyExpired(db: LocalDb, chatId: string, seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  const rows = await db.messages
    .where('[chatId+order]')
    .anyOf(seqs.map((seq) => [chatId, seq]))
    .toArray();
  await removeMessages(
    db,
    rows.map((row) => ({ key: row.key, chatId: row.chatId, seq: row.seq })),
  );
}

/** Deletes the rows, and the chat list's last line when it was one of them (the server sends the new one). */
async function removeMessages(
  db: LocalDb,
  rows: Array<{ key: string; chatId: string; seq: number | null }>,
): Promise<void> {
  const byChat = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.seq === null) continue;
    const seqs = byChat.get(row.chatId) ?? new Set<number>();
    seqs.add(row.seq);
    byChat.set(row.chatId, seqs);
  }
  await db.transaction('rw', db.messages, db.chats, async () => {
    await db.messages.bulkDelete(rows.map((row) => row.key));
    for (const [chatId, seqs] of byChat) {
      const chat = await db.chats.get(chatId);
      if (chat?.lastMessage && seqs.has(chat.lastMessage.seq)) {
        await db.chats.update(chatId, { lastMessage: null });
      }
    }
  });
}

/** Checks every half minute while the app is open. */
export const PURGE_EVERY_MS = 30_000;

/** Purges now and then every PURGE_EVERY_MS until stopped. */
export function startExpiryPurge(db: LocalDb): { stop(): void } {
  const run = () => void purgeExpired(db).catch(() => undefined);
  run();
  const timer = setInterval(run, PURGE_EVERY_MS);
  return { stop: () => clearInterval(timer) };
}
