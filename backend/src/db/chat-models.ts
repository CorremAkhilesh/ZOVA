import type {
  GroupSettings,
  LastReaction,
  LinkPreview,
  MediaInfo,
  ReplyQuote,
  SystemEvent,
} from '@zuvo/protocol';
import { type Connection, type Model, Schema, type Types } from 'mongoose';
import { mediaSchema, receiptEventSchema } from './media-models.ts';
import {
  messageHiddenSchema,
  starSchema,
  userSyncSchema,
  userUpdateSchema,
} from './per-user-models.ts';

export type { MediaDoc, ReceiptEventDoc } from './media-models.ts';
export type { MessageHiddenDoc, StarDoc, UserSyncDoc, UserUpdateDoc } from './per-user-models.ts';
export { UPDATE_LOG_TTL_DAYS } from './per-user-models.ts';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

export interface LastMessageSnapshot {
  id: Types.ObjectId;
  seq: number;
  senderId: Types.ObjectId | null;
  type: 'text' | 'system' | MediaInfo['kind'];
  preview: string;
  system?: SystemEvent | null;
  deleted?: boolean;
  createdAt: Date;
}

export interface ChatDoc {
  _id: Types.ObjectId;
  type: 'direct' | 'group' | 'self';
  /** Direct chats: the two user ids, sorted, joined with ":". */
  pairKey?: string;
  /** Saved Messages: its one owner. */
  selfOwnerId?: Types.ObjectId;
  /** Position of the last message; messages get 1, 2, 3… with no gaps. */
  seq: number;
  lastMessage: LastMessageSnapshot | null;
  lastActivityAt: Date | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  group?: {
    name?: string;
    photo?: { small: string; large: string; version: string };
    description?: string;
    settings?: Partial<GroupSettings>;
    memberCount?: number;
    /** Set while the invite link works. */
    inviteCode?: string;
    /** How far every member has received and read. See group-receipts.service.ts. */
    deliveredMark?: number;
    readMark?: number;
  };
}

const chatSchema = new Schema<ChatDoc>(
  {
    type: { type: String, required: true },
    pairKey: String,
    selfOwnerId: ObjectId,
    seq: { type: Number, default: 0 },
    lastMessage: { type: Schema.Types.Mixed, default: null },
    lastActivityAt: { type: Date, default: null },
    createdBy: { type: ObjectId, required: true },
    createdAt: { type: Date, default: () => new Date() },
    group: Schema.Types.Mixed,
  },
  { ...options, collection: 'chats' },
);
// Serves: get-or-create a 1:1 chat. Unique: decides the race when two people open it at once.
// Partial: queries must include `type: 'direct'` for MongoDB to use it.
chatSchema.index({ pairKey: 1 }, { unique: true, partialFilterExpression: { type: 'direct' } });
// Serves: get-or-create Saved Messages. Unique: one per user.
// Partial: queries must include `type: 'self'` for MongoDB to use it.
chatSchema.index({ selfOwnerId: 1 }, { unique: true, partialFilterExpression: { type: 'self' } });

// Serves: opening an invite link. Unique: a code leads to one group.
// Partial: queries must include `$type: 'string'` for MongoDB to use it.
chatSchema.index(
  { 'group.inviteCode': 1 },
  { unique: true, partialFilterExpression: { 'group.inviteCode': { $type: 'string' } } },
);

