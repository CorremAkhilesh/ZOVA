import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { chatModels, oid, requireMember } from './chats.service.ts';
import { toMessage } from './message-format.ts';
import { readsVisibleBetween } from './receipts.service.ts';
import { logUpdates } from './updates.ts';

/**
 * I played a voice note. Clears its unplayed dot on my devices and, while both of us have read
 * receipts on, colors the sender's mic. Like reads: a play made with receipts off stays hidden even
 * if they are turned on later, and one already shown stays shown. Only ever added to, once per person.
 */
export async function markPlayed(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
) {
  const member = await requireMember(app, chatId, userId);
  const { Message, ...models } = chatModels(app);
  const message = await Message.findOne({ _id: oid(messageId), chatId: oid(chatId) }).lean();
  if (message?.type !== 'voice' || message.deletedForEveryoneAt) {
    throw new AppError('NOT_FOUND', 'Voice note not found.');
  }
  const answer = { messageId, played: true };
  const sender = message.senderId;
  // My own note is not news to anyone.
  if (!sender || sender.equals(member.userId)) return { messageId, played: false };
  if (message.plays?.some((play) => play.userId.equals(member.userId))) return answer;

  const shared = await readsVisibleBetween(app, [userId, sender.toString()]);
  const now = new Date();
  const cursors = await app.mongo.transaction(async (session) => {
    const added = await Message.updateOne(
      { _id: message._id, 'plays.userId': { $ne: member.userId } },
      { $push: { plays: { userId: member.userId, at: now, shared } } },
      { session },
    );
    if (added.modifiedCount === 0) return null;
    return logUpdates(
      { Message, ...models },
      session,
      shared ? [member.userId, sender] : [member.userId],
      { kind: 'played', chatId: message.chatId, seq: message.seq },
      now,
    );
  });
  // Another of my devices got there first.
  if (!cursors) return answer;

  const stored = {
    ...message,
    plays: [...(message.plays ?? []), { userId: member.userId, at: now, shared }],
  };
  for (const [viewerId, cursor] of cursors) {
    app.realtime.emitToUser(viewerId, 'message:played', {
      message: toMessage(stored, viewerId),
      cursor,
    });
  }
  return answer;
}
