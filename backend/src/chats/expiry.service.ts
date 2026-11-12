import type { FastifyInstance } from 'fastify';
import type { ClientSession, Types } from 'mongoose';
import type { ChatDoc, ChatMemberDoc, LastMessageSnapshot, MessageDoc } from '../db/chat-models.ts';
import { chatModels, oid } from './chats.service.ts';
import { previewOf, shownLast, toLastMessage } from './message-format.ts';
import { refreshQuotes } from './message-updates.ts';
import { logUpdates } from './updates.ts';
import { canSeeSeq } from './visibility.ts';

export const EXPIRY_BATCH = 200;

/** Disappearing messages whose time is up, soonest first. Index: expiresAt (partial). */
export const dueMessagesQuery = (app: FastifyInstance, now: Date, batch = EXPIRY_BATCH) =>
  chatModels(app)
    .Message.find({ expiresAt: { $type: 'date', $lte: now } })
    .sort({ expiresAt: 1 })
    .limit(batch);

/** The chat list's copy of a message. */
function snapshotOf(doc: MessageDoc): LastMessageSnapshot {
  const deleted = doc.deletedForEveryoneAt !== null;
  return {
    id: doc._id,
    seq: doc.seq,
    senderId: doc.senderId,
    type: doc.type,
    preview: deleted ? '' : previewOf(doc.media, doc.text, doc.poll),
    ...(doc.system ? { system: doc.system } : {}),
    ...(deleted ? { deleted: true } : {}),
    createdAt: doc.createdAt,
  };
}

interface ExpiredInChat {
  chat: ChatDoc;
  removed: MessageDoc[];
  members: ChatMemberDoc[];
  cursors: Map<string, string>;
  lastChanged: boolean;
}

type Models = ReturnType<typeof chatModels>;

/** Stars, "deleted for me" rows, pins, mentions, reaction and preview lines: nothing points at them. */
async function forget(
  models: Models,
  session: ClientSession,
  chatId: Types.ObjectId,
  removed: MessageDoc[],
  now: Date,
) {
  const { Chat, ChatMember, Media, MessageHidden, Star } = models;
  const gone = removed.map((doc) => doc._id);
  const seqs = removed.map((doc) => doc.seq);
  await Star.deleteMany({ chatId, messageId: { $in: gone } }, { session });
  await MessageHidden.deleteMany({ chatId, messageId: { $in: gone } }, { session });
  await Chat.updateOne(
    { _id: chatId },
    { $pull: { pins: { messageId: { $in: gone } } } },
    { session },
  );
  const files = removed.flatMap((doc) => (doc.media?.id ? [oid(doc.media.id)] : []));
  // The file goes once no forwarded copy still uses it (cleanupDeletedMedia decides).
  await Media.updateMany(
    { _id: { $in: files } },
    { $set: { deleteRequestedAt: now } },
    { session },
  );
  const set = (filter: object, update: object) =>
    ChatMember.updateMany({ chatId, ...filter }, update, { session });
  await set({ 'previewLast.seq': { $in: seqs } }, { $set: { previewLast: null } });
  await set({ 'lastReaction.seq': { $in: seqs } }, { $unset: { lastReaction: 1 } });
  await set({ mentionSeqs: { $in: seqs } }, { $pull: { mentionSeqs: { $in: seqs } } });
}

/** When the chat list showed one of them, it moves back to the newest message left (or none). */
async function moveLastBack(
  models: Models,
  session: ClientSession,
  chatId: Types.ObjectId,
  seqs: number[],
): Promise<boolean> {
  const { Chat, Message } = models;
  const chat = await Chat.findById(chatId).select({ lastMessage: 1 }).session(session).lean();
  if (!chat?.lastMessage || !seqs.includes(chat.lastMessage.seq)) return false;
  const newest = await Message.findOne({ chatId }).sort({ seq: -1 }).session(session).lean();
  await Chat.updateOne(
    { _id: chatId },
    { $set: { lastMessage: newest ? snapshotOf(newest) : null } },
    { session },
  );
  return true;
}

