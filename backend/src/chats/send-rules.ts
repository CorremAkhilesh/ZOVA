import {
  DEFAULT_GROUP_SETTINGS,
  type MediaInfo,
  type PollInput,
  type ReplyQuote,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { ClientSession, Types } from 'mongoose';
import type { ChatDoc, ChatMemberDoc, MessageDoc, StoredPoll } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { attachMedia, toMediaInfo } from '../media/media.service.ts';
import { assertNotBlocked } from '../moderation/blocks.service.ts';
import { usersModel } from '../users/user-record.ts';
import { chatModels, oid } from './chats.service.ts';
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

export async function attachIfAny(
  app: FastifyInstance,
  session: ClientSession,
  input: { mediaId: string | undefined; userId: string; chatId: string; messageId: Types.ObjectId },
): Promise<MediaInfo | null> {
  const { mediaId } = input;
  return mediaId ? toMediaInfo(await attachMedia(app, session, { ...input, mediaId })) : null;
}

export const typeOf = (media: MediaInfo | null) => media?.kind ?? 'text';

/** A reply's quote, and a forwarded copy's label and count. Absent on most messages. */
export function extrasOf(replyTo: ReplyQuote | null, forward: SendInput['forward']) {
  return {
    ...(replyTo ? { replyTo } : {}),
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
