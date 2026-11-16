import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from '../common/id.ts';
import { wallpaperSchema } from './appearance.ts';
import { mentionSchema, pinnedMessageSchema } from './chat-extras.ts';
import { disappearTimerSchema } from './disappearing.ts';
import { groupInfoSchema } from './groups.ts';
import { linkPreviewSchema } from './link-previews.ts';
import { mediaInfoSchema } from './media.ts';
import { pollSchema } from './polls.ts';
import { publicProfileSchema } from './profile.ts';

export const MESSAGE_TEXT_MAX = 4096;
export const MESSAGE_PAGE_MAX = 100;
export const MESSAGE_PREVIEW_MAX = 120;
export const CHAT_PAGE_MAX = 50;

export const chatTypeSchema = z.enum(['direct', 'group', 'self']);
export const chatMemberRoleSchema = z.enum(['member', 'admin', 'owner']);
export const messageTypeSchema = z.enum([
  'text',
  'system',
  'image',
  'video',
  'document',
  'voice',
  'audio',
  'poll',
]);

/** What a system message says happened. Names are kept with it, so it reads the same later. */
export const systemEventSchema = z.object({
  kind: z.enum([
    'created',
    'added',
    'removed',
    'left',
    'joined',
    'renamed',
    'photo_changed',
    'description_changed',
    'promoted',
    'demoted',
    'settings_changed',
    'owner_changed',
    /** Someone pinned a message; `value` is its position in the chat. */
    'pinned',
    /** The disappearing-messages timer changed; `value` is the new one (`off`, `24h`…). */
    'disappearing_changed',
  ]),
  /** Null when the system did it, such as passing on ownership from a deactivated account. */
  actor: z.object({ id: z.string(), name: z.string() }).nullable(),
  targets: z.array(z.object({ id: z.string(), name: z.string() })),
  /** The new name, or which settings changed: `key:value,key:value`. */
  value: z.string().nullable(),
});

/** Client-generated id, unique per sender: re-sending the same one never creates a duplicate. */
export const clientMsgIdSchema = z.uuidv7();

export const messageTextSchema = z
  .string()
  .min(1)
  .max(MESSAGE_TEXT_MAX)
  .refine((text) => text.trim().length > 0, 'Message is empty');

/** What a reply shows of the message it answers. A copy, updated when that message changes. */
export const replyQuoteSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  seq: z.number().int().positive(),
  senderId: z.string().nullable(),
  senderName: z.string(),
  type: messageTypeSchema,
  text: z.string(),
  mediaId: z.string().nullable(),
  hasThumbnail: z.boolean(),
  deleted: z.boolean(),
  /** From before this person joined the group: they get to know only that it was a reply. */
  unavailable: z.boolean().optional(),
});

/** Unsent text and the reply being written, per chat and person. The newest `updatedAt` wins. */
export const draftSchema = z.object({
  text: z.string().max(MESSAGE_TEXT_MAX),
  replyTo: replyQuoteSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});

export const messageReactionSchema = z.object({
  userId: z.string(),
  emoji: z.string(),
  at: isoDateTimeSchema,
});

export const messageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  /** Position in the chat: 1, 2, 3… with no gaps. */
  seq: z.number().int().positive(),
  clientMsgId: z.string().nullable(),
  senderId: z.string().nullable(),
  type: messageTypeSchema,
  /** The caption on media. Null once deleted for everyone, or for media with no caption. */
  text: z.string().nullable(),
  /** Absent from older cached copies; null on text messages. */
  media: mediaInfoSchema.nullable().default(null),
  /** Messages sent together as an album share this. */
  albumId: z.string().nullable().default(null),
  /**
   * Voice notes, as this user may know. For the sender: the other person played it and may be seen to.
   * For anyone else: they played it themselves, on any device. Once true, it stays true.
   */
  played: z.boolean().default(false),
  /** System messages only. */
  system: systemEventSchema.nullable().optional(),
  replyTo: replyQuoteSchema.nullable().optional(),
  forwarded: z.boolean().optional(),
  /** How many times the original has been forwarded. */
  forwardCount: z.number().int().nonnegative().optional(),
  reactions: z.array(messageReactionSchema).optional(),
  /** For this user. Absent in events that are not about their own star: keep what you know. */
  starred: z.boolean().optional(),
  /** Deleted by a group's admin rather than its sender. */
  deletedByAdmin: z.boolean().optional(),
  /** The sender attached a preview of a link in the text. Gone once deleted for everyone. */
  linkPreview: linkPreviewSchema.nullable().optional(),
  /** Group members mentioned, and "@everyone". */
  mentions: z.array(mentionSchema).optional(),
  mentionsEveryone: z.boolean().optional(),
  /** Type `poll`: the question, options and votes. */
  poll: pollSchema.nullable().optional(),
  /** Sent while the chat's disappearing timer was on: it is deleted everywhere at this time. */
  expiresAt: isoDateTimeSchema.nullable().optional(),
  /** A photo or video that can be opened once. No thumbnail or placeholder is ever sent. */
  viewOnce: z.boolean().optional(),
  /** View once, as I see it: I opened it (or, as its sender, everyone has). */
  viewOnceOpened: z.boolean().optional(),
  replyToId: z.string().nullable(),
  editedAt: isoDateTimeSchema.nullable(),
  deletedForEveryoneAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const lastMessageSchema = z.object({
  id: z.string(),
  seq: z.number().int().positive(),
  senderId: z.string().nullable(),
  /**
   * The sender's display name when this message was sent, so a group's preview names them before
   * their profile is loaded. Null for system messages; absent in chats from before it existed. A
   * later rename shows from their next message (or once the reader has their profile).
   */
  senderName: z.string().nullable().optional(),
  type: messageTypeSchema,
  preview: z.string(),
  system: systemEventSchema.nullable().optional(),
  deleted: z.boolean().optional(),
  createdAt: isoDateTimeSchema,
});

