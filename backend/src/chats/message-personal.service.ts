import type { FastifyInstance } from 'fastify';
import type { ChatMemberDoc, LastMessageSnapshot, MessageDoc } from '../db/chat-models.ts';
import { announceOwnChat } from './chat-prefs.service.ts';
import { chatModels } from './chats.service.ts';
import { hiddenIds } from './history.service.ts';
import { assertActionable } from './message-actions.service.ts';
import { previewOf, shownLast } from './message-format.ts';
import {
  announceMessageUpdate,
  logMessageUpdate,
  requireVisibleMessage,
} from './message-updates.ts';
import { senderNameOf } from './sender-name.ts';
import { logUpdates } from './updates.ts';
import { visibleSeqs } from './visibility.ts';

/** The most recent message I can still see before this one. */
async function previewBefore(
  app: FastifyInstance,
  userId: string,
  member: ChatMemberDoc,
  doc: MessageDoc,
): Promise<LastMessageSnapshot | null> {
  const earlier = await chatModels(app)
    .Message.findOne({
      chatId: doc.chatId,
      seq: { ...visibleSeqs(member), $lt: doc.seq },
      _id: { $nin: await hiddenIds(app, userId, doc.chatId.toString()) },
    })
    .sort({ seq: -1 })
    .lean();
  if (!earlier) return null;
  return {
    id: earlier._id,
    seq: earlier.seq,
    senderId: earlier.senderId,
    senderName: await senderNameOf(app, earlier.senderId),
    type: earlier.type,
    preview: previewOf(earlier.media, earlier.text, earlier.poll),
    system: earlier.system ?? null,
    deleted: earlier.deletedForEveryoneAt !== null,
    createdAt: earlier.createdAt,
  };
}

/** Any message I can see. Nobody else notices. */
export async function deleteForMe(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
) {
  const { doc, member } = await requireVisibleMessage(
    app,
    userId,
    chatId,
    messageId,
    'participant',
  );
  const models = chatModels(app);
  const { MessageHidden, Star, ChatMember, Chat } = models;
  const now = new Date();
  const chat = await Chat.findById(doc.chatId).select({ lastMessage: 1 }).lean();
  // It was the one showing in my chat list, so the one before takes its place.
  const replaces = chat && shownLast(chat, member)?.seq === doc.seq;
  const previewLast = replaces ? await previewBefore(app, userId, member, doc) : null;
  const cursors = await app.mongo.transaction(async (session) => {
    await MessageHidden.updateOne(
      { userId: member.userId, chatId: doc.chatId, messageId: doc._id },
      { $setOnInsert: { seq: doc.seq, createdAt: now } },
      { upsert: true, session },
    );
    await Star.deleteMany({ userId: member.userId, messageId: doc._id }, { session });
    if (replaces) {
      await ChatMember.updateOne(
        { _id: member._id },
        { $set: { previewFloor: chat.lastMessage?.seq ?? doc.seq, previewLast } },
        { session },
      );
    }
    return logUpdates(
      models,
      session,
      [member.userId],
      { kind: 'hidden', chatId: doc.chatId, seq: doc.seq },
      now,
    );
  });
  const cursor = cursors.get(userId) ?? '0';
  app.realtime.emitToUser(userId, 'message:removed', { chatId, seq: doc.seq, cursor });
  if (replaces) await announceOwnChat(app, userId, chatId, cursor);
}

export async function setStar(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
  starred: boolean,
) {
  const { doc, member } = await requireVisibleMessage(
    app,
    userId,
    chatId,
    messageId,
    'participant',
  );
  if (starred) assertActionable(doc);
  const { Star } = chatModels(app);
  const pending = await app.mongo.transaction(async (session) => {
    if (starred) {
      await Star.updateOne(
        { userId: member.userId, messageId: doc._id },
        { $setOnInsert: { chatId: doc.chatId, seq: doc.seq, at: new Date() } },
        { upsert: true, session },
      );
    } else {
      await Star.deleteOne({ userId: member.userId, messageId: doc._id }, { session });
    }
    return logMessageUpdate(app, session, doc, { only: member.userId });
  });
  announceMessageUpdate(app, pending, { userId, starred });
}
