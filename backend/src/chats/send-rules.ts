import {
  DEFAULT_GROUP_SETTINGS,
  type MediaInfo,
  type PollInput,
  type ReplyQuote,
  type StatusReply,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { ClientSession, Types } from 'mongoose';
import type { ChatDoc, ChatMemberDoc, MessageDoc, StoredPoll } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { attachMedia, toMediaInfo } from '../media/media.service.ts';
import { shareOwnMedia } from '../media/media-share.ts';
import { assertNotBlocked } from '../moderation/blocks.service.ts';
import { hiddenAmong } from '../users/hidden-admins.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';
import { chatModels, oid } from './chats.service.ts';
import { assertNotArchived } from './group-core.ts';
import { assertAllowed, groupRules } from './group-permissions.ts';
import { toMessage } from './message-format.ts';
import type { SendInput, SendResult } from './messages.service.ts';

export async function findOriginal(
  app: FastifyInstance,
  input: SendInput,
): Promise<SendResult | null> {
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
export async function assertMaySend(
  app: FastifyInstance,
  chatId: string,
  userId: string,
  member: ChatMemberDoc,
) {
  const { Chat, ChatMember } = chatModels(app);
  const chat = await Chat.findById(chatId, { type: 1, group: 1 }).lean();
  if (chat?.type === 'group') {
    assertNotArchived(chat);
    const settings = { ...DEFAULT_GROUP_SETTINGS, ...chat.group?.settings };
    assertAllowed(groupRules.sendMessages(member.role, settings), 'Only admins can send messages.');
    return null;
  }
  if (chat?.type !== 'direct') return null;
  const other = await ChatMember.findOne({ chatId: oid(chatId), userId: { $ne: oid(userId) } })
    .select({ userId: 1 })
    .lean();
  const peer = other
    ? ((await usersModel(app)
        .findById(other.userId)
        .select({ status: 1, email: 1 })
        .lean()) as Pick<UserDoc, '_id' | 'status' | 'email'> | null)
    : null;
  if (peer?.status === 'deactivated') {
    throw new AppError('FORBIDDEN', 'This account has been deactivated.');
  }
  const canReply = app.settings.current().adminChatUserCanReply;
  if (peer && !canReply && (await hiddenAmong(app, userId, [peer])).size) {
    throw new AppError('FORBIDDEN', 'Only the admin can send messages in this chat.');
  }
  if (other) await assertNotBlocked(app, userId, other.userId.toString());
  return other?.userId.toString() ?? null;
}

/**
 * In a 1:1 chat, anything the other person would see (a timer change, a pin, a reaction, an edit,
 * a vote) is refused while either has blocked the other, as a message would be. Groups: no check.
 */
export async function assertDirectNotBlocked(
  app: FastifyInstance,
  userId: string,
  chat: { _id: Types.ObjectId; type: string },
): Promise<void> {
  if (chat.type !== 'direct') return;
  const other = await chatModels(app)
    .ChatMember.findOne({ chatId: chat._id, userId: { $ne: oid(userId) } })
    .select({ userId: 1 })
    .lean();
  if (other) await assertNotBlocked(app, userId, other.userId.toString());
}

/** The same, for a chat known by id only. */
export async function assertChatNotBlocked(app: FastifyInstance, userId: string, chatId: string) {
  const chat = await chatModels(app)
    .Chat.findById(chatId)
    .select({ type: 1, 'group.adminArchived': 1 })
    .lean();
  // Reactions, votes, pins, edits and timers: none in a group an admin archived.
  assertNotArchived(chat);
  if (chat) await assertDirectNotBlocked(app, userId, chat);
}

export async function attachIfAny(
  app: FastifyInstance,
  session: ClientSession,
  input: { mediaId: string | undefined; userId: string; chatId: string; messageId: Types.ObjectId },
): Promise<MediaInfo | null> {
  const { mediaId } = input;
  return mediaId ? toMediaInfo(await attachMedia(app, session, { ...input, mediaId })) : null;
}

/** The same file again, by reference (see shareOwnMedia). */
export async function shareMedia(
  app: FastifyInstance,
  session: ClientSession,
  input: { mediaId: string; userId: string; chatId: string; messageId: Types.ObjectId },
): Promise<MediaInfo> {
  return toMediaInfo(await shareOwnMedia(app, session, input));
}

export const typeOf = (media: MediaInfo | null) => media?.kind ?? 'text';

/** A reply's quote, and a forwarded copy's label and count. Absent on most messages. */
export function extrasOf(
  replyTo: ReplyQuote | null,
  forward: SendInput['forward'],
  statusReply: StatusReply | null = null,
) {
  return {
    ...(replyTo ? { replyTo } : {}),
    ...(statusReply ? { statusReply } : {}),
    ...(forward ? { forwarded: true, forwardCount: forward.count } : {}),
  };
}

/** A new poll: every option starts with no votes. */
export function pollDoc(poll: PollInput): StoredPoll {
  return {
    question: poll.question,
    options: poll.options.map((text, index) => ({ id: String(index), text, voterIds: [] })),
    multiple: poll.multiple,
    closedAt: null,
  };
}

/** Polls and view once need someone to answer or look: not in Saved Messages. */
export function assertKindAllowed(
  chat: Pick<ChatDoc, 'type'>,
  input: Pick<SendInput, 'poll' | 'viewOnce'>,
  media: MediaInfo | null,
) {
  if ((input.poll || input.viewOnce) && chat.type === 'self') {
    throw new AppError('BAD_REQUEST', 'Polls and view once are for chats with other people.');
  }
  if (input.viewOnce && media?.kind !== 'image' && media?.kind !== 'video') {
    throw new AppError('BAD_REQUEST', 'Only a photo or video can be view once.');
  }
}

/** Poll, view once and expiry: the parts of a message its chat and kind decide. */
export function kindFields(
  input: Pick<SendInput, 'poll' | 'viewOnce'>,
  expiresAt: Date | null,
): Partial<MessageDoc> {
  return {
    ...(input.poll ? { poll: pollDoc(input.poll) } : {}),
    ...(input.viewOnce ? { viewOnce: true, viewOnceDoneAt: null } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}