export interface ChatMemberDoc {
  _id: Types.ObjectId;
  chatId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'member' | 'admin' | 'owner';
  joinedAt: Date;
  leftAt: Date | null;
  lastReadSeq: number;
  lastDeliveredSeq: number;
  /**
   * How far others may know this member has read. Follows lastReadSeq while read receipts are on for
   * both people, and stays put otherwise, so what was already shown as read stays read.
   */
  sharedReadSeq?: number;
  /** Groups: the last position before I joined. I see only what comes after it. */
  joinSeq?: number;
  /** Groups: my last position, once I have left. I keep what came up to here. */
  leftSeq?: number | null;
  /** Groups: the chat as it was when I left, since I hear nothing after that. */
  leftView?: {
    lastMessage: LastMessageSnapshot;
    group: {
      name: string;
      description: string;
      photo: { small: string; large: string } | null;
      memberCount: number;
    };
  };
  /** Groups: how far I count towards the color of others' ticks. See group-receipts.service.ts. */
  ackReadSeq?: number;
  /** Cleared the chat: I see nothing up to here. */
  clearedSeq?: number;
  /** Deleted the chat's last message for me: up to here, the chat list shows `previewLast` instead. */
  previewFloor?: number;
  previewLast?: LastMessageSnapshot | null;
  markedUnread?: boolean;
  /** Someone reacted to a message of mine. */
  lastReaction?: LastReaction;
  /** Groups: my account is deactivated, so I no longer hold up their ticks. */
  suspended?: boolean;
  /** Copied from the chat so the chat list is one index scan. Null hides a chat not yet messaged. */
  lastActivityAt: Date | null;
  // Reserved per-user flags.
  pinnedAt?: Date | null;
  mutedUntil?: Date | null;
  archivedAt?: Date | null;
  folderIds?: Types.ObjectId[];
  draft?: string | null;
}

const chatMemberSchema = new Schema<ChatMemberDoc>(
  {
    chatId: { type: ObjectId, required: true },
    userId: { type: ObjectId, required: true },
    role: { type: String, default: 'member' },
    joinedAt: { type: Date, default: () => new Date() },
    leftAt: { type: Date, default: null },
    lastReadSeq: { type: Number, default: 0 },
    lastDeliveredSeq: { type: Number, default: 0 },
    sharedReadSeq: { type: Number },
    joinSeq: Number,
    leftSeq: { type: Number, default: null },
    leftView: Schema.Types.Mixed,
    ackReadSeq: Number,
    clearedSeq: Number,
    previewFloor: Number,
    previewLast: Schema.Types.Mixed,
    markedUnread: Boolean,
    lastReaction: Schema.Types.Mixed,
    suspended: Boolean,
    lastActivityAt: { type: Date, default: null },
    pinnedAt: Date,
    mutedUntil: Date,
    archivedAt: Date,
    folderIds: { type: [ObjectId], default: undefined },
    draft: String,
  },
  { ...options, collection: 'chat_members' },
);
// Serves: membership check on every chat request and event, and "members of this chat".
chatMemberSchema.index({ chatId: 1, userId: 1 }, { unique: true });
// Serves: my chat list, most recent first, including groups I left, whose history I keep.
chatMemberSchema.index({ userId: 1, lastActivityAt: -1, chatId: -1 });
// Serves: how many chats I have pinned. Partial: most chats are not.
chatMemberSchema.index(
  { userId: 1, pinnedAt: 1 },
  { partialFilterExpression: { pinnedAt: { $type: 'date' } } },
);
// Serves: the groups of someone being deactivated.
chatMemberSchema.index({ userId: 1, leftAt: 1 });
// Serves: the member list, and the oldest member or admin when ownership passes on.
chatMemberSchema.index({ chatId: 1, leftAt: 1, joinedAt: 1 });
// Serves: how far everyone in a group has received, and read (the lowest value of each).
chatMemberSchema.index({ chatId: 1, leftAt: 1, lastDeliveredSeq: 1 });
chatMemberSchema.index({ chatId: 1, leftAt: 1, ackReadSeq: 1 });

export interface MessageReaction {
  userId: Types.ObjectId;
  emoji: string;
  at: Date;
}

export interface VoicePlay {
  userId: Types.ObjectId;
  at: Date;
  /** Whether both people had read receipts on at that moment. Decided once, and kept. */
  shared: boolean;
}

