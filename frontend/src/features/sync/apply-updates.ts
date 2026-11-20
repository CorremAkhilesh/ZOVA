import type { LastReaction, Message } from '@zuvo/protocol';
import { type ApplyResult, advance, allStores, classify, readCursor } from './apply';
import { ALWAYS, type LiveOptions } from './apply-live';
import { clearUpTo, mergeUpdated, removeAt } from './local-changes';
import type { LocalDb } from './local-db';

/** Numbered like everything else: repeating one is harmless, and skipping one means ask for sync. */
function numbered(
  db: LocalDb,
  cursor: string,
  apply: () => Promise<unknown>,
  options: LiveOptions,
): Promise<ApplyResult> {
  return db.transaction('rw', allStores(db), async () => {
    const position = classify(await readCursor(db), cursor);
    if (position === 'gap') return 'gap';
    await apply();
    if (position !== 'next') return 'stale';
    // A sync is filling a gap: it moves the cursor, not this (see LiveOptions).
    if (!options.mayAdvance) return 'gap';
    await advance(db, cursor);
    return 'applied';
  });
}

export const applyLiveUpdate = (
  db: LocalDb,
  message: Message,
  cursor: string,
  options: LiveOptions = ALWAYS,
) => numbered(db, cursor, () => mergeUpdated(db, [message]), options);

export const applyLiveRemoval = (
  db: LocalDb,
  chatId: string,
  seq: number,
  cursor: string,
  options: LiveOptions = ALWAYS,
) => numbered(db, cursor, () => removeAt(db, chatId, seq), options);

export const applyLiveClear = (
  db: LocalDb,
  change: { chatId: string; seq: number; removeChat: boolean },
  cursor: string,
  options: LiveOptions = ALWAYS,
) => numbered(db, cursor, () => clearUpTo(db, change), options);

/** Carries no number: the message's own update does, and sync brings the line with the chat. */
export function applyLastReaction(db: LocalDb, chatId: string, lastReaction: LastReaction | null) {
  return db.chats.update(chatId, { lastReaction });
}
