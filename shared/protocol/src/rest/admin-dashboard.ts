import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';
import { checkStatusSchema, healthResponseSchema } from './health.ts';

/**
 * GET /v1/admin/dashboard: the admin panel's home. Counts, sizes and dates only: never the text of
 * a message, a file's content or its name.
 */
const count = z.number().int().nonnegative();
const bytes = z.number().nonnegative();

/** One day of the 30-day series, in the organization's time zone (Asia/Kolkata). */
export const adminDayStatSchema = z.object({
  /** YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  activeUsers: count,
  messages: count,
  calls: count,
});
export type AdminDayStat = z.infer<typeof adminDayStatSchema>;

export const adminStorageUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  usedBytes: bytes,
  quotaBytes: bytes,
});
export type AdminStorageUser = z.infer<typeof adminStorageUserSchema>;

export const adminDashboardSchema = z.object({
  generatedAt: isoDateTimeSchema,
  users: z.object({
    total: count,
    active: count,
    deactivated: count,
    admins: count,
    activeToday: count,
    active7d: count,
  }),
  today: z.object({ messages: count, calls: count }),
  notifications: z.object({
    /** Active people with push on for at least one device. */
    usersWithPush: count,
    /** 0–100, of active people. */
    percent: z.number().min(0).max(100),
  }),
  /** Oldest first, ending today: 30 entries. */
  series: z.array(adminDayStatSchema),
  storage: z.object({
    /** The disk that holds the media folder; null when it cannot be read. */
    disk: z
      .object({
        totalBytes: bytes,
        usedBytes: bytes,
        percent: z.number().min(0).max(100),
        /** New uploads stop above this (env STORAGE_GUARD_PERCENT). */
        guardPercent: z.number().int(),
      })
      .nullable(),
    /** Finished files of every person together. */
    filesBytes: bytes,
    /** Most storage first, at most 10. */
    topUsers: z.array(adminStorageUserSchema),
  }),
  health: z.object({
    mongodb: checkStatusSchema,
    redis: checkStatusSchema,
    storage: checkStatusSchema,
    /** Emails waiting and failed in the queue; null without Redis. */
    emailQueue: z.object({ status: checkStatusSchema, waiting: count, failed: count }).nullable(),
  }),
  build: healthResponseSchema.pick({ version: true, commit: true, builtAt: true }),
  /** When the last nightly backup finished; null until the server reports it. */
  lastBackupAt: isoDateTimeSchema.nullable(),
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;