export interface MessageDoc {
  _id: Types.ObjectId;
  chatId: Types.ObjectId;
  seq: number;
  clientMsgId: string | null;
  senderId: Types.ObjectId | null;
  type: 'text' | 'system' | MediaInfo['kind'];
  text: string | null;
  /** What readers need to know about the file, copied here so history needs no second query. */
  media?: MediaInfo | null;
  albumId?: string | null;
  system?: SystemEvent | null;
  replyTo?: ReplyQuote | null;
  forwarded?: boolean;
  /** How many times this message has been forwarded, or for a copy, the original had been. */
  forwardCount?: number;
  /** One per person, kept with the message so history needs no second query. */
  reactions?: MessageReaction[];
  deletedByAdmin?: boolean;
  /** Voice notes: who played it. Only ever added to, so `played` never goes back. */
  plays?: VoicePlay[];
  /** Reserved for mentions. Formatting is read from the text itself. */
  entities?: unknown[];
  /** A copy of the sender's preview, kept after the cache forgets it. `hasLink`: the Links tab. */
  linkPreview?: LinkPreview | null;
  hasLink?: boolean;
  replyToId: Types.ObjectId | null;
  editedAt: Date | null;
  deletedForEveryoneAt: Date | null;
  createdAt: Date;
}

const messageSchema = new Schema<MessageDoc>(
  {
    chatId: { type: ObjectId, required: true },
    seq: { type: Number, required: true },
    clientMsgId: { type: String, default: null },
    senderId: { type: ObjectId, default: null },
    type: { type: String, required: true },
    text: { type: String, default: null },
    media: { type: Schema.Types.Mixed, default: null },
    albumId: { type: String, default: null },
    system: { type: Schema.Types.Mixed, default: undefined },
    replyTo: { type: Schema.Types.Mixed, default: undefined },
    forwarded: Boolean,
    forwardCount: Number,
    reactions: { type: [Schema.Types.Mixed], default: undefined },
    deletedByAdmin: Boolean,
    plays: { type: [Schema.Types.Mixed], default: undefined },
    entities: { type: [Schema.Types.Mixed], default: undefined },
    linkPreview: { type: Schema.Types.Mixed, default: undefined },
    hasLink: { type: Boolean, default: undefined },
    replyToId: { type: ObjectId, default: null },
    editedAt: { type: Date, default: null },
    deletedForEveryoneAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'messages' },
);
// Serves: history pages (before/after a position) and sync. Unique: a position is used only once.
messageSchema.index({ chatId: 1, seq: -1 }, { unique: true });
// Serves: who may open a file, since forwarded copies share one, and whether it is still needed.
messageSchema.index({ 'media.id': 1 }, { sparse: true });
// Serves: updating the quotes of a message when it is edited or deleted.
messageSchema.index({ 'replyTo.id': 1 }, { sparse: true });
// Serves: the gallery ("Media" and "Docs" in chat info), newest first.
messageSchema.index({ chatId: 1, type: 1, seq: -1 });
// Serves: the "Links" tab in chat info, newest first. Partial: most messages have no link.
messageSchema.index(
  { chatId: 1, hasLink: 1, seq: -1 },
  { partialFilterExpression: { hasLink: true } },
);
// Serves: "already sent?" check. Unique: the same clientMsgId can never create a second message.
// Partial (system messages have none): queries must include `$type: 'string'` to use it.
messageSchema.index(
  { senderId: 1, clientMsgId: 1 },
  { unique: true, partialFilterExpression: { clientMsgId: { $type: 'string' } } },
);

export function registerChatModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return {
    Chat: model('Chat', chatSchema),
    ChatMember: model('ChatMember', chatMemberSchema),
    Message: model('Message', messageSchema),
    Media: model('Media', mediaSchema),
    MessageHidden: model('MessageHidden', messageHiddenSchema),
    Star: model('Star', starSchema),
    UserSync: model('UserSync', userSyncSchema),
    UserUpdate: model('UserUpdate', userUpdateSchema),
    ReceiptEvent: model('ReceiptEvent', receiptEventSchema),
  };
}

export type ChatModels = ReturnType<typeof registerChatModels>;
