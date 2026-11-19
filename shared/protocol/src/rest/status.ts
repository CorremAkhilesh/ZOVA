import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from '../common/id.ts';
import { CAPTION_MAX, mediaInfoSchema } from './media.ts';
import { reactionBodySchema } from './message-actions.ts';
import { publicProfileSchema } from './profile.ts';
import { statusKindSchema, statusStyleSchema } from './status-core.ts';

/** A status disappears this long after it was posted. */
export const STATUS_TTL_HOURS = 24;
/** A video status plays for at most this long. */
export const STATUS_VIDEO_MAX_SECONDS = 60;
/** The words of a text status. */
export const STATUS_TEXT_MAX = 700;
/** Statuses one person can post in any 24 hours. */
export const STATUS_PER_DAY_MAX = 30;
/** People an "except" or "only" list can name. */
export const STATUS_AUDIENCE_MAX = 1000;

/** Who sees my statuses. Each status keeps the setting it was posted with. */
export const statusAudienceModeSchema = z.enum(['all', 'except', 'only']);
export const statusPrivacySchema = z.object({
  mode: statusAudienceModeSchema,
  /** "All colleagues except…" or "Only share with…": these people. Ignored for `all`. */
  userIds: z.array(objectIdSchema).max(STATUS_AUDIENCE_MAX),
});

/** POST /v1/statuses */
export const createStatusBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string().trim().min(1).max(STATUS_TEXT_MAX),
    style: statusStyleSchema,
  }),
  z.object({
    kind: z.enum(['image', 'video']),
    /** A finished upload of mine (POST /v1/uploads …). */
    mediaId: objectIdSchema,
    caption: z.string().trim().max(CAPTION_MAX).optional(),
  }),
]);

export const statusSchema = z.object({
  id: z.string(),
  userId: z.string(),
  kind: statusKindSchema,
  /** The words of a text status, or the caption of a photo or video. */
  text: z.string().nullable(),
  style: statusStyleSchema.nullable(),
  media: mediaInfoSchema.nullable(),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  /** Whether I have seen it. Mine always count as seen. */
  viewed: z.boolean(),
  /** Mine only: how many have seen it (0 while my read receipts are off). */
  viewCount: z.number().int().nonnegative().nullable(),
});

/** One person's statuses, oldest first, as the list and the viewer use them. */
export const statusPersonSchema = z.object({
  user: publicProfileSchema,
  statuses: z.array(statusSchema),
  muted: z.boolean(),
});

/** GET /v1/statuses */
export const statusFeedResponseSchema = z.object({
  /** My own, oldest first. */
  mine: z.array(statusSchema),
  /** Everyone else whose statuses I may see, the latest status first. */
  people: z.array(statusPersonSchema),
});

export const statusParamsSchema = z.object({ id: objectIdSchema });
export const statusResponseSchema = z.object({ status: statusSchema });

/** POST /v1/statuses/:id/view: seen, and optionally a quick reaction. */
export const viewStatusBodySchema = z.object({
  reaction: reactionBodySchema.shape.emoji.nullable().optional(),
});

/** GET /v1/statuses/:id/viewers (mine only) */
export const statusViewersResponseSchema = z.object({
  viewers: z.array(
    z.object({
      user: publicProfileSchema,
      viewedAt: isoDateTimeSchema,
      reaction: z.string().nullable(),
    }),
  ),
  count: z.number().int().nonnegative(),
});

/** PUT /v1/statuses/mutes/:userId and DELETE: mute or unmute a person's statuses. */
export const statusMuteParamsSchema = z.object({ userId: objectIdSchema });

/**
 * GET and PUT /v1/me/status-privacy. Plain strings in the answer: `objectIdSchema` transforms, and a
 * transform cannot be serialized back (that made PUT answer 500).
 */
export const statusPrivacyResponseSchema = z.object({
  privacy: z.object({ mode: statusAudienceModeSchema, userIds: z.array(z.string()) }),
});

/** Socket: my status list changed (someone posted, deleted, or an admin removed one). */
export const statusChangedEventSchema = z.object({});

export type StatusPrivacy = z.infer<typeof statusPrivacySchema>;
export type CreateStatusBody = z.infer<typeof createStatusBodySchema>;
export type Status = z.infer<typeof statusSchema>;
export type StatusPerson = z.infer<typeof statusPersonSchema>;
export type StatusFeedResponse = z.infer<typeof statusFeedResponseSchema>;
export type StatusViewersResponse = z.infer<typeof statusViewersResponseSchema>;
