import type { MediaInfo } from '@zuvo/protocol';
import { type Connection, type Model, Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

export interface LastMessageSnapshot {
  id: Types.ObjectId;
  seq: number;
  senderId: Types.ObjectId | null;
  type: 'text' | 'system' | MediaInfo['kind'];
  preview: string;
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
  /** Reserved for groups (Step 13). */
  group?: {
    name?: string;
    photo?: { small: string; large: string; version: string };
    description?: string;
    settings?: Record<string, unknown>;
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
// Serves: my chat list, most recent first (ESR: user and leftAt equal, then sort on activity + id).
chatMemberSchema.index({ userId: 1, leftAt: 1, lastActivityAt: -1, chatId: -1 });

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
  /** Reserved for formatting and mentions. */
  entities?: unknown[];
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
    entities: { type: [Schema.Types.Mixed], default: undefined },
    replyToId: { type: ObjectId, default: null },
    editedAt: { type: Date, default: null },
    deletedForEveryoneAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'messages' },
);
// Serves: history pages (before/after a position) and sync. Unique: a position is used only once.
messageSchema.index({ chatId: 1, seq: -1 }, { unique: true });
// Serves: the gallery ("Media" and "Docs" in chat info), newest first.
messageSchema.index({ chatId: 1, type: 1, seq: -1 });
// Serves: "already sent?" check. Unique: the same clientMsgId can never create a second message.
// Partial (system messages have none): queries must include `$type: 'string'` to use it.
messageSchema.index(
  { senderId: 1, clientMsgId: 1 },
  { unique: true, partialFilterExpression: { clientMsgId: { $type: 'string' } } },
);

/** Reserved: delete for me. */
export interface MessageHiddenDoc {
  userId: Types.ObjectId;
  chatId: Types.ObjectId;
  messageId: Types.ObjectId;
  createdAt: Date;
}

const messageHiddenSchema = new Schema<MessageHiddenDoc>(
  {
    userId: { type: ObjectId, required: true },
    chatId: { type: ObjectId, required: true },
    messageId: { type: ObjectId, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'message_hidden' },
);
// Serves: "which messages of this chat did I hide?". Unique: hiding twice is one row.
messageHiddenSchema.index({ userId: 1, chatId: 1, messageId: 1 }, { unique: true });

/** One counter per user: how many changes this user has ever had. _id is the user id. */
export interface UserSyncDoc {
  _id: Types.ObjectId;
  seq: number;
}

const userSyncSchema = new Schema<UserSyncDoc>(
  { _id: { type: ObjectId, required: true }, seq: { type: Number, default: 0 } },
  { ...options, collection: 'user_sync' },
);

export const UPDATE_LOG_TTL_DAYS = 30;

/** One row per change per user, numbered by that user's counter. See docs/protocol.md. */
export interface UserUpdateDoc {
  userId: Types.ObjectId;
  /** This user's change number: 1, 2, 3… with no gaps until old rows expire. */
  pts: number;
  kind: 'message' | 'read' | 'chat' | 'receipt';
  chatId: Types.ObjectId;
  /** kind = message: the message's position in its chat. */
  seq?: number;
  at: Date;
}

const userUpdateSchema = new Schema<UserUpdateDoc>(
  {
    userId: { type: ObjectId, required: true },
    pts: { type: Number, required: true },
    kind: { type: String, required: true },
    chatId: { type: ObjectId, required: true },
    seq: Number,
    at: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'user_updates' },
);
// Serves: GET /v1/sync (everything after my cursor, in order). Unique: a number is used only once.
userUpdateSchema.index({ userId: 1, pts: 1 }, { unique: true });
// TTL: a device away this long reloads its chat list instead (`reset` in the sync response).
userUpdateSchema.index({ at: 1 }, { expireAfterSeconds: UPDATE_LOG_TTL_DAYS * 86_400 });

export interface MediaDoc {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  kind: MediaInfo['kind'];
  mime: string;
  size: number;
  /** As the user named it: shown and offered on download, and never used on disk. */
  name: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sha256: string | null;
  storageKey: string | null;
  thumbnailKey: string | null;
  placeholder: string | null;
  status: 'pending' | 'ready' | 'failed';
  /** Set once, when attached to a message. */
  messageId: Types.ObjectId | null;
  chatId: Types.ObjectId | null;
  createdAt: Date;
}

const mediaSchema = new Schema<MediaDoc>(
  {
    ownerId: { type: ObjectId, required: true },
    kind: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    name: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration: { type: Number, default: null },
    sha256: { type: String, default: null },
    storageKey: { type: String, default: null },
    thumbnailKey: { type: String, default: null },
    placeholder: { type: String, default: null },
    status: { type: String, required: true, default: 'pending' },
    messageId: { type: ObjectId, default: null },
    chatId: { type: ObjectId, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'media' },
);
// Serves: how many uploads a person has open (the per-user limit).
mediaSchema.index({ ownerId: 1, status: 1, createdAt: -1 });
// Serves: Admin → Users, how much each person stores. Holds `size`, so no document is read.
mediaSchema.index({ ownerId: 1, status: 1, size: 1 });
// Serves: the hourly cleanup of uploads never attached to a message.
mediaSchema.index({ messageId: 1, createdAt: 1 });

export function registerChatModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return {
    Chat: model('Chat', chatSchema),
    ChatMember: model('ChatMember', chatMemberSchema),
    Message: model('Message', messageSchema),
    Media: model('Media', mediaSchema),
    MessageHidden: model('MessageHidden', messageHiddenSchema),
    UserSync: model('UserSync', userSyncSchema),
    UserUpdate: model('UserUpdate', userUpdateSchema),
  };
}

export type ChatModels = ReturnType<typeof registerChatModels>;
