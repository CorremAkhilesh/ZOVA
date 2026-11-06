import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from '../common/id.ts';
import { groupInfoSchema } from './groups.ts';
import { mediaInfoSchema } from './media.ts';
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
  replyToId: z.string().nullable(),
  editedAt: isoDateTimeSchema.nullable(),
  deletedForEveryoneAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const lastMessageSchema = z.object({
  id: z.string(),
  seq: z.number().int().positive(),
  senderId: z.string().nullable(),
  type: messageTypeSchema,
  preview: z.string(),
  system: systemEventSchema.nullable().optional(),
  createdAt: isoDateTimeSchema,
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

/** GET /v1/chats/:id/messages: newest page by default; `before`/`after` are chat positions. */
export const messageHistoryQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(MESSAGE_PAGE_MAX).default(50),
});
export const messageHistoryResponseSchema = z.object({
  /** Always oldest first. */
  items: z.array(messageSchema),
  /** More messages exist in the direction being read. */
  hasMore: z.boolean(),
});

/** POST /v1/chats/:id/read */
export const markReadBodySchema = z.object({ seq: z.number().int().nonnegative() });
export const markReadResponseSchema = z.object({
  chatId: z.string(),
  lastReadSeq: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
});

/** The sync cursor is opaque to clients; see docs/protocol.md. */
export const syncCursorSchema = z.string().regex(/^\d{1,15}$/, 'Invalid cursor');

/** GET /v1/sync */
export const syncQuerySchema = z.object({
  since: syncCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export const syncResponseSchema = z.object({
  /** Pass this as `since` next time. */
  cursor: syncCursorSchema,
  /** The cursor is missing, unknown or too old: reload the chat list, then continue from `cursor`. */
  reset: z.boolean(),
  /** More changes are waiting: call again straight away with `cursor`. */
  hasMore: z.boolean(),
  /** Current state of every chat that changed. */
  chats: z.array(chatSummarySchema),
  /** The missing messages, oldest change first. */
  messages: z.array(messageSchema),
});

/** GET /v1/chats/:id/media */
export const galleryQuerySchema = z.object({
  tab: z.enum(['media', 'docs']),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(MESSAGE_PAGE_MAX).default(60),
});
export const galleryResponseSchema = z.object({
  /** Newest first. */
  items: z.array(messageSchema),
  hasMore: z.boolean(),
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
export type SystemEvent = z.infer<typeof systemEventSchema>;
export type LastMessage = z.infer<typeof lastMessageSchema>;
export type ChatSummary = z.infer<typeof chatSummarySchema>;
export type SyncResponse = z.infer<typeof syncResponseSchema>;
