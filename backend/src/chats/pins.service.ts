import {
  DEFAULT_GROUP_SETTINGS,
  PIN_DURATION_MS,
  PINNED_MESSAGES_MAX,
  type PinDuration,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { ClientSession, Types } from 'mongoose';
import type { ChatDoc, ChatMemberDoc, StoredPin } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { chatModels, oid, requireMember } from './chats.service.ts';
import { appendSystemMessage, deliverSystemMessage, namesOf } from './group-core.ts';
import { assertAllowed, groupRules } from './group-permissions.ts';
import { shownLast, toLastMessage } from './message-format.ts';
import { visiblePins } from './pin-view.ts';
import { logUpdates } from './updates.ts';
import { canSeeSeq } from './visibility.ts';

const alive = (pins: StoredPin[] | undefined, now: Date) =>
  (pins ?? []).filter((pin) => new Date(pin.expiresAt).getTime() > now.getTime());

/** Who may pin: both people in a 1:1 chat; in a group, as its "Pin messages" setting says. */
async function loadForPin(app: FastifyInstance, userId: string, chatId: string, messageId: string) {
  const member = await requireMember(app, chatId, userId);
  const { Chat, Message } = chatModels(app);
  const chat = (await Chat.findById(chatId).lean()) as ChatDoc | null;
  if (!chat) throw new AppError('NOT_FOUND', 'Chat not found.');
  if (chat.type === 'group') {
    const settings = { ...DEFAULT_GROUP_SETTINGS, ...chat.group?.settings };
    assertAllowed(
      groupRules.pinMessages(member.role, settings),
      'Only admins can pin messages in this group.',
    );
  }
  const message = await Message.findOne({ _id: oid(messageId), chatId: chat._id }).lean();
  // Pinning tells everyone where a message is: only one I may see myself.
  if (!message || !canSeeSeq(member, message.seq) || message.type === 'system') {
    throw new AppError('NOT_FOUND', 'Message not found.');
  }
  if (message.deletedForEveryoneAt) throw new AppError('CONFLICT', 'This message was deleted.');
  return { member, chat, message };
}

/** Every member's devices: the chat's pins as each may see them. */
function announcePins(
  app: FastifyInstance,
  chat: ChatDoc,
  members: ChatMemberDoc[],
  cursors: Map<string, string>,
) {
  for (const member of members) {
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
      pins: visiblePins(chat.pins, member),
      cursor: cursors.get(userId) ?? '0',
    });
  }
}

/**
 * Pins a message for everyone, newest first. A fourth pin replaces the oldest (the app asks first).
 * A "pinned a message" notice goes in the same transaction.
 */
export async function pinMessage(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
  duration: PinDuration,
) {
  const { member, chat, message } = await loadForPin(app, userId, chatId, messageId);
  const now = new Date();
  const pin: StoredPin = {
    messageId: message._id,
    seq: message.seq,
    pinnedBy: member.userId,
    pinnedAt: now,
    expiresAt: new Date(now.getTime() + PIN_DURATION_MS[duration]),
  };
  const others = alive(chat.pins, now).filter((item) => !item.messageId.equals(message._id));
  const pins = [pin, ...others].slice(0, PINNED_MESSAGES_MAX);
  const name = (await namesOf(app, [userId]))(userId);
  const models = chatModels(app);
  const stored = await app.mongo.transaction((session) =>
    appendSystemMessage(
      app,
      session,
      chat._id,
      { kind: 'pinned', actor: name, targets: [], value: String(message.seq) },
      {
        apply: async () => {
          await models.Chat.updateOne({ _id: chat._id }, { $set: { pins } }, { session });
        },
      },
    ),
  );
  deliverSystemMessage(app, stored);
  return { pins: visiblePins(stored.chat.pins, member) };
}

async function logPins(
  app: FastifyInstance,
  session: ClientSession,
  chatId: Types.ObjectId,
): Promise<{ members: ChatMemberDoc[]; cursors: Map<string, string> }> {
  const models = chatModels(app);
  const members = (await models.ChatMember.find({ chatId, leftAt: null })
    .session(session)
    .lean()) as ChatMemberDoc[];
  const cursors = await logUpdates(
    models,
    session,
    members.map((item) => item.userId),
    { kind: 'chat', chatId },
    new Date(),
  );
  return { members, cursors };
}

/** Unpins a message; the same people may do this as may pin. No notice. */
export async function unpinMessage(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
) {
  const { member, chat } = await loadForPin(app, userId, chatId, messageId);
  const models = chatModels(app);
  const result = await app.mongo.transaction(async (session) => {
    await models.Chat.updateOne(
      { _id: chat._id },
      { $pull: { pins: { messageId: oid(messageId) } } },
      { session },
    );
    return logPins(app, session, chat._id);
  });
  const fresh = (await models.Chat.findById(chat._id).lean()) as ChatDoc;
  announcePins(app, fresh, result.members, result.cursors);
  return { pins: visiblePins(fresh.pins, member) };
}

/**
 * Removes pins whose time is up. Members' screens already hide them by their time; this tidies the
 * chat and logs a change so devices that were away refresh it. Runs in the worker (no sockets).
 */
export async function sweepExpiredPins(app: FastifyInstance, now = new Date(), batch = 100) {
  const models = chatModels(app);
  const chats = await models.Chat.find({ 'pins.expiresAt': { $lte: now } })
    .select({ _id: 1 })
    .limit(batch)
    .lean();
  for (const chat of chats) {
    await app.mongo.transaction(async (session) => {
      await models.Chat.updateOne(
        { _id: chat._id },
        { $pull: { pins: { expiresAt: { $lte: now } } } },
        { session },
      );
      await logPins(app, session, chat._id);
    });
  }
  return chats.length;
}
