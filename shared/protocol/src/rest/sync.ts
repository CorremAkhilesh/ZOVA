import { z } from 'zod';
import { chatSummarySchema, MESSAGE_PAGE_MAX, messageSchema } from './chats.ts';

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
  /**
   * Messages that changed: apply them only if this device has them. Storing an old one it never
   * loaded would leave a hole in its history that paging back could not see.
   */
  updated: z.array(messageSchema).default([]),
  /** Messages I deleted for me on another device. */
  removed: z.array(z.object({ chatId: z.string(), seq: z.number().int() })).default([]),
  /** Chats I cleared or deleted on another device: everything up to `seq` goes. */
  cleared: z
    .array(z.object({ chatId: z.string(), seq: z.number().int(), removeChat: z.boolean() }))
    .default([]),
});

/** GET /v1/chats/:id/media */
export const galleryQuerySchema = z.object({
  tab: z.enum(['media', 'docs', 'links']),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(MESSAGE_PAGE_MAX).default(60),
});
export const galleryResponseSchema = z.object({
  /** Newest first. */
  items: z.array(messageSchema),
  hasMore: z.boolean(),
});

export type SyncResponse = z.infer<typeof syncResponseSchema>;