/** "Riya reacted 👍 to 'hello'", in the chat list. For the message's author only. */
export const lastReactionSchema = z.object({
  byId: z.string(),
  byName: z.string(),
  emoji: z.string(),
  text: z.string(),
  seq: z.number().int().positive(),
  at: isoDateTimeSchema,
});

/** A chat as one member sees it. */
export const chatSummarySchema = z.object({
  id: z.string(),
  type: chatTypeSchema,
  /** The last message's position in this chat (0 when empty). */
  seq: z.number().int().nonnegative(),
  /** Direct chats only, with that person's privacy settings applied. */
  otherUser: publicProfileSchema.nullable(),
  /** Group chats only. */
  group: groupInfoSchema.nullable().optional(),
  lastMessage: lastMessageSchema.nullable(),
  lastReadSeq: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  /** How far the other person's devices have received; in a group, everyone's. 0 otherwise. */
  peerDeliveredSeq: z.number().int().nonnegative(),
  /**
   * How far the other person has read, as far as this user may know. It stops moving while either
   * person has read receipts off, and what was already read stays read.
   */
  peerReadSeq: z.number().int().nonnegative(),
  lastActivityAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  pinned: z.boolean().optional(),
  mutedUntil: isoDateTimeSchema.nullable().optional(),
  archived: z.boolean().optional(),
  markedUnread: z.boolean().optional(),
  lastReaction: lastReactionSchema.nullable().optional(),
  /** Pinned messages I may see, newest pin first. */
  pins: z.array(pinnedMessageSchema).optional(),
  /** Positions of messages mentioning me that I have not read yet, oldest first. */
  mentionSeqs: z.array(z.number().int().positive()).optional(),
  /**
   * My unsent text here, on every one of my devices; never anyone else's. Empty text with a time:
   * cleared then. Null: never had one here.
   */
  draft: draftSchema.nullable().optional(),
  /** The chat's disappearing-messages timer, the same for every member. */
  disappearing: disappearTimerSchema.optional(),
  /** Mine alone: behind the PIN, with no previews anywhere. */
  locked: z.boolean().optional(),
  /** Mine alone: this chat's own wallpaper; null or absent uses my default. */
  wallpaper: wallpaperSchema.nullable().optional(),
});

/** POST /v1/chats/direct */
export const createDirectChatBodySchema = z.object({ userId: objectIdSchema });
/** GET /v1/chats/:id and friends. */
export const chatParamsSchema = z.object({ id: objectIdSchema });
/** POST /v1/chats/direct · GET /v1/chats/self · GET /v1/chats/:id */
export const chatResponseSchema = z.object({ chat: chatSummarySchema });

/** GET /v1/chats */
export const chatListQuerySchema = z.object({
  cursor: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_PAGE_MAX).default(30),
});
export const chatListResponseSchema = z.object({
  items: z.array(chatSummarySchema),
  nextCursor: z.string().min(1).nullable(),
});

/** POST /v1/chats/:id/read */
export const markReadBodySchema = z.object({ seq: z.number().int().nonnegative() });
export const markReadResponseSchema = z.object({
  chatId: z.string(),
  lastReadSeq: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
});

/** "0:12", rounded down, as media players show it. */
export function formatDuration(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

export type ChatType = z.infer<typeof chatTypeSchema>;
export type ChatMemberRole = z.infer<typeof chatMemberRoleSchema>;
export type Message = z.infer<typeof messageSchema>;
export type ReplyQuote = z.infer<typeof replyQuoteSchema>;
export type LastReaction = z.infer<typeof lastReactionSchema>;
export type SystemEvent = z.infer<typeof systemEventSchema>;
export type LastMessage = z.infer<typeof lastMessageSchema>;
export type ChatSummary = z.infer<typeof chatSummarySchema>;
