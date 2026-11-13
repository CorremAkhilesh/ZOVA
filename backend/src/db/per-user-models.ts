import { Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

/** Deleted for me: hidden from this person only. */
export interface MessageHiddenDoc {
  userId: Types.ObjectId;
  chatId: Types.ObjectId;
  messageId: Types.ObjectId;
  seq?: number;
  createdAt: Date;
}

export const messageHiddenSchema = new Schema<MessageHiddenDoc>(
  {
    userId: { type: ObjectId, required: true },
    chatId: { type: ObjectId, required: true },
    messageId: { type: ObjectId, required: true },
    seq: Number,
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'message_hidden' },
);
// Serves: "which messages of this chat did I hide?". Unique: hiding twice is one row.
messageHiddenSchema.index({ userId: 1, chatId: 1, messageId: 1 }, { unique: true });
// Serves: which members hid this message, so an update to it does not bring it back for them.
messageHiddenSchema.index({ chatId: 1, messageId: 1, userId: 1 });

/** A message I starred, per person. */
export interface StarDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  chatId: Types.ObjectId;
  messageId: Types.ObjectId;
  seq: number;
  at: Date;
}

export const starSchema = new Schema<StarDoc>(
  {
    userId: { type: ObjectId, required: true },
    chatId: { type: ObjectId, required: true },
    messageId: { type: ObjectId, required: true },
    seq: { type: Number, required: true },
    at: { type: Date, required: true },
  },
  { ...options, collection: 'stars' },
);
// Serves: star, unstar, and which messages of a page are mine. Unique: starring twice is one row.
starSchema.index({ userId: 1, messageId: 1 }, { unique: true });
// Serves: my Starred screen, newest first.
starSchema.index({ userId: 1, at: -1, _id: -1 });
// Serves: my Starred screen for one chat, and clearing a chat.
starSchema.index({ userId: 1, chatId: 1, at: -1, _id: -1 });
// Serves: a message deleted for everyone leaves nobody's Starred screen behind.
starSchema.index({ chatId: 1, messageId: 1 });

/** One counter per user: how many changes this user has ever had. _id is the user id. */
export interface UserSyncDoc {
  _id: Types.ObjectId;
  seq: number;
}

export const userSyncSchema = new Schema<UserSyncDoc>(
  { _id: { type: ObjectId, required: true }, seq: { type: Number, default: 0 } },
  { ...options, collection: 'user_sync' },
);

export const UPDATE_LOG_TTL_DAYS = 30;

/** One row per change per user, numbered by that user's counter. See docs/protocol.md. */
export interface UserUpdateDoc {
  userId: Types.ObjectId;
  /** This user's change number: 1, 2, 3… with no gaps until old rows expire. */
  pts: number;
  kind:
    | 'message'
    | 'read'
    | 'chat'
    | 'receipt'
    | 'played'
    | 'updated'
    | 'hidden'
    | 'cleared'
    | 'chat_removed';
  chatId: Types.ObjectId;
  /** kind = message or played: the message's position in its chat. */
  seq?: number;
  at: Date;
}

export const userUpdateSchema = new Schema<UserUpdateDoc>(
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
