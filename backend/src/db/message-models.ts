import type { LinkPreview, MediaInfo, ReplyQuote, SystemEvent } from '@zuvo/protocol';
import { Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

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

/** A poll on a message of type `poll`. Option ids are "0", "1"…, in the order written. */
export interface StoredPoll {
  question: string;
  options: Array<{ id: string; text: string; voterIds: Types.ObjectId[] }>;
  multiple: boolean;
  closedAt: Date | null;
}

export interface MessageDoc {
  _id: Types.ObjectId;
  chatId: Types.ObjectId;
  seq: number;
  clientMsgId: string | null;
  senderId: Types.ObjectId | null;
  type: 'text' | 'system' | 'poll' | MediaInfo['kind'];
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
  /** Groups: members named in the text, and "@everyone". */
  mentions?: Array<{ userId: Types.ObjectId; offset: number; length: number }>;
  mentionsEveryone?: boolean;
  poll?: StoredPoll;
  /** Sent while the chat's disappearing timer was on: deleted everywhere at this time. */
  expiresAt?: Date | null;
  /** A photo or video the others may open once. */
  viewOnce?: boolean;
  /** Who has opened it (never the sender). */
  viewOnceOpenedBy?: Types.ObjectId[];
  /** Everyone opened it, or its time ran out: the file is gone. */
  viewOnceDoneAt?: Date | null;
  replyToId: Types.ObjectId | null;
  editedAt: Date | null;
  deletedForEveryoneAt: Date | null;
  createdAt: Date;
}

export const messageSchema = new Schema<MessageDoc>(
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
    mentions: { type: [Schema.Types.Mixed], default: undefined },
    mentionsEveryone: { type: Boolean, default: undefined },
    poll: { type: Schema.Types.Mixed, default: undefined },
    expiresAt: { type: Date, default: undefined },
    viewOnce: { type: Boolean, default: undefined },
    viewOnceOpenedBy: { type: [ObjectId], default: undefined },
    viewOnceDoneAt: { type: Date, default: undefined },
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
// Serves: the job that deletes disappearing messages, soonest first. Partial: most never expire.
messageSchema.index(
  { expiresAt: 1 },
  { partialFilterExpression: { expiresAt: { $type: 'date' } } },
);
// Serves: the job that deletes view-once files nobody opened in time. Partial: view once is rare,
// and only ones not done yet are waiting.
messageSchema.index(
  { createdAt: 1 },
  { name: 'view_once_waiting', partialFilterExpression: { viewOnce: true, viewOnceDoneAt: null } },
);
// Serves: message search (whole words; English stemmed, Hindi and others kept as typed).
// `language_override` names a field no message has, so no text can switch its own language.
messageSchema.index(
  { text: 'text' },
  { name: 'message_text', default_language: 'english', language_override: 'searchLanguage' },
);
// Serves: "already sent?" check. Unique: the same clientMsgId can never create a second message.
// Partial (system messages have none): queries must include `$type: 'string'` to use it.
messageSchema.index(
  { senderId: 1, clientMsgId: 1 },
  { unique: true, partialFilterExpression: { clientMsgId: { $type: 'string' } } },
);