/** A `hidden` row per message for each member who could see it, so a device that was away removes it. */
async function logRemovals(
  models: Models,
  session: ClientSession,
  chatId: Types.ObjectId,
  members: ChatMemberDoc[],
  seqs: number[],
  now: Date,
) {
  const cursors = new Map<string, string>();
  for (const seq of seqs) {
    const told = members.filter((member) => canSeeSeq(member, seq));
    if (told.length === 0) continue;
    const logged = await logUpdates(
      models,
      session,
      told.map((member) => member.userId),
      { kind: 'hidden', chatId, seq },
      now,
    );
    for (const [userId, cursor] of logged) cursors.set(userId, cursor);
  }
  return cursors;
}

/**
 * Deletes these messages of one chat, and everything that would still show them, in one transaction.
 * Each member's update log says so, so a device that was away removes them on its next sync
 * (`removed`), even if its own clock-based purge missed them.
 */
async function expireInChat(
  app: FastifyInstance,
  chatId: Types.ObjectId,
  ids: Types.ObjectId[],
  now: Date,
): Promise<ExpiredInChat | null> {
  const models = chatModels(app);
  const { Chat, ChatMember, Message } = models;
  return app.mongo.transaction(async (session) => {
    // Read again inside the transaction: another sweep may have got here first.
    const removed = await Message.find({ _id: { $in: ids }, chatId })
      .session(session)
      .lean();
    if (removed.length === 0) return null;
    const seqs = removed.map((doc) => doc.seq);
    await Message.deleteMany({ _id: { $in: removed.map((doc) => doc._id) } }, { session });
    await forget(models, session, chatId, removed, now);
    const lastChanged = await moveLastBack(models, session, chatId, seqs);
    const members = await ChatMember.find({ chatId }).session(session).lean();
    const cursors = await logRemovals(models, session, chatId, members, seqs, now);
    const chat = await Chat.findById(chatId).session(session).lean();
    return chat ? { chat, removed, members, cursors, lastChanged } : null;
  });
}

/** After commit: `messages:expired` to whoever had them, and the chat list line when it moved. */
function announceExpired(app: FastifyInstance, result: ExpiredInChat) {
  const { chat, removed, members, cursors, lastChanged } = result;
  const chatId = chat._id.toString();
  for (const member of members) {
    const seqs = removed.map((doc) => doc.seq).filter((seq) => canSeeSeq(member, seq));
    if (seqs.length === 0) continue;
    const userId = member.userId.toString();
    app.realtime.emitToUser(userId, 'messages:expired', { chatId, seqs });
    if (!lastChanged || member.leftAt) continue;
    const last = shownLast(chat, member);
    app.realtime.emitToUser(userId, 'chat:updated', {
      chatId,
      type: chat.type,
      seq: chat.seq,
      lastMessage: last ? toLastMessage(last) : null,
      lastReadSeq: member.lastReadSeq,
      unreadCount: Math.max(0, chat.seq - member.lastReadSeq),
      lastActivityAt: member.lastActivityAt?.toISOString() ?? null,
      cursor: cursors.get(userId) ?? '0',
    });
  }
}

/**
 * One pass of the disappearing-messages job: deletes up to `batch` messages whose time is up, chat by
 * chat. Their files are only flagged here; the caller runs the media cleanup afterwards.
 */
export async function expireDueMessages(
  app: FastifyInstance,
  now: Date = new Date(),
  batch = EXPIRY_BATCH,
): Promise<number> {
  const due = await dueMessagesQuery(app, now, batch).select({ _id: 1, chatId: 1 }).lean();
  const byChat = new Map<string, { chatId: Types.ObjectId; ids: Types.ObjectId[] }>();
  for (const doc of due) {
    const entry = byChat.get(doc.chatId.toString()) ?? { chatId: doc.chatId, ids: [] };
    entry.ids.push(doc._id);
    byChat.set(doc.chatId.toString(), entry);
  }
  let expired = 0;
  for (const { chatId, ids } of byChat.values()) {
    const result = await expireInChat(app, chatId, ids, now);
    if (!result) continue;
    expired += result.removed.length;
    announceExpired(app, result);
    // A reply that quoted it (in a chat without the timer, or sent later) no longer shows its text.
    for (const doc of result.removed) {
      await refreshQuotes(app, doc, { text: '', deleted: true });
    }
  }
  return expired;
}
