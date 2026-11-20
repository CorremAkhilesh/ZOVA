import type { FastifyInstance } from 'fastify';
import type { ClientSession, Types } from 'mongoose';
import type { ChatDoc, ChatMemberDoc } from '../db/chat-models.ts';
import { chatModels, oid } from './chats.service.ts';
import { shownLast, toLastMessage } from './message-format.ts';
import { visiblePins } from './pin-view.ts';
import { logUpdates } from './updates.ts';

/** Who hears that a chat's pins changed, and their sync cursors (logged in the same transaction). */
export interface PinsChange {
  chatId: Types.ObjectId;
  members: ChatMemberDoc[];
  cursors: Map<string, string>;
}

/** Logs a chat change for its current members (`only`: just these), so devices that were away refresh it. */
export async function logPins(
  app: FastifyInstance,
  session: ClientSession,
  chatId: Types.ObjectId,
  only?: Types.ObjectId[],
): Promise<PinsChange> {
  const models = chatModels(app);
  const members = (await models.ChatMember.find({
    chatId,
    leftAt: null,
    ...(only ? { userId: { $in: only } } : {}),
  })
    .session(session)
    .lean()) as ChatMemberDoc[];
  const cursors = await logUpdates(
    models,
    session,
    members.map((item) => item.userId),
    { kind: 'chat', chatId },
    new Date(),
  );
  return { chatId, members, cursors };
}

/**
 * Unpins these messages (deleted for everyone, or gone with a timer) inside the caller's
 * transaction. Null when none was pinned; otherwise announce the change after commit.
 */
export async function dropPins(
  app: FastifyInstance,
  session: ClientSession,
  chatId: Types.ObjectId,
  messageIds: Types.ObjectId[],
): Promise<PinsChange | null> {
  const result = await chatModels(app).Chat.updateOne(
    { _id: chatId, 'pins.messageId': { $in: messageIds } },
    { $pull: { pins: { messageId: { $in: messageIds } } } },
    { session },
  );
  return result.modifiedCount > 0 ? logPins(app, session, chatId) : null;
}

/** Of a chat's pinned messages, those each member deleted for themselves ("delete for me"). */
export async function hiddenPinsByUser(
  app: FastifyInstance,
  chat: Pick<ChatDoc, '_id' | 'pins'>,
  userIds?: Types.ObjectId[],
): Promise<Map<string, Set<string>>> {
  const ids = (chat.pins ?? []).map((pin) => pin.messageId);
  const byUser = new Map<string, Set<string>>();
  if (ids.length === 0) return byUser;
  // Index: { chatId, messageId, userId }.
  const rows = await chatModels(app)
    .MessageHidden.find({
      chatId: chat._id,
      messageId: { $in: ids },
      ...(userIds ? { userId: { $in: userIds } } : {}),
    })
    .select({ userId: 1, messageId: 1 })
    .lean();
  for (const row of rows) {
    const key = row.userId.toString();
    const set = byUser.get(key) ?? new Set<string>();
    set.add(row.messageId.toString());
    byUser.set(key, set);
  }
  return byUser;
}

/** After commit: each member's devices get the chat's pins as that member may see them now. */
export async function announcePins(app: FastifyInstance, change: PinsChange | null) {
  if (!change || change.members.length === 0) return;
  const chat = (await chatModels(app).Chat.findById(change.chatId).lean()) as ChatDoc | null;
  if (!chat) return;
  const hidden = await hiddenPinsByUser(
    app,
    chat,
    change.members.map((member) => member.userId),
  );
  for (const member of change.members) {
    const userId = member.userId.toString();
    const last = shownLast(chat, member);
    const seq = member.leftSeq ?? chat.seq;
    app.realtime.emitToUser(userId, 'chat:updated', {
      chatId: chat._id.toString(),
      type: chat.type,
      seq,
      lastMessage: last ? toLastMessage(last) : null,
      lastReadSeq: member.lastReadSeq,
      unreadCount: Math.max(0, seq - member.lastReadSeq),
      lastActivityAt: member.lastActivityAt?.toISOString() ?? null,
      pins: visiblePins(chat.pins, member, Date.now(), hidden.get(userId)),
      cursor: change.cursors.get(userId) ?? '0',
    });
  }
}

/** For my chat list: per chat, the pinned messages I deleted for myself. One query. */
export async function myHiddenPins(
  app: FastifyInstance,
  userId: string,
  chats: Pick<ChatDoc, '_id' | 'pins'>[],
): Promise<Map<string, Set<string>>> {
  const pinned = chats.filter((chat) => (chat.pins ?? []).length > 0);
  const byChat = new Map<string, Set<string>>();
  if (pinned.length === 0) return byChat;
  // Index: { userId, chatId, messageId }.
  const rows = await chatModels(app)
    .MessageHidden.find({
      userId: oid(userId),
      chatId: { $in: pinned.map((chat) => chat._id) },
      messageId: { $in: pinned.flatMap((chat) => (chat.pins ?? []).map((pin) => pin.messageId)) },
    })
    .select({ chatId: 1, messageId: 1 })
    .lean();
  for (const row of rows) {
    const key = row.chatId.toString();
    const set = byChat.get(key) ?? new Set<string>();
    set.add(row.messageId.toString());
    byChat.set(key, set);
  }
  return byChat;
}
