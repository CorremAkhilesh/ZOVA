import { MESSAGE_PREVIEW_MAX, type PollInput } from '@zuvo/protocol';
import { mergeChat } from '@/features/sync/apply';
import type { SyncClient } from '@/features/sync/client';
import { type LocalDb, PENDING_ORDER_BASE } from '@/features/sync/local-db';
import { uuidv7 } from '@/lib/uuid';
import { pendingPoll } from './logic';

/**
 * Stored like a text message: an outbox row (which `toPayload` turns into `message:send` with
 * `poll`), the message with a clock, and the chat moved up the list. So a poll made offline, or
 * before a reload, still goes once the connection is back, exactly once (same clientMsgId).
 */
export async function enqueuePoll(
  db: LocalDb,
  me: string,
  chatId: string,
  poll: PollInput,
): Promise<string> {
  const clientMsgId = uuidv7();
  const key = `${me}:${clientMsgId}`;
  const createdAt = new Date().toISOString();
  await db.transaction('rw', db.outbox, db.messages, db.chats, async () => {
    const n = await db.outbox.add({
      clientMsgId,
      chatId,
      text: '',
      poll,
      attempts: 0,
      state: 'pending',
      queuedAt: Date.now(),
    });
    await db.messages.add({
      key,
      id: null,
      seq: null,
      order: PENDING_ORDER_BASE + n,
      chatId,
      clientMsgId,
      senderId: me,
      type: 'poll',
      text: null,
      media: null,
      albumId: null,
      played: false,
      replyTo: null,
      replyToId: null,
      editedAt: null,
      deletedForEveryoneAt: null,
      createdAt,
      status: 'pending',
      poll: pendingPoll(poll),
    });
    const chat = await db.chats.get(chatId);
    if (!chat) return;
    await db.chats.put(
      mergeChat(chat, {
        seq: chat.seq,
        lastMessage: {
          id: key,
          seq: chat.seq + 1,
          senderId: me,
          type: 'poll',
          preview: poll.question.slice(0, MESSAGE_PREVIEW_MAX),
          createdAt,
        },
        lastActivityAt: createdAt,
        lastReadSeq: chat.lastReadSeq,
      }),
    );
  });
  return clientMsgId;
}

/**
 * Queues the poll, then wakes the outbox. `retry` is the client's "send this row now" (it resets
 * the row to pending, flushes, and tells the other tabs), which is exactly what a new row needs.
 */
export async function sendPoll(client: SyncClient, chatId: string, poll: PollInput) {
  const clientMsgId = await enqueuePoll(client.db, client.userId, chatId, poll);
  await client.retry(clientMsgId);
}
