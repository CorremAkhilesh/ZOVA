import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination.ts';
import { usernameSchema } from '../common/username.ts';
import { appLanguageSchema, displayNameSchema, userRoleSchema, userStatusSchema } from './auth.ts';
import { disappearTimerSchema } from './disappearing.ts';

export const ABOUT_MAX = 140;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;

export const aboutSchema = z.string().trim().max(ABOUT_MAX, `Use at most ${ABOUT_MAX} characters`);

/** Two avatar sizes, served by the API to signed-in users only. */
export const avatarSchema = z.object({ small: z.string(), large: z.string() }).nullable();

export const visibilitySchema = z.enum(['everyone', 'nobody']);
export const privacySettingsSchema = z.object({
  lastSeen: visibilitySchema,
  profilePhoto: visibilitySchema,
  about: visibilitySchema,
  readReceipts: z.boolean(),
  /** The disappearing timer of chats I start. Older copies have none: off. */
  defaultDisappearing: disappearTimerSchema.default('off'),
});
export const DEFAULT_PRIVACY: z.infer<typeof privacySettingsSchema> = {
  lastSeen: 'everyone',
  profilePhoto: 'everyone',
  about: 'everyone',
  readReceipts: true,
  defaultDisappearing: 'off',
};

/** PATCH /v1/me/profile — at least one field. */
export const updateProfileBodySchema = z
  .object({
    displayName: displayNameSchema.optional(),
    about: aboutSchema.optional(),
    language: appLanguageSchema.optional(),
  })
  .refine(
    (body) =>
      body.displayName !== undefined || body.about !== undefined || body.language !== undefined,
    'Nothing to update',
  );

/** PUT /v1/me/username */
export const setUsernameBodySchema = z.object({ username: usernameSchema });

/** GET /v1/users/username-availability?username= */
export const usernameAvailabilityQuerySchema = z.object({ username: z.string().max(64) });
export const usernameAvailabilityResponseSchema = z.object({
  username: z.string(),
  available: z.boolean(),
  reason: z.enum(['taken', 'reserved', 'invalid', 'too_short', 'too_long']).nullable(),
});

/** GET /v1/me/username-suggestion */
export const usernameSuggestionResponseSchema = z.object({ username: z.string() });

/** GET/PUT /v1/me/privacy */
export const privacyResponseSchema = z.object({ privacy: privacySettingsSchema });

/** What other signed-in users may see (privacy already applied). */
export const publicProfileSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  username: z.string().nullable(),
  about: z.string().nullable(),
  avatar: avatarSchema,
  deactivated: z.boolean(),
});

/** GET /v1/users/search?q=&cursor=&limit= (q empty → suggested people). */
export const userSearchQuerySchema = cursorPageQuerySchema.extend({
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});
export const userSearchResponseSchema = cursorPageSchema(publicProfileSchema);

/** GET /v1/users/:id */
export const userParamsSchema = z.object({ id: z.string().min(1).max(64) });
export const publicProfileResponseSchema = z.object({ user: publicProfileSchema });

/** Full own profile, returned after profile changes. */
export const myProfileSchema = z.object({
  id: z.string(),
  email: z.email(),
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  usernameChangedAt: isoDateTimeSchema.nullable(),
  about: z.string(),
  avatar: avatarSchema,
  role: userRoleSchema,
  status: userStatusSchema,
  language: appLanguageSchema,
});
export const myProfileResponseSchema = z.object({ profile: myProfileSchema });

export type PrivacySettings = z.infer<typeof privacySettingsSchema>;
export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type MyProfile = z.infer<typeof myProfileSchema>;
export type UsernameAvailability = z.infer<typeof usernameAvailabilityResponseSchema>;
export type UserSearchResponse = z.infer<typeof userSearchResponseSchema>;
