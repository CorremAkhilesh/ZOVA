import type { Message } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import type { ChatDoc, LastMessageSnapshot, MessageDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { KeyedQueue } from '../lib/keyed-queue.ts';
import { usersModel } from '../users/user-record.ts';
import { chatModels, isDuplicateKey, oid, requireMember } from './chats.service.ts';
import { toLastMessage, toMessage, toPreview } from './message-format.ts';
import { readsVisibleBetween } from './receipts.service.ts';
import { logUpdates } from './updates.ts';

/** Sends to one chat run one at a time per process, so they do not abort each other in MongoDB. */
const sendQueue = new KeyedQueue();

export interface SendInput {
  userId: string;
  chatId: string;
  clientMsgId: string;
  text: string;
}

export interface SendResult {
  message: Message;
  /** This clientMsgId had been sent before: nothing new was stored or delivered. */
  duplicate: boolean;
}

async function findOriginal(app: FastifyInstance, input: SendInput): Promise<SendResult | null> {
  const original = await chatModels(app)
    .Message.findOne({
      senderId: oid(input.userId),
      clientMsgId: { $eq: input.clientMsgId, $type: 'string' },
    })
    .lean();
  if (!original) return null;
  if (original.chatId.toString() !== input.chatId) {
    throw new AppError('CONFLICT', 'This message id was already used in another chat.');
  }
  return { message: toMessage(original), duplicate: true };
}

/** A 1:1 chat cannot receive new messages once the other person is deactivated. */
async function assertRecipientActive(app: FastifyInstance, chatId: string, userId: string) {
  const { Chat, ChatMember } = chatModels(app);
  const chat = await Chat.findById(chatId, { type: 1 }).lean();
  if (chat?.type !== 'direct') return;
  const other = await ChatMember.findOne({ chatId: oid(chatId), userId: { $ne: oid(userId) } })
    .select({ userId: 1 })
    .lean();
  const deactivated =
    other && (await usersModel(app).exists({ _id: other.userId, status: 'deactivated' }));
  if (deactivated) throw new AppError('FORBIDDEN', 'This account has been deactivated.');
}

interface DeliveredMember {
  userId: string;
  lastReadSeq: number;
  lastDeliveredSeq: number;
  cursor: string;
}

/** Tells every member's devices: the message, and the chat as that member now sees it. */
async function deliver(
  app: FastifyInstance,
  message: Message,
  chat: Pick<ChatDoc, 'type'> & { lastMessage: LastMessageSnapshot },
  members: DeliveredMember[],
) {
  const receipts =
    chat.type === 'direct'
      ? await readsVisibleBetween(
          app,
          members.map((member) => member.userId),
        )
      : false;
  for (const { userId, lastReadSeq, cursor } of members) {
    const peer = chat.type === 'direct' ? members.find((m) => m.userId !== userId) : undefined;
    app.realtime.emitToUser(userId, 'message:new', { message, cursor });
    app.realtime.emitToUser(userId, 'chat:updated', {
      chatId: message.chatId,
      type: chat.type,
      seq: message.seq,
      lastMessage: toLastMessage(chat.lastMessage),
      lastReadSeq,
      unreadCount: Math.max(0, message.seq - lastReadSeq),
      lastActivityAt: message.createdAt,
      ...(peer
        ? {
            peerDeliveredSeq: peer.lastDeliveredSeq,
            peerReadSeq: receipts ? peer.lastReadSeq : null,
          }
        : {}),
      cursor,
    });
  }
}

/**
 * Stores a message. Position, chat snapshot, member activity and each member's update log all
 * change in one transaction: an aborted send leaves no gap, a committed one leaves no holes.
 * Sending the same clientMsgId again returns the original message.
 */
export async function sendMessage(app: FastifyInstance, input: SendInput): Promise<SendResult> {
  const { userId, chatId, text, clientMsgId } = input;
  await requireMember(app, chatId, userId);
  const earlier = await findOriginal(app, input);
  if (earlier) return earlier;
  await assertRecipientActive(app, chatId, userId);

  const models = chatModels(app);
  const chatOid = oid(chatId);
  const senderId = oid(userId);
  try {
    const stored = await sendQueue.run(chatId, () =>
      app.mongo.transaction(async (session) => {
        const now = new Date();
        const chat = await models.Chat.findOneAndUpdate(
          { _id: chatOid },
          { $inc: { seq: 1 } },
          { returnDocument: 'after', session },
        ).lean();
        if (!chat) throw new AppError('NOT_FOUND', 'Chat not found.');
        const id = new Types.ObjectId();
        const lastMessage: LastMessageSnapshot = {
          id,
          seq: chat.seq,
          senderId,
          type: 'text',
          preview: toPreview(text),
          createdAt: now,
        };
        await models.Chat.updateOne(
          { _id: chatOid },
          { $set: { lastMessage, lastActivityAt: now } },
          { session },
        );
        const doc: MessageDoc = {
          _id: id,
          chatId: chatOid,
          seq: chat.seq,
          clientMsgId,
          senderId,
          type: 'text',
          text,
          replyToId: null,
          editedAt: null,
          deletedForEveryoneAt: null,
          createdAt: now,
        };
        await models.Message.insertMany([doc], { session });
        await models.ChatMember.updateMany(
          { chatId: chatOid, leftAt: null },
          { $set: { lastActivityAt: now } },
          { session },
        );
        // My own messages count as received and read by me.
        await models.ChatMember.updateOne(
          { chatId: chatOid, userId: senderId },
          { $max: { lastReadSeq: chat.seq, lastDeliveredSeq: chat.seq } },
          { session },
        );
        const members = await models.ChatMember.find({ chatId: chatOid, leftAt: null })
          .select({ userId: 1, lastReadSeq: 1, lastDeliveredSeq: 1 })
          .session(session)
          .lean();
        const cursors = await logUpdates(
          models,
          session,
          members.map((member) => member.userId),
          { kind: 'message', chatId: chatOid, seq: chat.seq },
          now,
        );
        return {
          message: toMessage(doc),
          chat: { type: chat.type, lastMessage },
          members: members.map((member) => ({
            userId: member.userId.toString(),
            lastReadSeq: member.lastReadSeq,
            lastDeliveredSeq: member.lastDeliveredSeq,
            cursor: cursors.get(member.userId.toString()) ?? '0',
          })),
        };
      }),
    );
    await deliver(app, stored.message, stored.chat, stored.members);
    return { message: stored.message, duplicate: false };
  } catch (error) {
    // Two sends of the same clientMsgId raced: the unique index let one through.
    if (isDuplicateKey(error)) {
      const original = await findOriginal(app, input);
      if (original) return original;
    }
    throw error;
  }
}

/** A page of history, always oldest first. Newest page by default; `after` reads forward. */
export async function getHistory(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  query: { before?: number | undefined; after?: number | undefined; limit: number },
) {
  await requireMember(app, chatId, userId);
  const { before, after, limit } = query;
  const seq = {
    ...(before !== undefined ? { $lt: before } : {}),
    ...(after !== undefined ? { $gt: after } : {}),
  };
  const forward = after !== undefined && before === undefined;
  const docs = await chatModels(app)
    .Message.find({ chatId: oid(chatId), ...(Object.keys(seq).length ? { seq } : {}) })
    .sort({ seq: forward ? 1 : -1 })
    .limit(limit + 1)
    .lean();
  const page = docs.slice(0, limit);
  if (!forward) page.reverse();
  return { items: page.map(toMessage), hasMore: docs.length > limit };
}
