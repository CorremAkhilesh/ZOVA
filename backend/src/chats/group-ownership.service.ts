import type { FastifyInstance } from 'fastify';
import type { ChatDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { chatModels, oid } from './chats.service.ts';
import {
  appendSystemMessage,
  deliverSystemMessage,
  namesOf,
  requireGroupMember,
} from './group-core.ts';
import { listMembers } from './group-members.service.ts';
import { assertAllowed, groupRules } from './group-permissions.ts';
import { refreshGroupMarks } from './group-receipts.service.ts';

async function passOwnership(
  app: FastifyInstance,
  chatId: ChatDoc['_id'],
  fromId: string,
  toId: string,
  actorId: string | null,
) {
  const { ChatMember } = chatModels(app);
  const name = await namesOf(app, [fromId, toId]);
  const stored = await app.mongo.transaction((session) =>
    appendSystemMessage(
      app,
      session,
      chatId,
      {
        kind: 'owner_changed',
        actor: actorId ? name(actorId) : null,
        targets: [name(toId)],
        value: null,
      },
      {
        apply: async () => {
          await ChatMember.updateOne(
            { chatId, userId: oid(fromId) },
            { $set: { role: 'admin' } },
            { session },
          );
          await ChatMember.updateOne(
            { chatId, userId: oid(toId) },
            { $set: { role: 'owner' } },
            { session },
          );
        },
      },
    ),
  );
  deliverSystemMessage(app, stored);
}

export async function transferOwnership(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  targetId: string,
) {
  const { chat, role } = await requireGroupMember(app, chatId, userId);
  assertAllowed(groupRules.transferOwnership(role), 'Only the owner can do this.');
  if (targetId === userId) throw new AppError('BAD_REQUEST', 'You are already the owner.');
  const target = await chatModels(app)
    .ChatMember.findOne({ chatId: chat._id, userId: oid(targetId), leftAt: null })
    .lean();
  if (!target) throw new AppError('NOT_FOUND', 'That person is not in this group.');
  await passOwnership(app, chat._id, userId, targetId, userId);
  return listMembers(app, userId, chatId);
}

/**
 * An account was deactivated. Every group they own passes to the oldest admin, or else the oldest
 * member, and they stop holding up the group's ticks.
 */
export async function onUserDeactivated(app: FastifyInstance, userId: string) {
  const { ChatMember } = chatModels(app);
  const user = oid(userId);
  await ChatMember.updateMany({ userId: user, leftAt: null }, { $set: { suspended: true } });
  const rows = await ChatMember.find({ userId: user, leftAt: null })
    .select({ chatId: 1, role: 1 })
    .lean();
  for (const row of rows) {
    if (row.role === 'owner') {
      const others = { chatId: row.chatId, leftAt: null, suspended: { $ne: true } };
      const heir =
        (await ChatMember.findOne({ ...others, role: 'admin' })
          .sort({ joinedAt: 1 })
          .lean()) ?? (await ChatMember.findOne(others).sort({ joinedAt: 1 }).lean());
      if (heir) await passOwnership(app, row.chatId, userId, heir.userId.toString(), null);
    }
    await refreshGroupMarks(app, row.chatId.toString());
  }
}

export async function onUserReactivated(app: FastifyInstance, userId: string) {
  await chatModels(app).ChatMember.updateMany(
    { userId: oid(userId), leftAt: null },
    { $unset: { suspended: 1 } },
  );
}
