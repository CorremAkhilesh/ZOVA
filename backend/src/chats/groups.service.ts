import { Readable } from 'node:stream';
import {
  type ChatSummary,
  DEFAULT_GROUP_SETTINGS,
  GROUP_MEMBERS_MAX,
  type GroupSettings,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { AppError } from '../lib/errors.ts';
import { processAvatar } from '../users/avatar.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';
import { chatModels, getChat, oid } from './chats.service.ts';
import { defaultTimerOf } from './default-timer.ts';
import { appendTimerNotice } from './disappearing.service.ts';
import {
  appendSystemMessage,
  deliverSystemMessage,
  namesOf,
  requireGroupMember,
} from './group-core.ts';
import { assertAllowed, groupRules } from './group-permissions.ts';

const GROUPS_PER_HOUR = 10;

/** Only people who could sign in right now can be put in a group. */
export async function requireActiveUsers(app: FastifyInstance, userIds: string[]) {
  const users = (await usersModel(app)
    .find({ _id: { $in: userIds.map(oid) } })
    .select({ status: 1 })
    .lean()) as UserDoc[];
  const active = users.filter((user) => user.status !== 'deactivated');
  if (active.length !== userIds.length) {
    throw new AppError('BAD_REQUEST', 'Someone in this list cannot be added.');
  }
}

export async function createGroup(
  app: FastifyInstance,
  userId: string,
  input: { name: string; description: string; memberIds: string[] },
): Promise<ChatSummary> {
  const key = `zuvo:rate:group:${userId}`;
  if ((await app.counterStore.increment(key, 3600)) > GROUPS_PER_HOUR) {
    throw new AppError('RATE_LIMITED', 'Too many new groups. Try again later.');
  }
  const others = [...new Set(input.memberIds)].filter((id) => id !== userId);
  if (others.length + 1 > GROUP_MEMBERS_MAX) {
    throw new AppError('GROUP_FULL', `A group can have at most ${GROUP_MEMBERS_MAX} members.`);
  }
  await requireActiveUsers(app, others);
  const name = await namesOf(app, [userId, ...others]);
  const timer = await defaultTimerOf(app, userId);
  const models = chatModels(app);
  const chatId = new Types.ObjectId();
  const now = new Date();
  const stored = await app.mongo.transaction(async (session) => {
    await models.Chat.insertMany(
      [
        {
          _id: chatId,
          type: 'group',
          createdBy: oid(userId),
          lastActivityAt: now,
          createdAt: now,
          group: {
            name: input.name,
            description: input.description,
            memberCount: others.length + 1,
            settings: DEFAULT_GROUP_SETTINGS,
          },
        },
      ],
      { session },
    );
    await models.ChatMember.insertMany(
      [userId, ...others].map((id) => ({
        chatId,
        userId: oid(id),
        role: id === userId ? 'owner' : 'member',
        joinedAt: now,
        joinSeq: 0,
        ackReadSeq: 0,
        lastActivityAt: now,
      })),
      { session },
    );
    const created = await appendSystemMessage(app, session, chatId, {
      kind: 'created',
      actor: name(userId),
      targets: others.map(name),
      value: input.name,
    });
    // The members did not choose the creator's default timer, so the group says it is on.
    const notice =
      timer === 'off' ? null : await appendTimerNotice(app, session, chatId, name(userId), timer);
    return { created, notice };
  });
  deliverSystemMessage(app, stored.created);
  if (stored.notice) deliverSystemMessage(app, stored.notice);
  return getChat(app, chatId.toString(), userId);
}

/** Name and description, each with its own message when it really changed. */
export async function updateGroupInfo(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  changes: { name?: string | undefined; description?: string | undefined },
) {
  const { chat, role, settings } = await requireGroupMember(app, chatId, userId);
  assertAllowed(groupRules.editInfo(role, settings), 'Only admins can change this group’s info.');
  const actor = (await namesOf(app, [userId]))(userId);
  const renamed = changes.name !== undefined && changes.name !== chat.group?.name;
  const described =
    changes.description !== undefined && changes.description !== (chat.group?.description ?? '');
  if (renamed || described) {
    const stored = await app.mongo.transaction(async (session) => {
      const set = {
        ...(renamed ? { 'group.name': changes.name } : {}),
        ...(described ? { 'group.description': changes.description } : {}),
      };
      await chatModels(app).Chat.updateOne({ _id: chat._id }, { $set: set }, { session });
      return appendSystemMessage(app, session, chat._id, {
        kind: renamed ? 'renamed' : 'description_changed',
        actor,
        targets: [],
        value: renamed ? (changes.name ?? '') : null,
      });
    });
    deliverSystemMessage(app, stored);
  }
  return getChat(app, chatId, userId);
}

export async function updateGroupSettings(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  changes: { [Key in keyof GroupSettings]?: GroupSettings[Key] | undefined },
) {
  const { chat, role, settings } = await requireGroupMember(app, chatId, userId);
  assertAllowed(groupRules.changeSettings(role), 'Only admins can change group settings.');
  const changed = (Object.keys(changes) as Array<keyof GroupSettings>).filter(
    (key) => changes[key] !== undefined && changes[key] !== settings[key],
  );
  if (changed.length > 0) {
    const actor = (await namesOf(app, [userId]))(userId);
    const stored = await app.mongo.transaction(async (session) => {
      await chatModels(app).Chat.updateOne(
        { _id: chat._id },
        { $set: { 'group.settings': { ...settings, ...changes } } },
        { session },
      );
      return appendSystemMessage(app, session, chat._id, {
        kind: 'settings_changed',
        actor,
        targets: [],
        value: changed.map((key) => `${key}:${changes[key]}`).join(','),
      });
    });
    deliverSystemMessage(app, stored);
  }
  return getChat(app, chatId, userId);
}

/** Same pipeline as profile photos: magic bytes, no metadata, two sizes. Null removes it. */
export async function setGroupPhoto(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  bytes: Uint8Array | null,
) {
  const { chat, role, settings } = await requireGroupMember(app, chatId, userId);
  assertAllowed(groupRules.editInfo(role, settings), 'Only admins can change this group’s photo.');
  const previous = chat.group?.photo;
  if (!bytes && !previous) return getChat(app, chatId, userId);
  let photo: { small: string; large: string; version: string } | null = null;
  if (bytes) {
    const { large, small } = await processAvatar(bytes);
    const [largeKey, smallKey] = await Promise.all([
      app.storage.save(Readable.from([large])),
      app.storage.save(Readable.from([small])),
    ]);
    photo = { large: largeKey.key, small: smallKey.key, version: Date.now().toString(36) };
  }
  const actor = (await namesOf(app, [userId]))(userId);
  const stored = await app.mongo.transaction(async (session) => {
    await chatModels(app).Chat.updateOne(
      { _id: chat._id },
      photo ? { $set: { 'group.photo': photo } } : { $unset: { 'group.photo': 1 } },
      { session },
    );
    return appendSystemMessage(app, session, chat._id, {
      kind: 'photo_changed',
      actor,
      targets: [],
      value: null,
    });
  });
  deliverSystemMessage(app, stored);
  if (previous) {
    await Promise.all([app.storage.delete(previous.small), app.storage.delete(previous.large)]);
  }
  return getChat(app, chatId, userId);
}
