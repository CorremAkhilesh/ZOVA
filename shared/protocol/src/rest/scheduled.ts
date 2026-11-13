import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from '../common/id.ts';
import { mentionsInputSchema } from './chat-extras.ts';
import { CAPTION_MAX, mediaInfoSchema } from './media.ts';

/** Per person, across all chats, while waiting. */
export const SCHEDULED_MAX = 50;
/** How far ahead a message can be scheduled. */
export const SCHEDULE_AHEAD_MAX_DAYS = 365;
/** A time this close (or already past) means "send now". */
export const SCHEDULE_MIN_LEAD_SECONDS = 10;

export const scheduledStatusSchema = z.enum(['pending', 'sending', 'sent', 'failed']);
/** Why a scheduled message could not go: the same rules as sending by hand. */
export const scheduledFailureSchema = z.enum([
  'not_member',
  'blocked',
  'admins_only',
  'account_deactivated',
  'media_unavailable',
  'other',
]);

export const scheduledMessageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  /** The text, or the caption on media. */
  text: z.string().nullable(),
  media: mediaInfoSchema.nullable(),
  sendAt: isoDateTimeSchema,
  status: scheduledStatusSchema,
  failure: scheduledFailureSchema.nullable(),
  /** Once sent: the message it became. */
  messageId: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

const scheduledTextSchema = z.string().max(4096);

/** POST /v1/me/scheduled: text, or a finished upload with an optional caption. */
export const createScheduledBodySchema = z
  .object({
    chatId: objectIdSchema,
    text: scheduledTextSchema.optional(),
    mediaId: objectIdSchema.optional(),
    sendAt: isoDateTimeSchema,
    mentions: mentionsInputSchema.optional(),
    mentionsEveryone: z.boolean().optional(),
  })
  .refine((body) => body.mediaId !== undefined || (body.text ?? '').trim().length > 0, {
    message: 'Schedule some text or a file',
  })
  .refine((body) => body.mediaId === undefined || (body.text ?? '').length <= CAPTION_MAX, {
    message: 'Caption is too long',
    path: ['text'],
  });

/** PATCH /v1/me/scheduled/:id: while it is still waiting. */
export const updateScheduledBodySchema = z
  .object({ text: scheduledTextSchema.optional(), sendAt: isoDateTimeSchema.optional() })
  .refine((body) => body.text !== undefined || body.sendAt !== undefined, 'Nothing to change');

export const scheduledParamsSchema = z.object({ id: objectIdSchema });
/** GET /v1/me/scheduled?chatId=: mine, waiting or failed, soonest first. */
export const scheduledListQuerySchema = z.object({ chatId: objectIdSchema.optional() });
export const scheduledListResponseSchema = z.object({ items: z.array(scheduledMessageSchema) });
export const scheduledResponseSchema = z.object({ item: scheduledMessageSchema });

/**
 * scheduled:updated (server → my devices): my scheduled messages changed; fetch them again. `failed`
 * says one could not be sent, so the app can tell me.
 */
export const scheduledUpdatedEventSchema = z.object({
  chatId: z.string(),
  failed: z.object({ id: z.string(), reason: scheduledFailureSchema }).nullable(),
});

export type ScheduledMessage = z.infer<typeof scheduledMessageSchema>;
export type ScheduledFailure = z.infer<typeof scheduledFailureSchema>;
export type CreateScheduledBody = z.infer<typeof createScheduledBodySchema>;
