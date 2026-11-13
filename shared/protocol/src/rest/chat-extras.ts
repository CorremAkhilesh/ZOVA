import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from '../common/id.ts';

/** How many people one message may mention, and how many pins a chat may have. */
export const MENTIONS_MAX = 50;
export const PINNED_MESSAGES_MAX = 3;
/** How many unread mentions a chat remembers per person (the oldest drop off). */
export const MENTION_SEQS_MAX = 50;

/**
 * Someone mentioned in a message: `text.slice(offset, offset + length)` is the "@Name" shown.
 * Offsets count UTF-16 code units, as JavaScript strings do.
 */
export const mentionSchema = z.object({
  userId: z.string(),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
});
/** As sent: the id must be a real id. */
export const mentionInputSchema = mentionSchema.extend({ userId: objectIdSchema });
export const mentionsInputSchema = z.array(mentionInputSchema).max(MENTIONS_MAX);

export const pinDurationSchema = z.enum(['24h', '7d', '30d']);
export const PIN_DURATION_MS: Record<z.infer<typeof pinDurationSchema>, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/** A message pinned for everyone in the chat, until `expiresAt`. */
export const pinnedMessageSchema = z.object({
  messageId: z.string(),
  seq: z.number().int().positive(),
  pinnedBy: z.string().nullable(),
  pinnedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
});

/** PUT /v1/chats/:id/messages/:messageId/pin */
export const pinMessageBodySchema = z.object({ duration: pinDurationSchema });
/** PUT and DELETE …/pin: the chat's pins now, newest first. */
export const pinsResponseSchema = z.object({ pins: z.array(pinnedMessageSchema) });

export type Mention = z.infer<typeof mentionSchema>;
export type PinDuration = z.infer<typeof pinDurationSchema>;
export type PinnedMessage = z.infer<typeof pinnedMessageSchema>;
