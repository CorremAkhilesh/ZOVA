import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from '../common/id.ts';
import { mentionsInputSchema } from './chat-extras.ts';
import { messageSchema, messageTextSchema } from './chats.ts';

export const EDIT_WINDOW_MINUTES = 15;
export const DELETE_WINDOW_HOURS = 48;
export const FORWARD_MAX_CHATS = 5;
export const FORWARD_MAX_MESSAGES = 20;
export const FORWARDED_MANY_TIMES = 5;
export const PINNED_CHATS_MAX = 3;
export const REACTIONS_QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

/** PATCH /v1/chats/:id/messages/:messageId. Empty only for a caption, which it then removes. */
export const editMessageBodySchema = z.object({
  text: z.string().max(4096),
  /** Groups: the mentions in the new text. Leaving them out removes every mention. */
  mentions: mentionsInputSchema.optional(),
  mentionsEveryone: z.boolean().optional(),
});

/** DELETE /v1/chats/:id/messages/:messageId?scope=me|everyone */
export const deleteMessageQuerySchema = z.object({ scope: z.enum(['me', 'everyone']) });

/** One emoji, with its skin tone or joiners: no text, and nothing long. */
const emojiSchema = z
  .string()
  .min(1)
  .max(16)
  .regex(/^\p{Extended_Pictographic}/u, 'Must be an emoji');

/** PUT /v1/chats/:id/messages/:messageId/reaction */
export const reactionBodySchema = z.object({ emoji: emojiSchema });

export const messageRefSchema = z.object({ chatId: objectIdSchema, messageId: objectIdSchema });

/** POST /v1/forward */
export const forwardBodySchema = z.object({
  /** Client-made, so sending it again creates nothing new. */
  forwardId: z.uuid(),
  messages: z.array(messageRefSchema).min(1).max(FORWARD_MAX_MESSAGES),
  chatIds: z.array(objectIdSchema).min(1).max(FORWARD_MAX_CHATS),
  comment: messageTextSchema.optional(),
});
export const forwardResponseSchema = z.object({ sent: z.number().int().nonnegative() });

/** PATCH /v1/chats/:id/prefs. Only what is present changes. */
export const chatPrefsBodySchema = z.object({
  pinned: z.boolean().optional(),
  mute: z.enum(['off', '8h', '1w', 'always']).optional(),
  archived: z.boolean().optional(),
  unread: z.boolean().optional(),
});

/** GET /v1/stars?chatId=&cursor=&includeLocked= */
export const starsQuerySchema = z.object({
  chatId: objectIdSchema.optional(),
  cursor: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /**
   * Chats I locked are left out unless this is 'true'. The app asks for them only while its PIN
   * unlock lasts (5 min, this tab), so an app that does not know about it never shows them.
   */
  includeLocked: z.enum(['true', 'false']).optional(),
});
export const starredItemSchema = z.object({
  message: messageSchema,
  starredAt: isoDateTimeSchema,
});
export const starsResponseSchema = z.object({
  items: z.array(starredItemSchema),
  nextCursor: z.string().min(1).nullable(),
  /** This page left out stars in chats I locked (without `includeLocked`). */
  lockedHidden: z.boolean().optional(),
});

export const okResponseSchema = z.object({ ok: z.literal(true) });

export type ChatPrefs = z.infer<typeof chatPrefsBodySchema>;
export type StarredItem = z.infer<typeof starredItemSchema>;
export type StarsResponse = z.infer<typeof starsResponseSchema>;
