import type { GroupInfo, GroupRole, Message, SystemEvent } from '@zuvo/protocol';
import { DEFAULT_GROUP_SETTINGS } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { type ClientSession, Types } from 'mongoose';
import type { ChatDoc, ChatMemberDoc, LastMessageSnapshot, MessageDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';
import { chatModels, oid, requireMember } from './chats.service.ts';
import { toLastMessage, toMessage } from './message-format.ts';
import { logUpdates } from './updates.ts';

export const photoUrls = (chat: Pick<ChatDoc, '_id' | 'group'>) => {
  const photo = chat.group?.photo;
  if (!photo?.version) return null;
  const base = `/v1/chats/${chat._id.toString()}/photo`;
  return {
    small: `${base}?size=small&v=${photo.version}`,
    large: `${base}?size=large&v=${photo.version}`,
  };
};

/** A group as this member sees it. Someone who left sees it as it was when they left. */
export function groupView(chat: ChatDoc, member: ChatMemberDoc): GroupInfo {
  const { group } = chat;
  const frozen = member.leftAt ? member.leftView?.group : undefined;
  return {
    name: frozen?.name ?? group?.name ?? '',
    description: frozen?.description ?? group?.description ?? '',
    photo: frozen ? frozen.photo : photoUrls(chat),
    memberCount: frozen?.memberCount ?? group?.memberCount ?? 0,
    settings: { ...DEFAULT_GROUP_SETTINGS, ...group?.settings },
    myRole: member.role,
    active: member.leftAt === null,
  };
}

/** A group I belong to, or the answer for any chat I do not. */
export async function requireGroupMember(app: FastifyInstance, chatId: string, userId: string) {
  const member = await requireMember(app, chatId, userId);
  const chat = await chatModels(app).Chat.findById(chatId).lean();
  if (chat?.type !== 'group') throw new AppError('NOT_FOUND', 'Group not found.');
  const settings = { ...DEFAULT_GROUP_SETTINGS, ...chat.group?.settings };
  return { chat, member, settings, role: member.role as GroupRole };
}

/** The names system messages show, kept with them so they read the same later. */
export async function namesOf(app: FastifyInstance, userIds: string[]) {
  const users = (await usersModel(app)
    .find({ _id: { $in: userIds.map(oid) } })
    .select({ displayName: 1, email: 1 })
    .lean()) as UserDoc[];
  const names = new Map(
    users.map((user) => [user._id.toString(), user.displayName ?? user.email ?? '']),
  );
  return (id: string) => ({ id, name: names.get(id) ?? '' });
}

export interface StoredSystemMessage {
  doc: MessageDoc;
  chat: ChatDoc;
  lastMessage: LastMessageSnapshot;
  members: ChatMemberDoc[];
  cursors: Map<string, string>;
}

interface AppendOptions {
  /** Told about this even though they are no longer members by the end of it. */
  alsoTell?: string[];
  /** Changes that belong with this message. Runs once it has its position. */
  apply?: (seq: number, lastMessage: LastMessageSnapshot) => Promise<void>;
}

/**
 * Adds a system message to a group inside the caller's transaction, along with whatever it announces,
 * so a member can never appear without the message saying so, or the other way round.
 */
export async function appendSystemMessage(
  app: FastifyInstance,
  session: ClientSession,
  chatId: Types.ObjectId,
  system: SystemEvent,
  options: AppendOptions = {},
): Promise<StoredSystemMessage> {
  const models = chatModels(app);
  const now = new Date();
  const bumped = await models.Chat.findOneAndUpdate(
    { _id: chatId },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', session },
  ).lean();
  if (!bumped) throw new AppError('NOT_FOUND', 'Group not found.');
  const id = new Types.ObjectId();
  const lastMessage: LastMessageSnapshot = {
    id,
    seq: bumped.seq,
    senderId: null,
    type: 'system',
    preview: '',
    system,
    createdAt: now,
  };
  const doc: MessageDoc = {
    _id: id,
    chatId,
    seq: bumped.seq,
    clientMsgId: null,
    senderId: null,
    type: 'system',
    text: null,
    system,
    replyToId: null,
    editedAt: null,
    deletedForEveryoneAt: null,
    createdAt: now,
  };
  await models.Message.insertMany([doc], { session });
  await models.Chat.updateOne(
    { _id: chatId },
    { $set: { lastMessage, lastActivityAt: now } },
    { session },
  );
  await options.apply?.(bumped.seq, lastMessage);
  const told = (options.alsoTell ?? []).map(oid);
  await models.ChatMember.updateMany(
    { chatId, $or: [{ leftAt: null }, { userId: { $in: told } }] },
    { $set: { lastActivityAt: now } },
    { session },
  );
  const members = await models.ChatMember.find({
    chatId,
    $or: [{ leftAt: null }, { userId: { $in: told } }],
  })
    .session(session)
    .lean();
  const cursors = await logUpdates(
    models,
    session,
    members.map((member) => member.userId),
    { kind: 'message', chatId, seq: bumped.seq },
    now,
  );
  const chat = await models.Chat.findById(chatId).session(session).lean();
  if (!chat) throw new AppError('NOT_FOUND', 'Group not found.');
  return { doc, chat, lastMessage, members, cursors };
}

/** After commit: every member hears about the message, and the group as they now see it. */
export function deliverSystemMessage(app: FastifyInstance, stored: StoredSystemMessage) {
  const { doc, chat, lastMessage, members, cursors } = stored;
  for (const member of members) {
    const viewerId = member.userId.toString();
    const cursor = cursors.get(viewerId) ?? '0';
    const message: Message = toMessage(doc, viewerId);
    app.realtime.emitToUser(viewerId, 'message:new', { message, cursor });
    app.realtime.emitToUser(viewerId, 'chat:updated', {
      chatId: message.chatId,
      type: chat.type,
      seq: message.seq,
      lastMessage: toLastMessage(lastMessage),
      lastReadSeq: member.lastReadSeq,
      unreadCount: Math.max(0, message.seq - member.lastReadSeq),
      lastActivityAt: message.createdAt,
      group: groupView(chat, member),
      cursor,
    });
  }
}
