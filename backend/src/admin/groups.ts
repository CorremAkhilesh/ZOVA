import type { AdminGroup } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { chatModels } from '../chats/chats.service.ts';
import { appendSystemMessage, deliverSystemMessage } from '../chats/group-core.ts';
import { logUpdates } from '../chats/updates.ts';
import type { ChatDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { escapeRegex, type UserDoc, usersModel } from '../users/user-record.ts';
import { type Actor, audit } from './admin.service.ts';

const self = (actor: Actor) => ({ _id: new Types.ObjectId(actor.id), email: actor.email });

/** Rows for groups: admins and owner (index: chatId + userId), storage (index: chatId + status). */
async function toRows(app: FastifyInstance, chats: ChatDoc[]): Promise<AdminGroup[]> {
  const ids = chats.map((chat) => chat._id);
  const { ChatMember, Media } = chatModels(app);
  const [leads, stored] = await Promise.all([
    ChatMember.find({ chatId: { $in: ids }, role: { $in: ['admin', 'owner'] }, leftAt: null })
      .select({ chatId: 1, userId: 1, role: 1 })
      .lean(),
    Media.aggregate<{ _id: Types.ObjectId; bytes: number }>([
      { $match: { chatId: { $in: ids }, status: 'ready' } },
      { $group: { _id: '$chatId', bytes: { $sum: '$size' } } },
    ]),
  ]);
  const ownerIds = leads.filter((row) => row.role === 'owner').map((row) => row.userId);
  const owners = (await usersModel(app)
    .find({ _id: { $in: ownerIds } })
    .select({ email: 1, displayName: 1 })
    .lean()) as UserDoc[];
  const ownerById = new Map(owners.map((user) => [user._id.toString(), user]));
  const bytes = new Map(stored.map((row) => [row._id.toString(), row.bytes]));
  return chats.map((chat) => {
    const key = chat._id.toString();
    const mine = leads.filter((row) => row.chatId.toString() === key);
    const ownerRow = mine.find((row) => row.role === 'owner');
    const owner = ownerRow ? ownerById.get(ownerRow.userId.toString()) : undefined;
    return {
      id: key,
      name: chat.group?.name ?? '',
      memberCount: chat.group?.memberCount ?? 0,
      adminCount: mine.length,
      owner: owner
        ? { id: owner._id.toString(), email: owner.email, name: owner.displayName ?? owner.email }
        : null,
      createdAt: chat.createdAt.toISOString(),
      lastActivityAt: chat.lastActivityAt?.toISOString() ?? null,
      storageBytes: bytes.get(key) ?? 0,
      archived: Boolean(chat.group?.adminArchived),
    };
  });
}

/** Admin → Groups, newest first, cursor on _id. Index: type + _id. Deleted groups are left out. */
export async function listGroups(
  app: FastifyInstance,
  query: { q: string; filter: 'all' | 'archived'; limit: number; cursor?: string | undefined },
) {
  const filter: Record<string, unknown> = { type: 'group', 'group.adminDeleted': null };
  if (query.q) filter['group.name'] = new RegExp(escapeRegex(query.q), 'i');
  if (query.filter === 'archived') filter['group.adminArchived'] = { $ne: null };
  if (query.cursor && Types.ObjectId.isValid(query.cursor)) {
    filter._id = { $lt: new Types.ObjectId(query.cursor) };
  }
  const docs = await chatModels(app)
    .Chat.find(filter)
    .sort({ _id: -1 })
    .limit(query.limit + 1)
    .lean();
  const items = await toRows(app, docs.slice(0, query.limit));
  return { items, nextCursor: docs.length > query.limit ? (items.at(-1)?.id ?? null) : null };
}

async function findGroup(app: FastifyInstance, id: string): Promise<ChatDoc> {
  const chat = Types.ObjectId.isValid(id) ? await chatModels(app).Chat.findById(id).lean() : null;
  if (chat?.type !== 'group' || chat.group?.adminDeleted) {
    throw new AppError('NOT_FOUND', 'Group not found.');
  }
  return chat;
}

/** Tells every member at once, with a system line (no admin named). */
async function announce(
  app: FastifyInstance,
  chat: ChatDoc,
  kind: 'admin_archived' | 'admin_restored',
) {
  const stored = await app.mongo.transaction((session) =>
    appendSystemMessage(app, session, chat._id, { kind, actor: null, targets: [], value: null }),
  );
  deliverSystemMessage(app, stored);
}

/**
 * Archives a group: it stays readable and members can leave, but nobody can write, react, join,
 * add people or change it. Audited `group.archive`.
 */
export async function archiveGroup(app: FastifyInstance, actor: Actor, id: string, reason: string) {
  const chat = await findGroup(app, id);
  if (!chat.group?.adminArchived) {
    await chatModels(app).Chat.updateOne(
      { _id: chat._id },
      { $set: { 'group.adminArchived': { at: new Date(), by: actor.email, reason } } },
    );
    await announce(app, chat, 'admin_archived');
    await audit(app, actor, 'group.archive', self(actor), {
      reason,
      details: { group: chat.group?.name ?? '', members: chat.group?.memberCount ?? 0 },
    });
  }
  const [row] = await toRows(app, [await findGroup(app, id)]);
  return row as AdminGroup;
}

/** Undoes an archive. Audited `group.restore`. */
export async function restoreGroup(app: FastifyInstance, actor: Actor, id: string, reason: string) {
  const chat = await findGroup(app, id);
  if (chat.group?.adminArchived) {
    await chatModels(app).Chat.updateOne(
      { _id: chat._id },
      { $set: { 'group.adminArchived': null } },
    );
    await announce(app, chat, 'admin_restored');
    await audit(app, actor, 'group.restore', self(actor), {
      reason,
      details: { group: chat.group?.name ?? '' },
    });
  }
  const [row] = await toRows(app, [await findGroup(app, id)]);
  return row as AdminGroup;
}

/**
 * Deletes a group for everyone, for good: it leaves every member's list on every device, its
 * messages go, and its files are removed by the cleanup job (unless forwarded elsewhere). The group
 * record stays, emptied, for the audit trail. The name must be typed again. Audited `group.delete`.
 */
export async function deleteGroup(
  app: FastifyInstance,
  actor: Actor,
  id: string,
  confirmName: string,
  reason: string,
) {
  const chat = await findGroup(app, id);
  const name = chat.group?.name ?? '';
  if (confirmName.trim().toLocaleLowerCase() !== name.trim().toLocaleLowerCase()) {
    throw new AppError('BAD_REQUEST', 'Type the group’s name exactly to delete it.', {
      field: 'confirmName',
    });
  }
  const models = chatModels(app);
  const now = new Date();
  const members = await models.ChatMember.find({ chatId: chat._id, leftAt: null })
    .select({ userId: 1 })
    .lean();
  const userIds = members.map((member) => member.userId);
  const cursors = await app.mongo.transaction(async (session) => {
    await models.ChatMember.updateMany(
      { chatId: chat._id, leftAt: null },
      {
        $set: {
          leftAt: now,
          removedAt: now,
          leftSeq: chat.seq,
          clearedSeq: chat.seq,
          lastActivityAt: null,
        },
        $unset: { lastReaction: 1, mentionSeqs: 1 },
      },
      { session },
    );
    await models.Chat.updateOne(
      { _id: chat._id },
      {
        $set: {
          'group.adminDeleted': { at: now, by: actor.email, reason },
          'group.memberCount': 0,
          'group.inviteCode': null,
          lastMessage: null,
        },
      },
      { session },
    );
    await models.Media.updateMany(
      { chatId: chat._id },
      { $set: { deleteRequestedAt: now } },
      { session },
    );
    await models.Message.deleteMany({ chatId: chat._id }, { session });
    await models.Star.deleteMany({ chatId: chat._id }, { session });
    return logUpdates(
      models,
      session,
      userIds,
      { kind: 'chat_removed', chatId: chat._id, seq: chat.seq },
      now,
    );
  });
  for (const userId of userIds) {
    const key = userId.toString();
    app.realtime.emitToUser(key, 'chat:cleared', {
      chatId: id,
      seq: chat.seq,
      removeChat: true,
      cursor: cursors.get(key) ?? '0',
    });
  }
  await audit(app, actor, 'group.delete', self(actor), {
    reason,
    details: { group: name, members: userIds.length },
  });
  return { deleted: true as const, members: userIds.length };
}
