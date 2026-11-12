import { type ChatPrefs, PINNED_CHATS_MAX, type StarredItem } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import type { ChatMemberDoc, StarDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { chatModels, getChat, oid } from './chats.service.ts';
import { hideQuote, toMessage } from './message-format.ts';
import { logUpdates } from './updates.ts';
import { canSeeSeq, requireParticipant } from './visibility.ts';

const MUTE_MS = { '8h': 8 * 3_600_000, '1w': 7 * 86_400_000 } as const;
/** "Always" is simply very long, so one field and one check cover all of it. */
const FOREVER = new Date('9999-12-31T00:00:00.000Z');

function muteUntil(mute: NonNullable<ChatPrefs['mute']>): Date | null {
  if (mute === 'off') return null;
  return mute === 'always' ? FOREVER : new Date(Date.now() + MUTE_MS[mute]);
}

async function assertRoomToPin(app: FastifyInstance, userId: string, member: ChatMemberDoc) {
  if (member.pinnedAt) return;
  const pinned = await chatModels(app).ChatMember.countDocuments({
    userId: oid(userId),
    pinnedAt: { $type: 'date' },
  });
  if (pinned >= PINNED_CHATS_MAX) {
    throw new AppError('PIN_LIMIT_REACHED', `You can pin up to ${PINNED_CHATS_MAX} chats.`);
  }
}

function changesFor(prefs: ChatPrefs, now: Date) {
  const set: Record<string, unknown> = {};
  if (prefs.pinned !== undefined) set.pinnedAt = prefs.pinned ? now : null;
  if (prefs.mute !== undefined) set.mutedUntil = muteUntil(prefs.mute);
  if (prefs.archived !== undefined) set.archivedAt = prefs.archived ? now : null;
  if (prefs.unread !== undefined) set.markedUnread = prefs.unread;
  return set;
}

/** Tells my own devices how this chat now looks to me. */
export async function announceOwnChat(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  cursor: string,
) {
  const summary = await getChat(app, chatId, userId);
  app.realtime.emitToUser(userId, 'chat:updated', {
    chatId,
    type: summary.type,
    seq: summary.seq,
    lastMessage: summary.lastMessage,
    lastReadSeq: summary.lastReadSeq,
    unreadCount: summary.unreadCount,
    lastActivityAt: summary.lastActivityAt,
    pinned: summary.pinned ?? false,
    mutedUntil: summary.mutedUntil ?? null,
    archived: summary.archived ?? false,
    markedUnread: summary.markedUnread ?? false,
    pins: summary.pins ?? [],
    mentionSeqs: summary.mentionSeqs ?? [],
    disappearing: summary.disappearing ?? 'off',
    locked: summary.locked ?? false,
    wallpaper: summary.wallpaper ?? null,
    cursor,
  });
  return summary;
}

/** Mine alone: pin, mute, archive, unread. Other devices hear about it; nobody else does. */
export async function setChatPrefs(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  prefs: ChatPrefs,
) {
  const member = await requireParticipant(app, chatId, userId);
  if (prefs.pinned) await assertRoomToPin(app, userId, member);
  const now = new Date();
  const set = changesFor(prefs, now);
  const models = chatModels(app);
  const cursors = await app.mongo.transaction(async (session) => {
    await models.ChatMember.updateOne({ _id: member._id }, { $set: set }, { session });
    return logUpdates(
      models,
      session,
      [member.userId],
      { kind: 'chat', chatId: member.chatId },
      now,
    );
  });
  return announceOwnChat(app, userId, chatId, cursors.get(userId) ?? '0');
}

/**
 * Hides everything so far, for me. One position instead of a row per message. Deleting a chat does the
 * same and takes it out of my list until someone writes again. Direct chats and Saved Messages only.
 */
export async function clearChat(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  options: { removeChat: boolean },
) {
  const member = await requireParticipant(app, chatId, userId);
  const models = chatModels(app);
  const chat = await models.Chat.findById(chatId).select({ seq: 1, type: 1 }).lean();
  if (!chat) throw new AppError('NOT_FOUND', 'Chat not found.');
  if (options.removeChat && chat.type === 'group') {
    throw new AppError('BAD_REQUEST', 'Exit the group instead.');
  }
  const seq = member.leftSeq ?? chat.seq;
  const cursors = await app.mongo.transaction(async (session) => {
    await models.ChatMember.updateOne(
      { _id: member._id },
      {
        $set: {
          clearedSeq: seq,
          ...(options.removeChat ? { lastActivityAt: null } : {}),
        },
        $max: { lastReadSeq: seq, lastDeliveredSeq: seq, ackReadSeq: seq },
        $unset: { lastReaction: 1, mentionSeqs: 1 },
      },
      { session },
    );
    await models.Star.deleteMany({ userId: member.userId, chatId: chat._id }, { session });
    return logUpdates(
      models,
      session,
      [member.userId],
      { kind: options.removeChat ? 'chat_removed' : 'cleared', chatId: chat._id, seq },
      new Date(),
    );
  });
  app.realtime.emitToUser(userId, 'chat:cleared', {
    chatId,
    seq,
    removeChat: options.removeChat,
    cursor: cursors.get(userId) ?? '0',
  });
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const [time, id] = cursor.split('_');
  if (!time || !id || !/^\d+$/.test(time) || !Types.ObjectId.isValid(id)) {
    throw new AppError('BAD_REQUEST', 'Invalid cursor.');
  }
  return { at: new Date(Number(time)), id: oid(id) };
}

/** My starred messages, newest first, across all chats or in one. */
export async function listStars(
  app: FastifyInstance,
  userId: string,
  query: { chatId?: string | undefined; cursor?: string | undefined; limit: number },
) {
  const { Star, Message, ChatMember } = chatModels(app);
  const after = decodeCursor(query.cursor);
  const stars = (await Star.find({
    userId: oid(userId),
    ...(query.chatId ? { chatId: oid(query.chatId) } : {}),
    ...(after
      ? { $or: [{ at: { $lt: after.at } }, { at: after.at, _id: { $lt: after.id } }] }
      : {}),
  })
    .sort({ at: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean()) as StarDoc[];
  const page = stars.slice(0, query.limit);
  const docs = await Message.find({ _id: { $in: page.map((star) => star.messageId) } }).lean();
  const byId = new Map(docs.map((doc) => [doc._id.toString(), doc]));
  const members = await ChatMember.find({
    userId: oid(userId),
    chatId: { $in: page.map((star) => star.chatId) },
  }).lean();
  const memberOf = new Map(members.map((member) => [member.chatId.toString(), member]));
  const items: StarredItem[] = page.flatMap((star) => {
    const doc = byId.get(star.messageId.toString());
    const member = memberOf.get(star.chatId.toString());
    if (!doc || !member || !canSeeSeq(member, doc.seq)) return [];
    return [
      {
        message: { ...hideQuote(toMessage(doc, userId), member), starred: true },
        starredAt: star.at.toISOString(),
      },
    ];
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      stars.length > query.limit && last ? `${last.at.getTime()}_${last._id.toString()}` : null,
  };
}
