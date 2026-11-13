import { GROUP_MEMBERS_MAX, type GroupMember, type GroupRole } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { ClientSession } from 'mongoose';
import type { ChatDoc, LastMessageSnapshot } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { blockersAmong } from '../moderation/blocks.service.ts';
import { toPublicProfile, type UserDoc, usersModel } from '../users/user-record.ts';
import { chatModels, getChat, oid } from './chats.service.ts';
import {
  appendSystemMessage,
  deliverSystemMessage,
  namesOf,
  photoUrls,
  requireGroupMember,
} from './group-core.ts';
import { assertAllowed, groupRules } from './group-permissions.ts';
import { refreshGroupMarks } from './group-receipts.service.ts';
import { requireActiveUsers } from './groups.service.ts';

export async function listMembers(
  app: FastifyInstance,
  userId: string,
  chatId: string,
): Promise<GroupMember[]> {
  await requireGroupMember(app, chatId, userId);
  const rows = await chatModels(app)
    .ChatMember.find({ chatId: oid(chatId), leftAt: null })
    .sort({ joinedAt: 1 })
    .lean();
  const users = (await usersModel(app)
    .find({ _id: { $in: rows.map((row) => row.userId) } })
    .lean()) as UserDoc[];
  const byId = new Map(users.map((user) => [user._id.toString(), user]));
  // A group still works with someone who blocked me, but their photo and about stay hidden.
  const blockers = await blockersAmong(app, userId, [...byId.keys()]);
  return rows.flatMap((row) => {
    const user = byId.get(row.userId.toString());
    if (!user) return [];
    return [
      {
        user: toPublicProfile(user, userId, { blockedViewer: blockers.has(user._id.toString()) }),
        role: row.role,
        joinedAt: row.joinedAt.toISOString(),
      },
    ];
  });
}

/** Someone joins from here on: earlier messages stay out of their reach, even if they were here before. */
export async function admitMembers(
  app: FastifyInstance,
  session: ClientSession,
  chatId: ChatDoc['_id'],
  userIds: string[],
  seq: number,
  at: Date,
) {
  const { ChatMember, Chat } = chatModels(app);
  await ChatMember.bulkWrite(
    userIds.map((id) => ({
      updateOne: {
        filter: { chatId, userId: oid(id) },
        update: {
          $set: {
            role: 'member',
            joinedAt: at,
            joinSeq: seq - 1,
            lastReadSeq: seq - 1,
            lastDeliveredSeq: seq - 1,
            sharedReadSeq: seq - 1,
            ackReadSeq: seq - 1,
            lastActivityAt: at,
            leftAt: null,
            leftSeq: null,
          },
          $unset: { leftView: 1 },
        },
        upsert: true,
      },
    })),
    { session },
  );
  await Chat.updateOne(
    { _id: chatId },
    { $inc: { 'group.memberCount': userIds.length } },
    { session },
  );
}

export function assertRoomFor(chat: ChatDoc, joining: number): void {
  if ((chat.group?.memberCount ?? 0) + joining > GROUP_MEMBERS_MAX) {
    throw new AppError('GROUP_FULL', `A group can have at most ${GROUP_MEMBERS_MAX} members.`);
  }
}

export async function addMembers(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  userIds: string[],
) {
  const { chat, role, settings } = await requireGroupMember(app, chatId, userId);
  assertAllowed(groupRules.addMembers(role, settings), 'Only admins can add members.');
  const { ChatMember } = chatModels(app);
  const wanted = [...new Set(userIds)];
  await requireActiveUsers(app, wanted);
  const present = await ChatMember.find({
    chatId: chat._id,
    userId: { $in: wanted.map(oid) },
    leftAt: null,
  })
    .select({ userId: 1 })
    .lean();
  const already = new Set(present.map((row) => row.userId.toString()));
  const fresh = wanted.filter((id) => !already.has(id));
  if (fresh.length > 0) {
    assertRoomFor(chat, fresh.length);
    const name = await namesOf(app, [userId, ...fresh]);
    const at = new Date();
    const stored = await app.mongo.transaction((session) =>
      appendSystemMessage(
        app,
        session,
        chat._id,
        { kind: 'added', actor: name(userId), targets: fresh.map(name), value: null },
        { apply: (seq) => admitMembers(app, session, chat._id, fresh, seq, at) },
      ),
    );
    deliverSystemMessage(app, stored);
  }
  return listMembers(app, userId, chatId);
}

