import {
  DEFAULT_GROUP_SETTINGS,
  PIN_DURATION_MS,
  PINNED_MESSAGES_MAX,
  type PinDuration,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import type { ChatDoc, StoredPin } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { chatModels, oid, requireMember } from './chats.service.ts';
import { appendSystemMessage, deliverSystemMessage, namesOf } from './group-core.ts';
import { assertAllowed, groupRules } from './group-permissions.ts';
import { announcePins, dropPins, hiddenPinsByUser, logPins } from './pin-sync.ts';
import { visiblePins } from './pin-view.ts';
import { assertDirectNotBlocked } from './send-rules.ts';
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
  await assertDirectNotBlocked(app, userId, chat);
  const message = await Message.findOne({ _id: oid(messageId), chatId: chat._id }).lean();
  // Pinning tells everyone where a message is: only one I may see myself.
  if (!message || !canSeeSeq(member, message.seq) || message.type === 'system') {
    throw new AppError('NOT_FOUND', 'Message not found.');
  }
  if (message.deletedForEveryoneAt) throw new AppError('CONFLICT', 'This message was deleted.');
  return { member, chat, message };
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
  const hidden = await hiddenPinsByUser(app, stored.chat, [member.userId]);
  return { pins: visiblePins(stored.chat.pins, member, Date.now(), hidden.get(userId)) };
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
  const change = await app.mongo.transaction(async (session) => {
    await models.Chat.updateOne(
      { _id: chat._id },
      { $pull: { pins: { messageId: oid(messageId) } } },
      { session },
    );
    return logPins(app, session, chat._id);
  });
  await announcePins(app, change);
  const fresh = (await models.Chat.findById(chat._id).lean()) as ChatDoc;
  const hidden = await hiddenPinsByUser(app, fresh, [member.userId]);
  return { pins: visiblePins(fresh.pins, member, Date.now(), hidden.get(userId)) };
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

/**
 * Pins on messages that were deleted for everyone, or are gone, before deleting unpinned them
 * (older versions). Removed, and each member's devices told. Runs when the worker starts, through
 * every chat with pins (index: pins.expiresAt), a batch at a time. Returns how many chats changed.
 */
export async function removeStalePins(app: FastifyInstance, batch = 200) {
  const { Chat, Message } = chatModels(app);
  let changed = 0;
  let after: Types.ObjectId | null = null;
  for (;;) {
    const chats: Pick<ChatDoc, '_id' | 'pins'>[] = await Chat.find({
      'pins.expiresAt': { $gt: new Date(0) },
      ...(after ? { _id: { $gt: after } } : {}),
    })
      .select({ _id: 1, pins: 1 })
      .sort({ _id: 1 })
      .limit(batch)
      .lean();
    for (const chat of chats) {
      const ids = (chat.pins ?? []).map((pin) => pin.messageId);
      const alive = await Message.find({ _id: { $in: ids }, deletedForEveryoneAt: null })
        .select({ _id: 1 })
        .lean();
      const keep = new Set(alive.map((doc) => doc._id.toString()));
      const gone = ids.filter((id) => !keep.has(id.toString()));
      if (gone.length === 0) continue;
      const change = await app.mongo.transaction((session) =>
        dropPins(app, session, chat._id, gone),
      );
      await announcePins(app, change);
      if (change) changed += 1;
    }
    const last = chats.at(-1);
    if (!last || chats.length < batch) return changed;
    after = last._id;
  }
}
