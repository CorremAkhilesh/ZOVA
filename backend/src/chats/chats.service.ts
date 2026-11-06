import type { ChatSummary } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { type ChatDoc, type ChatMemberDoc, registerChatModels } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { privacyOf, toPublicProfile, type UserDoc, usersModel } from '../users/user-record.ts';
import { groupView } from './group-core.ts';
import { toLastMessage } from './message-format.ts';
import { logUpdates } from './updates.ts';

export const chatModels = (app: FastifyInstance) => registerChatModels(app.mongo);
export const oid = (id: string) => new Types.ObjectId(id);

export const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

/** Sorted, so both people get the same key whoever opens the chat first. */
export const pairKeyOf = (a: string, b: string) => [a, b].sort().join(':');

/** Non-members get the same answer as for a chat that does not exist. */
export async function requireMember(
  app: FastifyInstance,
  chatId: string,
  userId: string,
): Promise<ChatMemberDoc> {
  const member = await chatModels(app)
    .ChatMember.findOne({ chatId: oid(chatId), userId: oid(userId), leftAt: null })
    .lean();
  if (!member) throw new AppError('NOT_FOUND', 'Chat not found.');
  return member;
}

/** The chats behind `rows` as `viewerId` sees them. Same order as `rows`; one query per kind. */
export async function buildSummaries(
  app: FastifyInstance,
  viewerId: string,
  rows: ChatMemberDoc[],
): Promise<ChatSummary[]> {
  if (rows.length === 0) return [];
  const { Chat, ChatMember } = chatModels(app);
  const chatIds = rows.map((row) => row.chatId);
  const chats = await Chat.find({ _id: { $in: chatIds } }).lean();
  const chatById = new Map(chats.map((chat) => [chat._id.toString(), chat]));

  const directIds = chats.filter((chat) => chat.type === 'direct').map((chat) => chat._id);
  const others = directIds.length
    ? await ChatMember.find({ chatId: { $in: directIds }, userId: { $ne: oid(viewerId) } }).lean()
    : [];
  const users = others.length
    ? ((await usersModel(app)
        .find({ _id: { $in: others.map((other) => other.userId) } })
        .lean()) as UserDoc[])
    : [];
  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const viewer = chats.some((chat) => chat.type === 'group')
    ? ((await usersModel(app).findById(viewerId).select({ privacy: 1 }).lean()) as UserDoc | null)
    : null;
  const seesReads = viewer ? privacyOf(viewer).readReceipts : true;
  const otherByChat = new Map(others.map((other) => [other.chatId.toString(), other]));

  return rows.flatMap((row) => {
    const chat = chatById.get(row.chatId.toString());
    if (!chat) return [];
    const other = otherByChat.get(chat._id.toString());
    const person = other && userById.get(other.userId.toString());
    const progress =
      chat.type === 'group'
        ? {
            peerDeliveredSeq: chat.group?.deliveredMark ?? 0,
            // Reciprocal: with my receipts off, I see no reads either.
            peerReadSeq: seesReads ? (chat.group?.readMark ?? 0) : 0,
          }
        : other
          ? peerProgress(other)
          : NO_PEER;
    return [toSummary(chat, row, person ? toPublicProfile(person, viewerId) : null, progress)];
  });
}

type PeerProgress = Pick<ChatSummary, 'peerDeliveredSeq' | 'peerReadSeq'>;
const NO_PEER: PeerProgress = { peerDeliveredSeq: 0, peerReadSeq: 0 };

/** Reciprocal, like the rest of presence: with receipts off on either side, nobody sees reads. */
export const readReceiptsVisible = (a: UserDoc | undefined, b: UserDoc | undefined) =>
  Boolean(a && b && privacyOf(a).readReceipts && privacyOf(b).readReceipts);

function peerProgress(
  other: Pick<ChatMemberDoc, 'lastDeliveredSeq' | 'lastReadSeq' | 'sharedReadSeq'>,
): PeerProgress {
  return {
    peerDeliveredSeq: other.lastDeliveredSeq,
    peerReadSeq: other.sharedReadSeq ?? other.lastReadSeq,
  };
}

function toSummary(
  chat: ChatDoc,
  member: ChatMemberDoc,
  otherUser: ChatSummary['otherUser'],
  peer: PeerProgress,
): ChatSummary {
  // Someone who left sees the chat as it was then, however it has moved on since.
  const seq = member.leftSeq ?? chat.seq;
  const last = member.leftAt ? member.leftView?.lastMessage : chat.lastMessage;
  return {
    id: chat._id.toString(),
    type: chat.type,
    seq,
    otherUser,
    group: chat.type === 'group' ? groupView(chat, member) : null,
    lastMessage: last ? toLastMessage(last) : null,
    lastReadSeq: member.lastReadSeq,
    unreadCount: Math.max(0, seq - member.lastReadSeq),
    ...peer,
    lastActivityAt: member.lastActivityAt?.toISOString() ?? null,
    createdAt: chat.createdAt.toISOString(),
  };
}

async function summaryFor(app: FastifyInstance, chatId: string, userId: string) {
  const member = await chatModels(app)
    .ChatMember.findOne({ chatId: oid(chatId), userId: oid(userId) })
    .lean();
  if (!member) throw new AppError('NOT_FOUND', 'Chat not found.');
  const [summary] = await buildSummaries(app, userId, [member]);
  if (!summary) throw new AppError('NOT_FOUND', 'Chat not found.');
  return summary;
}

export const getChat = summaryFor;

