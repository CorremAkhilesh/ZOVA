import { DEFAULT_GROUP_SETTINGS, type MediaInfo, type Message } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { type ClientSession, Types } from 'mongoose';
import type { ChatDoc, ChatMemberDoc, LastMessageSnapshot, MessageDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { KeyedQueue } from '../lib/keyed-queue.ts';
import { attachMedia, toMediaInfo } from '../media/media.service.ts';
import { usersModel } from '../users/user-record.ts';
import {
  chatModels,
  isDuplicateKey,
  oid,
  requireMember,
  requireParticipant,
  visibleSeqs,
} from './chats.service.ts';
import { noteGroupActivity } from './group-activity.ts';
import { assertAllowed, groupRules } from './group-permissions.ts';
import { refreshGroupMarks } from './group-receipts.service.ts';
import { toLastMessage, toMediaPreview, toMessage, toPreview } from './message-format.ts';
import { readsVisibleBetween } from './receipts.service.ts';
import { logUpdates } from './updates.ts';

/** Sends to one chat run one at a time per process, so they do not abort each other in MongoDB. */
const sendQueue = new KeyedQueue();

export interface SendInput {
  userId: string;
  chatId: string;
  clientMsgId: string;
  /** Text, or the caption on media. */
  text?: string | undefined;
  mediaId?: string | undefined;
  albumId?: string | undefined;
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
  return { message: toMessage(original, input.userId), duplicate: true };
}

/** A group may let only admins speak. A 1:1 chat cannot receive messages once the other person is gone. */
async function assertMaySend(
  app: FastifyInstance,
  chatId: string,
  userId: string,
  member: ChatMemberDoc,
) {
  const { Chat, ChatMember } = chatModels(app);
  const chat = await Chat.findById(chatId, { type: 1, group: 1 }).lean();
  if (chat?.type === 'group') {
    const settings = { ...DEFAULT_GROUP_SETTINGS, ...chat.group?.settings };
    assertAllowed(groupRules.sendMessages(member.role, settings), 'Only admins can send messages.');
    return null;
  }
  if (chat?.type !== 'direct') return null;
  const other = await ChatMember.findOne({ chatId: oid(chatId), userId: { $ne: oid(userId) } })
    .select({ userId: 1 })
    .lean();
  const deactivated =
    other && (await usersModel(app).exists({ _id: other.userId, status: 'deactivated' }));
  if (deactivated) throw new AppError('FORBIDDEN', 'This account has been deactivated.');
  return other?.userId.toString() ?? null;
}

async function attachIfAny(
  app: FastifyInstance,
  session: ClientSession,
  input: { mediaId: string | undefined; userId: string; chatId: string; messageId: Types.ObjectId },
): Promise<MediaInfo | null> {
  const { mediaId } = input;
  return mediaId ? toMediaInfo(await attachMedia(app, session, { ...input, mediaId })) : null;
}

const typeOf = (media: MediaInfo | null) => media?.kind ?? 'text';
const previewOf = (media: MediaInfo | null, text: string | undefined) =>
  media ? toMediaPreview(media, text) : toPreview(text ?? '');

interface DeliveredMember {
  userId: string;
  lastReadSeq: number;
  lastDeliveredSeq: number;
  sharedReadSeq: number;
  cursor: string;
}

/** Tells every member's devices: the message, and the chat as that member now sees it. */
function deliver(
  app: FastifyInstance,
  message: Message,
  chat: Pick<ChatDoc, 'type'> & { lastMessage: LastMessageSnapshot },
  members: DeliveredMember[],
) {
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
            peerReadSeq: peer.sharedReadSeq,
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
  const { userId, chatId, text, clientMsgId, mediaId, albumId } = input;
  const sender = await requireMember(app, chatId, userId);
  const earlier = await findOriginal(app, input);
  if (earlier) return earlier;
  const peerId = await assertMaySend(app, chatId, userId, sender);
  // Read positions a reply reveals are decided before anything changes.
  const shareRead = peerId ? await readsVisibleBetween(app, [userId, peerId]) : false;

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
        const media = await attachIfAny(app, session, { mediaId, userId, chatId, messageId: id });
        const type = typeOf(media);
        const lastMessage: LastMessageSnapshot = {
          id,
          seq: chat.seq,
          senderId,
          type,
          preview: previewOf(media, text),
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
          type,
          text: text ?? null,
          media,
          albumId: albumId ?? null,
          replyToId: null,
          editedAt: null,
          deletedForEveryoneAt: null,
          createdAt: now,
        };
        await models.Message.insertMany([doc], { session });
        // My own messages count as received and read by me.
        await models.ChatMember.updateOne(
          { chatId: chatOid, userId: senderId },
          {
            $max: {
              lastReadSeq: chat.seq,
              lastDeliveredSeq: chat.seq,
              ackReadSeq: chat.seq,
              ...(shareRead && { sharedReadSeq: chat.seq }),
            },
          },
          { session },
        );
        const members = await models.ChatMember.find({ chatId: chatOid, leftAt: null })
          .select({ userId: 1, lastReadSeq: 1, lastDeliveredSeq: 1, sharedReadSeq: 1 })
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
          // Nobody has played it yet, so it reads the same for every member.
          message: toMessage(doc, userId),
          chat: { type: chat.type, lastMessage },
          members: members.map((member) => ({
            userId: member.userId.toString(),
            lastReadSeq: member.lastReadSeq,
            lastDeliveredSeq: member.lastDeliveredSeq,
            sharedReadSeq: member.sharedReadSeq ?? member.lastReadSeq,
            cursor: cursors.get(member.userId.toString()) ?? '0',
          })),
        };
      }),
    );
    deliver(app, stored.message, stored.chat, stored.members);
    const at = new Date(stored.message.createdAt);
    if (stored.chat.type === 'group') {
      noteGroupActivity(app, chatId, at);
    } else {
      // Also brings a chat into the other person's list at its first message.
      await models.ChatMember.updateMany(
        { chatId: chatOid, leftAt: null },
        { $max: { lastActivityAt: at } },
      );
    }
    if (stored.chat.type === 'group') {
      // The sender may have been the last one behind.
      void refreshGroupMarks(app, chatId).catch((error: unknown) =>
        app.log.warn({ err: error }, 'could not refresh group ticks'),
      );
    }
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
  const member = await requireParticipant(app, chatId, userId);
  const { before, after, limit } = query;
  const allowed = visibleSeqs(member);
  const lowest = Math.max(after ?? 0, allowed.$gt ?? 0);
  const seq = {
    ...(before !== undefined ? { $lt: before } : {}),
    ...(lowest > 0 ? { $gt: lowest } : {}),
    ...(allowed.$lte !== undefined ? { $lte: allowed.$lte } : {}),
  };
  const forward = after !== undefined && before === undefined;
  const docs = await chatModels(app)
    .Message.find({ chatId: oid(chatId), ...(Object.keys(seq).length ? { seq } : {}) })
    .sort({ seq: forward ? 1 : -1 })
    .limit(limit + 1)
    .lean();
  const page = docs.slice(0, limit);
  if (!forward) page.reverse();
  return { items: page.map((doc) => toMessage(doc, userId)), hasMore: docs.length > limit };
}

const GALLERY_TYPES = { media: ['image', 'video'], docs: ['document', 'audio'] } as const;

/** Newest first: the "Media" and "Docs" tabs in chat info. Members only. */
export async function chatGallery(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  query: { tab: 'media' | 'docs'; before?: number | undefined; limit: number },
) {
  const member = await requireParticipant(app, chatId, userId);
  const seq = {
    ...visibleSeqs(member),
    ...(query.before !== undefined ? { $lt: query.before } : {}),
  };
  const docs = await chatModels(app)
    .Message.find({
      chatId: oid(chatId),
      type: { $in: [...GALLERY_TYPES[query.tab]] },
      ...(Object.keys(seq).length ? { seq } : {}),
    })
    .sort({ seq: -1 })
    .limit(query.limit + 1)
    .lean();
  return {
    items: docs.slice(0, query.limit).map((doc) => toMessage(doc, userId)),
    hasMore: docs.length > query.limit,
  };
}
