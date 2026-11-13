import { randomBytes } from 'node:crypto';
import type { InvitePreview } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { chatModels, getChat, oid } from './chats.service.ts';
import {
  appendSystemMessage,
  deliverSystemMessage,
  namesOf,
  requireGroupMember,
} from './group-core.ts';
import { admitMembers, assertRoomFor } from './group-members.service.ts';
import { assertAllowed, groupRules } from './group-permissions.ts';

const newCode = () => randomBytes(16).toString('base64url');

async function requireInviteManager(app: FastifyInstance, userId: string, chatId: string) {
  const { chat, role } = await requireGroupMember(app, chatId, userId);
  assertAllowed(groupRules.manageInvite(role), 'Only admins can manage the invite link.');
  return chat;
}

export async function readInvite(app: FastifyInstance, userId: string, chatId: string) {
  const chat = await requireInviteManager(app, userId, chatId);
  return { code: chat.group?.inviteCode ?? null };
}

/** Creates the link, or resets it: the old one stops working at once. */
export async function resetInvite(app: FastifyInstance, userId: string, chatId: string) {
  const chat = await requireInviteManager(app, userId, chatId);
  const code = newCode();
  await chatModels(app).Chat.updateOne({ _id: chat._id }, { $set: { 'group.inviteCode': code } });
  return { code };
}

export async function revokeInvite(app: FastifyInstance, userId: string, chatId: string) {
  const chat = await requireInviteManager(app, userId, chatId);
  await chatModels(app).Chat.updateOne({ _id: chat._id }, { $unset: { 'group.inviteCode': 1 } });
  return { code: null };
}

async function findByCode(app: FastifyInstance, code: string) {
  const chat = await chatModels(app)
    .Chat.findOne({ type: 'group', 'group.inviteCode': { $eq: code, $type: 'string' } })
    .lean();
  // Revoked, reset and made-up links all look the same.
  if (!chat) throw new AppError('INVITE_INVALID', 'This invite link is no longer valid.');
  return chat;
}

export async function previewInvite(
  app: FastifyInstance,
  userId: string,
  code: string,
): Promise<InvitePreview> {
  const chat = await findByCode(app, code);
  const member = await chatModels(app).ChatMember.exists({
    chatId: chat._id,
    userId: oid(userId),
    leftAt: null,
  });
  return {
    chatId: chat._id.toString(),
    name: chat.group?.name ?? '',
    photo: chat.group?.photo ? `/v1/invites/${code}/photo` : null,
    memberCount: chat.group?.memberCount ?? 0,
    alreadyMember: member !== null,
  };
}

export async function invitePhotoKey(app: FastifyInstance, code: string) {
  const chat = await findByCode(app, code);
  const key = chat.group?.photo?.small;
  if (!key) throw new AppError('NOT_FOUND', 'No photo.');
  return key;
}

const JOINS_PER_HOUR = 30;

/** Signed in and active is already certain by now: sessions end when an account is deactivated. */
export async function joinByInvite(app: FastifyInstance, userId: string, code: string) {
  const key = `zuvo:rate:join:${userId}`;
  if ((await app.counterStore.increment(key, 3600)) > JOINS_PER_HOUR) {
    throw new AppError('RATE_LIMITED', 'Too many attempts. Try again later.');
  }
  const chat = await findByCode(app, code);
  const chatId = chat._id.toString();
  const already = await chatModels(app).ChatMember.exists({
    chatId: chat._id,
    userId: oid(userId),
    leftAt: null,
  });
  if (already) return getChat(app, chatId, userId);
  assertRoomFor(chat, 1);
  const name = await namesOf(app, [userId]);
  const at = new Date();
  const stored = await app.mongo.transaction((session) =>
    appendSystemMessage(
      app,
      session,
      chat._id,
      { kind: 'joined', actor: name(userId), targets: [], value: null },
      { apply: (seq) => admitMembers(app, session, chat._id, [userId], seq, at) },
    ),
  );
  deliverSystemMessage(app, stored);
  return getChat(app, chatId, userId);
}
