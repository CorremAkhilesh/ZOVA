import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination.ts';
import { adminReasonSchema } from './security.ts';

export const ANNOUNCEMENT_TITLE_MAX = 80;
export const ANNOUNCEMENT_BODY_MAX = 1000;
/** Most people one announcement can name (more: send it to everyone). */
export const ANNOUNCEMENT_PEOPLE_MAX = 500;
/** A banner can stay up for at most this long. */
export const ANNOUNCEMENT_MAX_DAYS = 90;

export const announcementLevelSchema = z.enum(['info', 'warning']);
export type AnnouncementLevel = z.infer<typeof announcementLevelSchema>;

/** A banner as people see it at the top of the app. */
export const announcementBannerSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  level: announcementLevelSchema,
  endsAt: isoDateTimeSchema.nullable(),
});
export type AnnouncementBanner = z.infer<typeof announcementBannerSchema>;

/** GET /v1/announcements: the banners for me now, not dismissed. */
export const announcementBannersResponseSchema = z.object({
  items: z.array(announcementBannerSchema),
});

/** Admin → Announcements: one announcement and how it went out. */
export const adminAnnouncementSchema = announcementBannerSchema.extend({
  audience: z.enum(['all', 'some']),
  /** People it went to (for `all`, everyone active when it was sent). */
  recipients: z.number().int().nonnegative(),
  banner: z.boolean(),
  /** Also sent as a chat message from the admin. */
  message: z.boolean(),
  createdAt: isoDateTimeSchema,
  createdBy: z.string(),
  /** Ended early by an admin; null while running (or once its end date passed). */
  endedAt: isoDateTimeSchema.nullable(),
  state: z.enum(['active', 'ended']),
});
export type AdminAnnouncement = z.infer<typeof adminAnnouncementSchema>;
export const adminAnnouncementsQuerySchema = cursorPageQuerySchema;
export const adminAnnouncementsResponseSchema = cursorPageSchema(adminAnnouncementSchema);

/**
 * POST /v1/admin/announcements: to everyone or to chosen people, as a banner (until a date, or
 * until ended) and/or as a chat message from the admin. At least one of the two.
 */
export const createAnnouncementBodySchema = z
  .object({
    title: z.string().trim().min(1).max(ANNOUNCEMENT_TITLE_MAX),
    body: z.string().trim().min(1).max(ANNOUNCEMENT_BODY_MAX),
    level: announcementLevelSchema.default('info'),
    audience: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('all') }),
      z.object({
        kind: z.literal('some'),
        userIds: z
          .array(z.string().regex(/^[0-9a-f]{24}$/))
          .min(1)
          .max(ANNOUNCEMENT_PEOPLE_MAX),
      }),
    ]),
    banner: z.boolean(),
    endsAt: isoDateTimeSchema.nullable().default(null),
    message: z.boolean(),
    reason: adminReasonSchema,
  })
  .refine((body) => body.banner || body.message, {
    message: 'Show it as a banner, send it as a message, or both',
    path: ['banner'],
  });
export type CreateAnnouncementBody = z.input<typeof createAnnouncementBodySchema>;
export const adminAnnouncementResponseSchema = z.object({ announcement: adminAnnouncementSchema });
