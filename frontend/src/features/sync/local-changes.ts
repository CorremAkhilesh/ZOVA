import type { Message } from '@zuvo/protocol';
import Dexie from 'dexie';
import type { LocalDb, MessageRow } from './local-db';

const rowAt = (db: LocalDb, chatId: string, seq: number) =>
  db.messages.where('[chatId+order]').equals([chatId, seq]).first();

/**
 * Only messages this device already has. An old one it never loaded comes up to date when it does,
 * and storing it now would leave a hole in the history that paging back could not see.
 */
export async function mergeUpdated(db: LocalDb, messages: Message[]) {
  for (const message of messages) {
    const row = await rowAt(db, message.chatId, message.seq);
    if (row) {
      const starred = message.starred ?? row.starred;
      await db.messages.put({ ...row, ...message, starred, status: 'sent' } as MessageRow);
    }
  }
}

export const removeAt = (db: LocalDb, chatId: string, seq: number) =>
  db.messages.where('[chatId+order]').equals([chatId, seq]).delete();

/** Everything up to `seq`, for this person. Unsent messages come after it, so they stay. */
export async function clearUpTo(
  db: LocalDb,
  change: { chatId: string; seq: number; removeChat: boolean },
) {
  const { chatId, seq, removeChat } = change;
  await db.messages
    .where('[chatId+order]')
    .between([chatId, Dexie.minKey], [chatId, seq], true, true)
    .delete();
  const chat = await db.chats.get(chatId);
  if (!chat) return;
  // Someone wrote since: it stays in the list after all.
  if (removeChat && chat.seq <= seq) {
    await db.chats.delete(chatId);
    await db.drafts.delete(chatId);
    return;
  }
  const covered = (chat.lastMessage?.seq ?? 0) <= seq;
  await db.chats.put({
    ...chat,
    lastMessage: covered ? null : chat.lastMessage,
    lastReaction: null,
    lastReadSeq: Math.max(chat.lastReadSeq, seq),
    unreadCount: Math.max(0, chat.seq - Math.max(chat.lastReadSeq, seq)),
  });
}
