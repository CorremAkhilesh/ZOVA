import { expiryFor, type MediaInfo, type Message, type PollInput } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import type { LastMessageSnapshot, MessageDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { KeyedQueue } from '../lib/keyed-queue.ts';
import { linkFields } from '../previews/link-previews.service.ts';
import { chatModels, isDuplicateKey, oid, requireMember } from './chats.service.ts';
import { deliver } from './deliver.ts';
import { noteGroupActivity } from './group-activity.ts';
import { refreshGroupMarks } from './group-receipts.service.ts';
import { checkMentions, type MentionInput, mentionFields, recordMentions } from './mentions.ts';
import { previewOf, toMessage } from './message-format.ts';
import { quoteOf } from './message-updates.ts';
import { readsVisibleBetween } from './receipts.service.ts';
import {
  assertKindAllowed,
  assertMaySend,
  attachIfAny,
  extrasOf,
  findOriginal,
  kindFields,
  typeOf,
} from './send-rules.ts';
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
  /** A preview the sender looked up for a link in `text`. */
  linkPreviewId?: string | undefined;
  /** Groups: who the text names, and "@everyone". */
  mentions?: MentionInput['mentions'];
  mentionsEveryone?: boolean | undefined;
  /** A poll instead of text or media. */
  poll?: PollInput | undefined;
  /** A photo or video the others may open once. */
  viewOnce?: boolean | undefined;
}

export interface SendResult {
  message: Message;
  /** This clientMsgId had been sent before: nothing new was stored or delivered. */
  duplicate: boolean;
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
  const links = await linkFields(app, input.linkPreviewId, text);
  const mentioned = await checkMentions(app, oid(chatId), sender, text, input);

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
        assertKindAllowed(chat, input, media);
        const type = input.poll ? 'poll' : (forward?.type ?? typeOf(media));
        const expiresAt = expiryFor(chat.disappearing, now);
        const lastMessage: LastMessageSnapshot = {
          id,
          seq: chat.seq,
          senderId,
          type,
          preview: previewOf(media, text, input.poll),
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
          ...links,
          ...mentionFields(mentioned),
          ...kindFields(input, expiresAt),
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
        if (mentioned) await recordMentions(app, session, chatOid, chat.seq, mentioned.recipients);
        const members = await models.ChatMember.find({ chatId: chatOid, leftAt: null })
          .select({
            userId: 1,
            lastReadSeq: 1,
            lastDeliveredSeq: 1,
            sharedReadSeq: 1,
            joinSeq: 1,
            clearedSeq: 1,
            archivedAt: 1,
            mentionSeqs: 1,
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
            mentionSeqs: mentioned?.recipients.some((id) => id.equals(member.userId))
              ? member.mentionSeqs
              : undefined,
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
