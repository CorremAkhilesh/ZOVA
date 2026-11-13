import type { LastReaction, Message } from '@zuvo/protocol';
import { type ApplyResult, advance, allStores, classify, readCursor } from './apply';
import { clearUpTo, mergeUpdated, removeAt } from './local-changes';
import type { LocalDb } from './local-db';

/** Numbered like everything else: repeating one is harmless, and skipping one means ask for sync. */
function numbered(
  db: LocalDb,
  cursor: string,
  apply: () => Promise<unknown>,
): Promise<ApplyResult> {
  return db.transaction('rw', allStores(db), async () => {
    const position = classify(await readCursor(db), cursor);
    if (position === 'gap') return 'gap';
    await apply();
    if (position === 'next') await advance(db, cursor);
    return position === 'next' ? 'applied' : 'stale';
  });
}

export const applyLiveUpdate = (db: LocalDb, message: Message, cursor: string) =>
  numbered(db, cursor, () => mergeUpdated(db, [message]));

export const applyLiveRemoval = (db: LocalDb, chatId: string, seq: number, cursor: string) =>
  numbered(db, cursor, () => removeAt(db, chatId, seq));

export const applyLiveClear = (
  db: LocalDb,
  change: { chatId: string; seq: number; removeChat: boolean },
  cursor: string,
) => numbered(db, cursor, () => clearUpTo(db, change));

/** Carries no number: the message's own update does, and sync brings the line with the chat. */
export function applyLastReaction(db: LocalDb, chatId: string, lastReaction: LastReaction | null) {
  return db.chats.update(chatId, { lastReaction });
}
