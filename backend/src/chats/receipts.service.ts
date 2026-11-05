import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import { AppError } from '../lib/errors.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';
import { chatModels, oid, readReceiptsVisible, requireMember } from './chats.service.ts';
import { toLastMessage } from './message-format.ts';
import { logUpdates } from './updates.ts';

/** Whether these two people may see each other's reads. Checked for every event sent. */
export async function readsVisibleBetween(
  app: FastifyInstance,
  userIds: string[],
): Promise<boolean> {
  const users = (await usersModel(app)
    .find({ _id: { $in: userIds.map(oid) } })
    .select({ privacy: 1 })
    .lean()) as UserDoc[];
  return readReceiptsVisible(users[0], users[1]);
}

/** The other member of a direct chat; null for anything else, which has no receipts yet. */
async function peerOf(
  app: FastifyInstance,
  chat: { _id: Types.ObjectId; type: string },
  userId: string,
) {
  if (chat.type !== 'direct') return null;
  return chatModels(app)
    .ChatMember.findOne({ chatId: chat._id, userId: { $ne: oid(userId) } })
    .select({ userId: 1 })
    .lean();
}

/** Moves my read position forward (never back), tells my other devices and, if allowed, the sender. */
export async function markRead(app: FastifyInstance, userId: string, chatId: string, seq: number) {
  const member = await requireMember(app, chatId, userId);
  const models = chatModels(app);
  const chat = await models.Chat.findById(chatId).lean();
  if (!chat) throw new AppError('NOT_FOUND', 'Chat not found.');
  const target = Math.min(seq, chat.seq);
  const answer = (lastReadSeq: number) => ({
    chatId,
    lastReadSeq,
    unreadCount: Math.max(0, chat.seq - lastReadSeq),
  });
  if (target <= member.lastReadSeq) return answer(member.lastReadSeq);

  const peer = await peerOf(app, chat, userId);
  const visible = peer ? await readsVisibleBetween(app, [userId, peer.userId.toString()]) : false;
  // Reading also means having received. With receipts off, that is all the sender may learn.
  const lastDeliveredSeq = Math.max(member.lastDeliveredSeq, target);
  const tellPeer = peer && (visible || lastDeliveredSeq > member.lastDeliveredSeq) ? peer : null;

  const now = new Date();
  const cursors = await app.mongo.transaction(async (session) => {
    const moved = await models.ChatMember.updateOne(
      { chatId: chat._id, userId: member.userId, lastReadSeq: { $lt: target } },
      { $set: { lastReadSeq: target }, $max: { lastDeliveredSeq } },
      { session },
    );
    if (moved.modifiedCount === 0) return null;
    const mine = await logUpdates(
      models,
      session,
      [member.userId],
      { kind: 'read', chatId: chat._id },
      now,
    );
    const theirs = tellPeer
      ? await logUpdates(
          models,
          session,
          [tellPeer.userId],
          { kind: 'receipt', chatId: chat._id },
          now,
        )
      : null;
    return {
      mine: mine.get(userId) ?? '0',
      theirs: tellPeer && theirs?.get(tellPeer.userId.toString()),
    };
  });
  // Another device got there first with this position or a later one.
  if (cursors === null) return answer((await requireMember(app, chatId, userId)).lastReadSeq);

  const result = answer(target);
  app.realtime.emitToUser(userId, 'read:update', { ...result, cursor: cursors.mine });
  app.realtime.emitToUser(userId, 'chat:updated', {
    chatId,
    type: chat.type,
    seq: chat.seq,
    lastMessage: chat.lastMessage ? toLastMessage(chat.lastMessage) : null,
    lastReadSeq: target,
    unreadCount: result.unreadCount,
    lastActivityAt: member.lastActivityAt?.toISOString() ?? null,
    cursor: cursors.mine,
  });
  if (tellPeer && cursors.theirs) {
    app.realtime.emitToUser(tellPeer.userId.toString(), 'receipt:update', {
      chatId,
      userId,
      lastDeliveredSeq,
      lastReadSeq: visible ? target : null,
      cursor: cursors.theirs,
    });
  }
  return result;
}

/**
 * One of my devices has stored everything up to `seq`. Moves my delivered position forward (never
 * back) and tells the sender. A second device reporting the same position changes nothing.
 */
export async function markDelivered(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  seq: number,
) {
  const member = await requireMember(app, chatId, userId);
  const models = chatModels(app);
  const chat = await models.Chat.findById(chatId).lean();
  if (!chat) throw new AppError('NOT_FOUND', 'Chat not found.');
  const target = Math.min(seq, chat.seq);
  const answer = (lastDeliveredSeq: number) => ({ chatId, lastDeliveredSeq });
  if (target <= member.lastDeliveredSeq) return answer(member.lastDeliveredSeq);

  const peer = await peerOf(app, chat, userId);
  const cursor = await app.mongo.transaction(async (session) => {
    const moved = await models.ChatMember.updateOne(
      { chatId: chat._id, userId: member.userId, lastDeliveredSeq: { $lt: target } },
      { $set: { lastDeliveredSeq: target } },
      { session },
    );
    if (moved.modifiedCount === 0 || !peer) return null;
    const cursors = await logUpdates(
      models,
      session,
      [peer.userId],
      { kind: 'receipt', chatId: chat._id },
      new Date(),
    );
    return cursors.get(peer.userId.toString()) ?? null;
  });
  if (cursor !== null && peer) {
    const peerId = peer.userId.toString();
    const visible = await readsVisibleBetween(app, [userId, peerId]);
    app.realtime.emitToUser(peerId, 'receipt:update', {
      chatId,
      userId,
      lastDeliveredSeq: target,
      lastReadSeq: visible ? member.lastReadSeq : null,
      cursor,
    });
  }
  return answer(target);
}
