import type { QuietHours } from '@zuvo/protocol';
import { type Connection, type Model, Types } from 'mongoose';
import { registerAuthModels } from '../db/auth-models.ts';
import { type MessageDoc, registerChatModels } from '../db/chat-models.ts';
import { registerLockModels } from '../db/lock-models.ts';
import { registerModerationModels } from '../db/moderation-models.ts';
import { toQuietHours } from '../settings/quiet-hours.service.ts';
import type { UserDoc } from '../users/user-record.ts';
import { toPushSettings } from './settings.service.ts';
import { type PushLanguage, toPushLanguage } from './strings.ts';

/** A burst bigger than this is still one notification; only the newest ones are looked at. */
export const PUSH_BATCH_MAX = 100;

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

type RecipientDoc = Pick<UserDoc, '_id' | 'status'> & {
  quietHours?: Partial<QuietHours> | null;
  pushSettings?: Parameters<typeof toPushSettings>[0];
  language?: string | null;
};

const users = (mongo: Connection) =>
  registerAuthModels(mongo).AuthUser as unknown as Model<
    RecipientDoc & Pick<UserDoc, 'displayName' | 'email'>
  >;

/** The person being notified: their choices, by _id. */
export async function loadRecipient(mongo: Connection, userId: string) {
  const user = await users(mongo)
    .findById(oid(userId))
    .select({ status: 1, quietHours: 1, pushSettings: 1, language: 1 })
    .lean();
  if (!user) return null;
  const lock = await registerLockModels(mongo)
    .Lock.findById(oid(userId))
    .select({ pinHash: 1, appLockEnabled: 1 })
    .lean();
  return {
    deactivated: user.status === 'deactivated',
    quietHours: toQuietHours(user.quietHours),
    settings: toPushSettings(user.pushSettings),
    language: toPushLanguage(user.language) as PushLanguage,
    appLock: Boolean(lock?.pinHash) && lock?.appLockEnabled === true,
  };
}

/** The chat and my membership of it. */
export async function loadChat(mongo: Connection, chatId: string, userId: string) {
  const { Chat, ChatMember } = registerChatModels(mongo);
  const member = await ChatMember.findOne({ chatId: oid(chatId), userId: oid(userId) }).lean();
  if (!member) return null;
  const chat = await Chat.findById(oid(chatId))
    .select({ type: 1, seq: 1, pairKey: 1, 'group.name': 1 })
    .lean();
  return chat ? { chat, member } : null;
}

const MESSAGE_FIELDS = {
  chatId: 1,
  seq: 1,
  senderId: 1,
  type: 1,
  text: 1,
  media: 1,
  'poll.question': 1,
  viewOnce: 1,
  mentions: 1,
  mentionsEveryone: 1,
  expiresAt: 1,
  deletedForEveryoneAt: 1,
} as const;

/** Messages after `floor`, newest first (index: chatId + seq). */
export async function loadCandidates(
  mongo: Connection,
  chatId: string,
  floor: number,
  top: number,
): Promise<MessageDoc[]> {
  return registerChatModels(mongo)
    .Message.find({ chatId: oid(chatId), seq: { $gt: floor, $lte: top } })
    .select(MESSAGE_FIELDS)
    .sort({ seq: -1 })
    .limit(PUSH_BATCH_MAX)
    .lean();
}

/** Which of these I deleted for me. */
export async function hiddenFor(
  mongo: Connection,
  userId: string,
  chatId: string,
  messageIds: Types.ObjectId[],
): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();
  const rows = await registerChatModels(mongo)
    .MessageHidden.find({
      userId: oid(userId),
      chatId: oid(chatId),
      messageId: { $in: messageIds },
    })
    .select({ messageId: 1 })
    .lean();
  return new Set(rows.map((row) => row.messageId.toString()));
}

/** One of the two blocked the other. */
export async function blockedBetween(mongo: Connection, a: string, b: string): Promise<boolean> {
  const { Block } = registerModerationModels(mongo);
  const [mine, theirs] = await Promise.all([
    Block.exists({ userId: oid(a), blockedId: oid(b) }),
    Block.exists({ userId: oid(b), blockedId: oid(a) }),
  ]);
  return Boolean(mine || theirs);
}

/**
 * The app badge, as the app counts it: chats in my list (including groups I left) with something
 * unread, or marked unread. Index: userId + lastActivityAt.
 */
export async function unreadChatCount(mongo: Connection, userId: string): Promise<number> {
  const { Chat, ChatMember } = registerChatModels(mongo);
  const members = await ChatMember.find({ userId: oid(userId), lastActivityAt: { $type: 'date' } })
    .select({ chatId: 1, lastReadSeq: 1, leftSeq: 1, markedUnread: 1 })
    .lean();
  if (members.length === 0) return 0;
  const chats = await Chat.find({ _id: { $in: members.map((member) => member.chatId) } })
    .select({ seq: 1 })
    .lean();
  const seqs = new Map(chats.map((chat) => [chat._id.toString(), chat.seq]));
  return members.filter(
    (member) =>
      member.markedUnread ||
      (member.leftSeq ?? seqs.get(member.chatId.toString()) ?? 0) > member.lastReadSeq,
  ).length;
}

/** What the notification calls the sender. */
export async function displayNameOf(mongo: Connection, userId: Types.ObjectId | null) {
  if (!userId) return '';
  const user = await users(mongo).findById(userId).select({ displayName: 1, email: 1 }).lean();
  return user?.displayName || user?.email.split('@')[0] || '';
}

/** Of these sessions, the ones that still exist and have not expired. */
export async function liveSessionIds(
  mongo: Connection,
  sessionIds: string[],
): Promise<Set<string>> {
  const valid = sessionIds.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return new Set();
  const rows = await registerAuthModels(mongo)
    .AuthSession.find({ _id: { $in: valid.map(oid) }, expiresAt: { $gt: new Date() } })
    .select({ _id: 1 })
    .lean();
  return new Set(rows.map((row) => String(row._id)));
}
