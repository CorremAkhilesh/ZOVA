import {
  DEFAULT_GROUP_SETTINGS,
  type MediaInfo,
  type Message,
  type ReplyQuote,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { type ClientSession, Types } from 'mongoose';
import type { ChatDoc, ChatMemberDoc, LastMessageSnapshot, MessageDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { KeyedQueue } from '../lib/keyed-queue.ts';
import { attachMedia, toMediaInfo } from '../media/media.service.ts';
import { assertNotBlocked } from '../moderation/blocks.service.ts';
import { usersModel } from '../users/user-record.ts';
import { chatModels, isDuplicateKey, oid, requireMember } from './chats.service.ts';
import { noteGroupActivity } from './group-activity.ts';
import { assertAllowed, groupRules } from './group-permissions.ts';
import { refreshGroupMarks } from './group-receipts.service.ts';
import { hideQuote, previewOf, toLastMessage, toMessage } from './message-format.ts';
import { quoteOf } from './message-updates.ts';
import { readsVisibleBetween } from './receipts.service.ts';
import { unarchiveForNewMessage } from './unarchive.ts';
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
  replyTo?: { chatId: string; messageId: string } | undefined;
  /** A copy of another message: its file is shared, not attached again. */
  forward?: { media: MediaInfo | null; type: MessageDoc['type']; count: number };
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
  if (other) await assertNotBlocked(app, userId, other.userId.toString());
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

/** A reply's quote, and a forwarded copy's label and count. Absent on most messages. */
function extrasOf(replyTo: ReplyQuote | null, forward: SendInput['forward']) {
  return {
    ...(replyTo ? { replyTo } : {}),
    ...(forward ? { forwarded: true, forwardCount: forward.count } : {}),
  };
}

interface DeliveredMember {
  userId: string;
  lastReadSeq: number;
  lastDeliveredSeq: number;
  sharedReadSeq: number;
  joinSeq?: number | undefined;
  clearedSeq?: number | undefined;
  cursor: string;
  /** This message brought the chat back from this member's archive. */
  unarchived: boolean;
}

/** Tells every member's devices: the message, and the chat as that member now sees it. */
function deliver(
  app: FastifyInstance,
  message: Message,
  chat: Pick<ChatDoc, 'type'> & { lastMessage: LastMessageSnapshot },
  members: DeliveredMember[],
) {
  for (const member of members) {
    const { userId, lastReadSeq, cursor } = member;
    const peer = chat.type === 'direct' ? members.find((m) => m.userId !== userId) : undefined;
    app.realtime.emitToUser(userId, 'message:new', {
      message: hideQuote(message, member),
      cursor,
    });
    app.realtime.emitToUser(userId, 'chat:updated', {
      chatId: message.chatId,
      type: chat.type,
      seq: message.seq,
      lastMessage: toLastMessage(chat.lastMessage),
      lastReadSeq,
      unreadCount: Math.max(0, message.seq - lastReadSeq),
      lastActivityAt: message.createdAt,
      ...(member.unarchived ? { archived: false } : {}),
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
  const { userId, chatId, text, clientMsgId, mediaId, albumId, forward } = input;
  const sender = await requireMember(app, chatId, userId);
  const earlier = await findOriginal(app, input);
  if (earlier) return earlier;
  const peerId = await assertMaySend(app, chatId, userId, sender);
  const replyTo = input.replyTo ? await quoteOf(app, userId, input.replyTo) : null;
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
        // A forwarded copy shares the file it came with: nothing to attach.
        const media = forward
          ? forward.media
          : await attachIfAny(app, session, { mediaId, userId, chatId, messageId: id });
        const type = forward?.type ?? typeOf(media);
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
          ...extrasOf(replyTo, forward),
          replyToId: null,
          editedAt: null,
          deletedForEveryoneAt: null,
          createdAt: now,
        };
        await models.Message.insertMany([doc], { session });
        // A group writes this at most once a second instead: see group-activity.ts.
        if (chat.type !== 'group') {
          await models.ChatMember.updateMany(
            { chatId: chatOid, leftAt: null },
            { $set: { lastActivityAt: now } },
            { session },
          );
        }
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
          .select({
            userId: 1,
            lastReadSeq: 1,
            lastDeliveredSeq: 1,
            sharedReadSeq: 1,
            joinSeq: 1,
            clearedSeq: 1,
            archivedAt: 1,
          })
          .session(session)
          .lean();
        const unarchived = await unarchiveForNewMessage(app, session, chatOid, members, senderId);
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
            joinSeq: member.joinSeq,
            clearedSeq: member.clearedSeq,
            cursor: cursors.get(member.userId.toString()) ?? '0',
            unarchived: unarchived.has(member.userId.toString()),
          })),
        };
      }),
    );
    deliver(app, stored.message, stored.chat, stored.members);
    if (stored.chat.type === 'group') {
      noteGroupActivity(app, chatId, new Date(stored.message.createdAt));
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
