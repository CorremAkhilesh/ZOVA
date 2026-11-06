import type { ReplyQuote } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { ClientSession, Types } from 'mongoose';
import type { ChatDoc, ChatMemberDoc, MessageDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { chatModels, oid, requireMember } from './chats.service.ts';
import { namesOf } from './group-core.ts';
import { hideQuote, previewOf, shownLast, toLastMessage, toMessage } from './message-format.ts';
import { logUpdates } from './updates.ts';
import { canSeeSeq, requireParticipant } from './visibility.ts';

/** A message this person may act on: in a chat they are in, and one they are able to see. */
export async function requireVisibleMessage(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
  access: 'member' | 'participant' = 'member',
) {
  const member =
    access === 'member'
      ? await requireMember(app, chatId, userId)
      : await requireParticipant(app, chatId, userId);
  const { Message, MessageHidden } = chatModels(app);
  const doc = await Message.findOne({ _id: oid(messageId), chatId: oid(chatId) }).lean();
  const hidden =
    doc &&
    (await MessageHidden.exists({
      userId: oid(userId),
      chatId: oid(chatId),
      messageId: doc._id,
    }));
  // Earlier than they joined, hidden, or not there: all the same answer.
  if (!doc || hidden || !canSeeSeq(member, doc.seq)) {
    throw new AppError('NOT_FOUND', 'Message not found.');
  }
  return { doc, member };
}

/** What a reply shows. Only something I can see myself, and in a chat I am or was in. */
export async function quoteOf(
  app: FastifyInstance,
  userId: string,
  ref: { chatId: string; messageId: string },
): Promise<ReplyQuote> {
  const { doc } = await requireVisibleMessage(
    app,
    userId,
    ref.chatId,
    ref.messageId,
    'participant',
  );
  if (doc.deletedForEveryoneAt || doc.type === 'system') {
    throw new AppError('BAD_REQUEST', 'This message cannot be replied to.');
  }
  const senderId = doc.senderId?.toString() ?? null;
  return {
    id: doc._id.toString(),
    chatId: ref.chatId,
    seq: doc.seq,
    senderId,
    senderName: senderId ? (await namesOf(app, [senderId]))(senderId).name : '',
    type: doc.type,
    text: previewOf(doc.media, doc.text),
    mediaId: doc.media?.hasThumbnail ? doc.media.id : null,
    hasThumbnail: doc.media?.hasThumbnail === true,
    deleted: false,
  };
}

/**
 * Who should hear that this message changed: whoever can see it and has not hidden it. That includes
 * those who left, since they keep this history, and what was deleted must go from their copy too.
 */
async function audience(
  app: FastifyInstance,
  session: ClientSession,
  doc: MessageDoc,
): Promise<ChatMemberDoc[]> {
  const { ChatMember, MessageHidden } = chatModels(app);
  const members = await ChatMember.find({ chatId: doc.chatId }).session(session).lean();
  const hidden = await MessageHidden.find({
    chatId: doc.chatId,
    messageId: doc._id,
    userId: { $in: members.map((member) => member.userId) },
  })
    .select({ userId: 1 })
    .session(session)
    .lean();
  const hiddenBy = new Set(hidden.map((row) => row.userId.toString()));
  return members.filter(
    (member) => canSeeSeq(member, doc.seq) && !hiddenBy.has(member.userId.toString()),
  );
}

export interface PendingAnnouncement {
  doc: MessageDoc;
  members: ChatMemberDoc[];
  cursors: Map<string, string>;
  chat: ChatDoc | null;
}

/**
 * Logs a change to a message for everyone who can see it, inside the caller's transaction, so a device
 * that was offline gets the latest copy when it next syncs.
 */
export async function logMessageUpdate(
  app: FastifyInstance,
  session: ClientSession,
  doc: MessageDoc,
  options: { only?: Types.ObjectId; chatChanged?: boolean } = {},
): Promise<PendingAnnouncement> {
  const models = chatModels(app);
  const members = options.only
    ? (await audience(app, session, doc)).filter((member) => member.userId.equals(options.only))
    : await audience(app, session, doc);
  const cursors = await logUpdates(
    models,
    session,
    members.map((member) => member.userId),
    { kind: 'updated', chatId: doc.chatId, seq: doc.seq },
    new Date(),
  );
  const chat = options.chatChanged
    ? await models.Chat.findById(doc.chatId).session(session).lean()
    : null;
  return { doc, members, cursors, chat };
}

/** After commit. `starred` is only known for the person who starred it, so `stars` says for whom. */
export function announceMessageUpdate(
  app: FastifyInstance,
  pending: PendingAnnouncement,
  stars?: { userId: string; starred: boolean },
) {
  const { doc, members, cursors, chat } = pending;
  for (const member of members) {
    const viewerId = member.userId.toString();
    const cursor = cursors.get(viewerId) ?? '0';
    const message = hideQuote(toMessage(doc, viewerId), member);
    app.realtime.emitToUser(viewerId, 'message:updated', {
      message: stars?.userId === viewerId ? { ...message, starred: stars.starred } : message,
      cursor,
    });
    if (chat?.lastMessage && !member.leftAt) {
      app.realtime.emitToUser(viewerId, 'chat:updated', {
        chatId: chat._id.toString(),
        type: chat.type,
        seq: chat.seq,
        lastMessage: toLastMessage(shownLast(chat, member) ?? chat.lastMessage),
        lastReadSeq: member.lastReadSeq,
        unreadCount: Math.max(0, chat.seq - member.lastReadSeq),
        lastActivityAt: chat.lastActivityAt?.toISOString() ?? null,
        cursor,
      });
    }
  }
}

/** Quotes of a message change with it, so what was deleted cannot live on in a reply. */
export async function refreshQuotes(
  app: FastifyInstance,
  original: MessageDoc,
  quote: { text: string; deleted: boolean },
) {
  const { Message } = chatModels(app);
  const replies = await Message.find({ 'replyTo.id': original._id.toString() }).limit(100).lean();
  for (const reply of replies) {
    const replyTo = reply.replyTo ? { ...reply.replyTo, ...quote } : null;
    if (quote.deleted && replyTo) {
      replyTo.mediaId = null;
      replyTo.hasThumbnail = false;
    }
    const pending = await app.mongo.transaction(async (session) => {
      await Message.updateOne({ _id: reply._id }, { $set: { replyTo } }, { session });
      return logMessageUpdate(app, session, { ...reply, replyTo });
    });
    announceMessageUpdate(app, pending);
  }
}
