import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination.ts';
import { pushPermissionSchema } from './push.ts';

/**
 * Settings → Admin → Notifications: who will get notified, on which devices. A device is a signed-in
 * session; push is on there when it has a push subscription.
 */
export const devicePlatformSchema = z.enum([
  'android',
  'iphone',
  'windows',
  'mac',
  'linux',
  'other',
]);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

export const adminPushDeviceSchema = z.object({
  id: z.string(),
  /** "Chrome on Windows". */
  label: z.string(),
  platform: devicePlatformSchema,
  /** The installed app, a browser tab, or not reported yet (an older version of the app). */
  installed: z.boolean().nullable(),
  /** The browser's notification permission, if reported. */
  permission: pushPermissionSchema.nullable(),
  /** A push subscription exists for this device. */
  pushOn: z.boolean(),
  lastActiveAt: isoDateTimeSchema,
});
export type AdminPushDevice = z.infer<typeof adminPushDeviceSchema>;

export const adminPushUserSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string().nullable(),
    username: z.string().nullable(),
  }),
  devices: z.array(adminPushDeviceSchema),
  /** At least one device gets pushes. */
  pushOn: z.boolean(),
  /** The person's last seen (app closed), or their newest device activity. */
  lastSeenAt: isoDateTimeSchema.nullable(),
});
export type AdminPushUser = z.infer<typeof adminPushUserSchema>;

/** GET /v1/admin/notifications: active users, oldest account first (cursor on the user id). */
export const adminPushQuerySchema = cursorPageQuerySchema;
export const adminPushResponseSchema = cursorPageSchema(adminPushUserSchema);
export type AdminPushPage = z.infer<typeof adminPushResponseSchema>;

/** POST /v1/admin/notifications/remind: a 1:1 message from the admin with the steps. */
export const REMIND_USERS_MAX = 100;
export const remindBodySchema = z.object({
  userIds: z
    .array(z.string().regex(/^[0-9a-f]{24}$/i))
    .min(1)
    .max(REMIND_USERS_MAX),
});
export const remindResponseSchema = z.object({ sent: z.number().int().nonnegative() });