/** Tells the creator's devices about a new chat. The other person hears at the first message. */
function announceChat(app: FastifyInstance, summary: ChatSummary, userId: string, cursor: string) {
  app.realtime.emitToUser(userId, 'chat:updated', {
    chatId: summary.id,
    type: summary.type,
    seq: summary.seq,
    lastMessage: summary.lastMessage,
    lastReadSeq: summary.lastReadSeq,
    unreadCount: summary.unreadCount,
    lastActivityAt: summary.lastActivityAt,
    cursor,
  });
}

/** Creates a chat with its members in one transaction; a lost unique-index race returns null. */
async function createChat(
  app: FastifyInstance,
  creatorId: string,
  fields: Pick<ChatDoc, 'type' | 'pairKey' | 'selfOwnerId'>,
  members: Array<Pick<ChatMemberDoc, 'userId' | 'role' | 'lastActivityAt'>>,
): Promise<string | null> {
  const models = chatModels(app);
  const now = new Date();
  const chatId = new Types.ObjectId();
  try {
    const cursor = await app.mongo.transaction(async (session) => {
      await models.Chat.insertMany(
        [
          {
            ...fields,
            _id: chatId,
            createdBy: oid(creatorId),
            lastActivityAt: now,
            createdAt: now,
          },
        ],
        { session },
      );
      await models.ChatMember.insertMany(
        members.map((member) => ({ ...member, chatId, joinedAt: now })),
        { session },
      );
      const cursors = await logUpdates(
        models,
        session,
        [oid(creatorId)],
        { kind: 'chat', chatId },
        now,
      );
      return cursors.get(creatorId) ?? '0';
    });
    announceChat(app, await summaryFor(app, chatId.toString(), creatorId), creatorId, cursor);
    return chatId.toString();
  } catch (error) {
    if (isDuplicateKey(error)) return null;
    throw error;
  }
}

/** Get or create the 1:1 chat. Idempotent; when two requests race, the unique pairKey picks one. */
export async function getOrCreateDirectChat(
  app: FastifyInstance,
  userId: string,
  otherId: string,
): Promise<ChatSummary> {
  if (userId === otherId) {
    throw new AppError('BAD_REQUEST', 'You cannot chat with yourself. Use Saved Messages instead.');
  }
  const other = (await usersModel(app).findById(otherId).lean()) as UserDoc | null;
  if (!other) throw new AppError('NOT_FOUND', 'User not found.');
  if (other.status === 'deactivated') {
    throw new AppError('FORBIDDEN', 'This account has been deactivated.');
  }
  const { Chat, ChatMember } = chatModels(app);
  const pairKey = pairKeyOf(userId, otherId);
  const find = () => Chat.findOne({ type: 'direct', pairKey }).lean();

  let chat = await find();
  if (!chat) {
    await createChat(app, userId, { type: 'direct', pairKey }, [
      { userId: oid(userId), role: 'member', lastActivityAt: new Date() },
      // Stays out of the other person's list until the first message.
      { userId: oid(otherId), role: 'member', lastActivityAt: null },
    ]);
    chat = await find();
  }
  if (!chat) throw new AppError('INTERNAL_ERROR', 'Could not open this chat.');
  // Opened by the other person earlier and never messaged: now it belongs in my list too.
  await ChatMember.updateOne(
    { chatId: chat._id, userId: oid(userId), lastActivityAt: null },
    { $set: { lastActivityAt: new Date() } },
  );
  return summaryFor(app, chat._id.toString(), userId);
}

/** Saved Messages: one per user, created on first use. */
export async function getOrCreateSelfChat(
  app: FastifyInstance,
  userId: string,
): Promise<ChatSummary> {
  const { Chat } = chatModels(app);
  const selfOwnerId = oid(userId);
  const find = () => Chat.findOne({ type: 'self', selfOwnerId }).lean();
  let chat = await find();
  if (!chat) {
    await createChat(app, userId, { type: 'self', selfOwnerId }, [
      { userId: selfOwnerId, role: 'owner', lastActivityAt: new Date() },
    ]);
    chat = await find();
  }
  if (!chat) throw new AppError('INTERNAL_ERROR', 'Could not open Saved Messages.');
  return summaryFor(app, chat._id.toString(), userId);
}

function decodeChatCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const [time, id] = cursor.split('_');
  if (!time || !id || !/^\d+$/.test(time) || !Types.ObjectId.isValid(id)) {
    throw new AppError('BAD_REQUEST', 'Invalid cursor.');
  }
  return { at: new Date(Number(time)), id: oid(id) };
}

/** My chats, most recent first, cursor on (lastActivityAt, chatId). */
export async function listChats(
  app: FastifyInstance,
  userId: string,
  limit: number,
  cursor?: string,
) {
  const after = decodeChatCursor(cursor);
  const base = { userId: oid(userId) };
  const filter = after
    ? {
        ...base,
        $or: [
          { lastActivityAt: { $lt: after.at } },
          { lastActivityAt: after.at, chatId: { $lt: after.id } },
        ],
      }
    : { ...base, lastActivityAt: { $type: 'date' as const } };
  const rows = await chatModels(app)
    .ChatMember.find(filter)
    .sort({ lastActivityAt: -1, chatId: -1 })
    .limit(limit + 1)
    .lean();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: await buildSummaries(app, userId, page),
    nextCursor:
      rows.length > limit && last?.lastActivityAt
        ? `${last.lastActivityAt.getTime()}_${last.chatId.toString()}`
        : null,
  };
}
