import type { Message } from '@zuvo/protocol';
import {
  type ApplyResult,
  advance,
  allStores,
  type ChatChange,
  classify,
  mergeChat,
  messageKey,
  readCursor,
  storeMessages,
} from './apply';
import type { LocalDb } from './local-db';

/**
 * Whether a live event may move the cursor. Not while a gap is being filled by sync: the event after
 * a skipped one could otherwise move it past the change that was skipped, and the sync that follows
 * would ask from there and never bring it (the "in the chat list, not in the chat" bug).
 */
export interface LiveOptions {
  mayAdvance: boolean;
}
export const ALWAYS: LiveOptions = { mayAdvance: true };

/**
 * Stores those this device does not have yet, never replacing a copy it has: an early or repeated
 * event may be older than an edit or a delete already applied. Keyed by sender + clientMsgId.
 */
async function storeIfMissing(db: LocalDb, me: string, messages: Message[]) {
  const known = await db.messages.bulkGet(messages.map(messageKey));
  const missing = messages.filter((_message, index) => !known[index]);
  if (missing.length > 0) await storeMessages(db, me, missing);
}

/**
 * message:new. The next number: stored, and the cursor moves. Out of turn (a gap, or a sync is
 * filling one): stored at once if its chat is known, so it shows, but the cursor waits for sync.
 * Already seen: left alone (it may since have been deleted for me, or expired); a message that is
 * really missing is found by its chat's seq and fetched (gap-fill.ts).
 */
export function applyLiveMessage(
  db: LocalDb,
  me: string,
  message: Message,
  cursor: string,
  options: LiveOptions = ALWAYS,
): Promise<ApplyResult> {
  return db.transaction('rw', allStores(db), async () => {
    const position = classify(await readCursor(db), cursor);
    // A first message in a chat this device has never seen: sync brings the chat with it.
    if (position === 'seen') return 'stale';
    if (!(await db.chats.get(message.chatId))) return 'gap';
    if (position === 'gap' || !options.mayAdvance) {
      await storeIfMissing(db, me, [message]);
      return 'gap';
    }
    await storeMessages(db, me, [message]);
    await advance(db, cursor);
    return 'applied';
  });
}

/**
 * chat:updated and read:update share a number with the event before them, so an already-seen number
 * still applies: merging is safe to repeat. A skipped number means something is missing.
 *
 * A change that names a last message (chat:updated) never moves the cursor itself: its number is
 * its message's, and if it comes first (out of order, or its message failed to store) moving on
 * would lose that message for good. Sync takes it from there. Receipts and reads (no last message)
 * move it as before, unless a sync is filling a gap.
 */
export function applyLiveChatChange(
  db: LocalDb,
  chatId: string,
  change: ChatChange,
  cursor: string,
  options: LiveOptions = ALWAYS,
): Promise<ApplyResult> {
  return db.transaction('rw', allStores(db), async () => {
    const position = classify(await readCursor(db), cursor);
    if (position === 'gap') return 'gap';
    const row = await db.chats.get(chatId);
    if (!row) return 'gap';
    await db.chats.put(mergeChat(row, change));
    if (position !== 'next') return 'applied';
    if (!options.mayAdvance || change.lastMessage !== undefined) return 'gap';
    await advance(db, cursor);
    return 'applied';
  });
}
