import type { FastifyInstance } from 'fastify';
import { chatModels, oid, requireMember } from '../chats/chats.service.ts';
import { AppError } from '../lib/errors.ts';
import { blockBetween } from '../moderation/blocks.service.ts';
import { hiddenAmong } from '../users/hidden-admins.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';
import { callsAllowed, callsAllowedFor, callsSetting } from './access.ts';

/**
 * Who may call whom: both people have calls (the feature flag), a 1:1 chat they are both in, no block
 * either way, an active account, and never a hidden admin unless the caller is an admin (a normal user
 * cannot start anything with one, and calling would show whether they are around).
 * Returns the person called.
 */
export async function assertMayCall(
  app: FastifyInstance,
  callerId: string,
  chatId: string,
): Promise<string> {
  if (!(await callsAllowedFor(app, callerId))) {
    throw new AppError('CALLS_UNAVAILABLE', 'Calls are not available for your account yet.');
  }
  await requireMember(app, chatId, callerId);
  const { Chat, ChatMember } = chatModels(app);
  const chat = await Chat.findById(chatId).select({ type: 1 }).lean();
  if (chat?.type !== 'direct') throw new AppError('BAD_REQUEST', 'Only 1:1 chats can have calls.');
  const other = await ChatMember.findOne({
    chatId: oid(chatId),
    userId: { $ne: oid(callerId) },
    leftAt: null,
  })
    .select({ userId: 1 })
    .lean();
  if (!other) throw new AppError('NOT_FOUND', 'Chat not found.');
  const peerId = other.userId.toString();
  const peer = (await usersModel(app)
    .findById(other.userId)
    .select({ status: 1, email: 1, role: 1 })
    .lean()) as Pick<UserDoc, '_id' | 'status' | 'email' | 'role'> | null;
  if (!peer || peer.status === 'deactivated') {
    throw new AppError('FORBIDDEN', 'This account has been deactivated.');
  }
  if ((await hiddenAmong(app, callerId, [peer])).size > 0) {
    throw new AppError('CANNOT_MESSAGE', 'You can’t call this person.');
  }
  const { byMe, byThem } = await blockBetween(app, callerId, peerId);
  if (byMe) throw new AppError('BLOCKED', 'You blocked this contact. Unblock them to call.');
  if (byThem) throw new AppError('CANNOT_MESSAGE', 'You can’t call this person.');
  if (!callsAllowed(callsSetting(app), peer)) {
    throw new AppError('CALLS_UNAVAILABLE', 'Calls are not available for this person yet.');
  }
  return peerId;
}
