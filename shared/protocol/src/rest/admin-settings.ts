import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';
import { GROUP_MEMBERS_MAX } from './groups.ts';
import { adminReasonSchema } from './security.ts';

/**
 * Admin → Settings: what the organization can change without code. Each has a default from the
 * server's env; a value saved here overrides it until it is put back to the default.
 */
export const appSettingsSchema = z.object({
  /** Everyone's storage limit unless an admin gave them their own, in MiB (100 MB to 1 TB). */
  mediaUserQuotaMb: z.number().int().min(100).max(1_048_576),
  /** The largest file one person can send, in MiB (1 MB to 100 GB). */
  mediaMaxFileMb: z.number().int().min(1).max(102_400),
  /** New uploads stop when they would take the media disk above this share, in percent. */
  storageGuardPercent: z.number().int().min(50).max(99),
  /** Who can make and receive calls. */
  calls: z.enum(['all', 'admins', 'off']),
  /** Status updates (Updates tab) for everyone, or switched off. */
  status: z.boolean(),
  /** The most people one group can have. */
  groupMaxMembers: z.number().int().min(2).max(GROUP_MEMBERS_MAX),
  /** Previews of links in messages. */
  linkPreviews: z.boolean(),
  /** Whether people can reply in a chat started by a hidden admin. */
  adminChatUserCanReply: z.boolean(),
  /** Sign-in codes one network address may ask for in an hour. */
  otpIpLimitPerHour: z.number().int().min(5).max(10_000),
  /** Wrong codes for one email in a day before it is locked until the next day. */
  otpFailuresPerEmailPerDay: z.number().int().min(5).max(100),
  /** Files older than this many days are deleted every hour; null: never (the default). */
  autoCleanupDays: z.number().int().min(30).max(3650).nullable(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type AppSettingKey = keyof AppSettings;
export const APP_SETTING_KEYS = Object.keys(appSettingsSchema.shape) as AppSettingKey[];

/** GET /v1/admin/settings */
export const adminSettingsResponseSchema = z.object({
  /** What applies now. */
  values: appSettingsSchema,
  /** What applies when nothing is saved (the server's env). */
  defaults: appSettingsSchema,
  /** Settings with a saved value. */
  overridden: z.array(z.enum(APP_SETTING_KEYS as [AppSettingKey, ...AppSettingKey[]])),
  updatedAt: isoDateTimeSchema.nullable(),
  updatedBy: z.string().nullable(),
});
export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>;

/**
 * PUT /v1/admin/settings: only the settings that change. `null` for a setting puts its default
 * back (for autoCleanupDays, use `{ autoCleanupDays: null, reset: ['autoCleanupDays'] }`).
 */
export const adminSettingsBodySchema = z
  .object({
    changes: appSettingsSchema.partial(),
    /** Settings to put back to their default. */
    reset: z.array(z.enum(APP_SETTING_KEYS as [AppSettingKey, ...AppSettingKey[]])).default([]),
    reason: adminReasonSchema,
  })
  .refine((body) => Object.keys(body.changes).length + body.reset.length > 0, {
    message: 'Change at least one setting',
    path: ['changes'],
  });
export type AdminSettingsBody = z.input<typeof adminSettingsBodySchema>;
