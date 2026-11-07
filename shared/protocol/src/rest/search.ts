import { z } from 'zod';
import { objectIdSchema } from '../common/id.ts';
import { chatTypeSchema, messageSchema } from './chats.ts';

export const SEARCH_QUERY_MAX = 100;
export const SEARCH_PAGE_MAX = 30;

/** What kind of message to look for; Docs also covers audio files. */
export const searchFilterSchema = z.enum(['photos', 'videos', 'docs', 'links', 'voice']);

/**
 * GET /v1/search/messages — whole words, every word must match (English words also match their
 * other forms: "meeting" finds "meetings"). With `chatId`, only that chat. A filter alone lists
 * that kind of message, newest first.
 */
export const messageSearchQuerySchema = z
  .object({
    q: z.string().trim().max(SEARCH_QUERY_MAX).default(''),
    filter: searchFilterSchema.optional(),
    chatId: objectIdSchema.optional(),
    cursor: objectIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(SEARCH_PAGE_MAX).default(20),
  })
  .refine((query) => query.q.length > 0 || query.filter !== undefined, {
    message: 'Type something to search for, or pick a filter',
  });

export const messageSearchHitSchema = z.object({
  message: messageSchema,
  chat: z.object({
    id: z.string(),
    type: chatTypeSchema,
    /** Group name, or the other person's name. Null for Saved Messages (the app names it). */
    title: z.string().nullable(),
  }),
  senderName: z.string().nullable(),
});

export const messageSearchResponseSchema = z.object({
  /** Newest first. */
  items: z.array(messageSearchHitSchema),
  /** Pass as `cursor` for older results; null when there are no more. */
  nextCursor: z.string().nullable(),
});

export type SearchFilter = z.infer<typeof searchFilterSchema>;
export type MessageSearchHit = z.infer<typeof messageSearchHitSchema>;
export type MessageSearchResponse = z.infer<typeof messageSearchResponseSchema>;