/** Takes someone out as of this message: they keep what came before it, and get nothing after. */
async function dismiss(
  app: FastifyInstance,
  session: ClientSession,
  chat: ChatDoc,
  userId: string,
  seq: number,
  lastMessage: LastMessageSnapshot,
) {
  const { ChatMember, Chat } = chatModels(app);
  const memberCount = (chat.group?.memberCount ?? 1) - 1;
  const photo = photoUrls(chat);
  await ChatMember.updateOne(
    { chatId: chat._id, userId: oid(userId) },
    {
      $set: {
        leftAt: lastMessage.createdAt,
        leftSeq: seq,
        role: 'member',
        leftView: {
          lastMessage,
          group: {
            name: chat.group?.name ?? '',
            description: chat.group?.description ?? '',
            photo,
            memberCount,
          },
        },
      },
    },
    { session },
  );
  await Chat.updateOne({ _id: chat._id }, { $inc: { 'group.memberCount': -1 } }, { session });
}

export async function removeMember(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  targetId: string,
) {
  const { chat, role } = await requireGroupMember(app, chatId, userId);
  if (targetId === userId) throw new AppError('BAD_REQUEST', 'Use leave to exit a group.');
  const target = await chatModels(app)
    .ChatMember.findOne({ chatId: chat._id, userId: oid(targetId), leftAt: null })
    .lean();
  if (!target) throw new AppError('NOT_FOUND', 'That person is not in this group.');
  assertAllowed(groupRules.removeMember(role, target.role), 'You cannot remove this person.');
  const name = await namesOf(app, [userId, targetId]);
  const stored = await app.mongo.transaction((session) =>
    appendSystemMessage(
      app,
      session,
      chat._id,
      { kind: 'removed', actor: name(userId), targets: [name(targetId)], value: null },
      {
        alsoTell: [targetId],
        apply: (seq, last) => dismiss(app, session, chat, targetId, seq, last),
      },
    ),
  );
  deliverSystemMessage(app, stored);
  await refreshGroupMarks(app, chatId);
  return listMembers(app, userId, chatId);
}

export async function leaveGroup(app: FastifyInstance, userId: string, chatId: string) {
  const { chat, role } = await requireGroupMember(app, chatId, userId);
  if (role === 'owner' && (chat.group?.memberCount ?? 0) > 1) {
    throw new AppError('OWNER_MUST_TRANSFER', 'Make someone else the owner before you leave.');
  }
  const name = await namesOf(app, [userId]);
  const stored = await app.mongo.transaction((session) =>
    appendSystemMessage(
      app,
      session,
      chat._id,
      { kind: 'left', actor: name(userId), targets: [], value: null },
      {
        alsoTell: [userId],
        apply: (seq, last) => dismiss(app, session, chat, userId, seq, last),
      },
    ),
  );
  deliverSystemMessage(app, stored);
  await refreshGroupMarks(app, chatId);
  return getChat(app, chatId, userId);
}

export async function setMemberRole(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  targetId: string,
  newRole: Exclude<GroupRole, 'owner'>,
) {
  const { chat, role } = await requireGroupMember(app, chatId, userId);
  assertAllowed(groupRules.changeRole(role), 'Only the owner can change admins.');
  const { ChatMember } = chatModels(app);
  const target = await ChatMember.findOne({
    chatId: chat._id,
    userId: oid(targetId),
    leftAt: null,
  }).lean();
  if (!target) throw new AppError('NOT_FOUND', 'That person is not in this group.');
  if (target.role === 'owner') throw new AppError('CONFLICT', 'Transfer ownership instead.');
  if (target.role !== newRole) {
    const name = await namesOf(app, [userId, targetId]);
    const stored = await app.mongo.transaction((session) =>
      appendSystemMessage(
        app,
        session,
        chat._id,
        {
          kind: newRole === 'admin' ? 'promoted' : 'demoted',
          actor: name(userId),
          targets: [name(targetId)],
          value: null,
        },
        {
          apply: async () => {
            await ChatMember.updateOne(
              { _id: target._id },
              { $set: { role: newRole } },
              { session },
            );
          },
        },
      ),
    );
    deliverSystemMessage(app, stored);
  }
  return listMembers(app, userId, chatId);
}
