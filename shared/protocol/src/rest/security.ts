import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination.ts';
import { userRoleSchema, userStatusSchema } from './auth.ts';

/** A signed-in device, as shown in Settings → Devices. */
export const deviceSessionSchema = z.object({
  id: z.string(),
  /** The user's own label for this device, e.g. "Work laptop". */
  name: z.string().nullable(),
  current: z.boolean(),
  browser: z.string(),
  os: z.string(),
  deviceType: z.enum(['desktop', 'mobile', 'tablet', 'unknown']),
  /** Partially hidden, e.g. 203.0.113.••• */
  ipAddress: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  lastActiveAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
});

/** GET /v1/me/sessions */
export const deviceSessionsResponseSchema = z.object({ sessions: z.array(deviceSessionSchema) });
/** DELETE /v1/me/sessions/:id · POST /v1/me/sessions/revoke-others */
export const sessionParamsSchema = z.object({ id: z.string().min(1).max(64) });
/** PATCH /v1/me/sessions/:id: null or blank clears the name. */
export const SESSION_NAME_MAX = 30;
export const renameSessionBodySchema = z.object({
  name: z
    .string()
    .trim()
    .max(SESSION_NAME_MAX)
    .nullable()
    .transform((name) => name || null),
});
export const renameSessionResponseSchema = z.object({ name: z.string().nullable() });
export const revokedSessionsResponseSchema = z.object({ revoked: z.number().int().nonnegative() });

/** POST /v1/auth/not-me — the "This wasn't me" link from the new-login email. */
export const notMeBodySchema = z.object({ token: z.string().min(20).max(200) });
export const notMeResponseSchema = z.object({
  status: z.literal('revoked'),
  revokedSessions: z.number().int().nonnegative(),
});

/** Admin → Users */
export const adminUserSchema = z.object({
  id: z.string(),
  email: z.email(),
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  lastLoginAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
/** Why an admin did something: required on every admin change, kept in the audit log. */
export const adminReasonSchema = z.string().trim().min(3).max(500);
export const adminReasonBodySchema = z.object({ reason: adminReasonSchema });

/** Admin → Users filters. `pushOff`: no device with notifications; `storageHigh`: 80%+ of the limit. */
export const adminUserFilterSchema = z.enum([
  'all',
  'active',
  'deactivated',
  'admins',
  'suspended',
  'pushOff',
  'storageHigh',
]);
export const adminUserSortSchema = z.enum(['newest', 'oldest', 'name', 'lastActive', 'storage']);
export const adminUsersQuerySchema = cursorPageQuerySchema.extend({
  q: z.string().trim().max(100).default(''),
  filter: adminUserFilterSchema.default('all'),
  sort: adminUserSortSchema.default('newest'),
});
/** Admin → Users → CSV: the same people as the list, every page. */
export const adminUsersExportQuerySchema = adminUsersQuerySchema.omit({
  limit: true,
  cursor: true,
});
/** A row of Admin → Users. `storageBytes`: the person's finished files; `quotaBytes`: their limit. */
export const adminUserRowSchema = adminUserSchema.extend({
  storageBytes: z.number().int().nonnegative(),
  quotaBytes: z.number().int().positive(),
  /** A limit of their own rather than the default. */
  quotaCustom: z.boolean(),
  /** Newest activity on any device; null if never seen. */
  lastActiveAt: isoDateTimeSchema.nullable(),
  /** Signed-in devices, and whether any has notifications on. */
  deviceCount: z.number().int().nonnegative(),
  pushOn: z.boolean(),
  /** A suspension still running: until when, and the admin's reason. Null otherwise. */
  suspendedUntil: isoDateTimeSchema.nullable(),
  suspendReason: z.string().nullable(),
});
/** PUT /v1/admin/users/:id/storage-quota. `null` puts the default limit back. 100 MB to 1 TB. */
export const adminStorageQuotaBodySchema = z.object({
  quotaMb: z.number().int().min(100).max(1_048_576).nullable(),
  reason: adminReasonSchema,
});
export const adminStorageQuotaResponseSchema = z.object({
  quotaBytes: z.number().int().positive(),
  /** True when this person has a limit of their own rather than the default. */
  custom: z.boolean(),
});
export const adminUsersResponseSchema = cursorPageSchema(adminUserRowSchema);
export const adminRoleBodySchema = z.object({ role: userRoleSchema, reason: adminReasonSchema });
export const adminUserResponseSchema = z.object({ user: adminUserSchema });

/** Admin → Audit log */
export const auditActionSchema = z.enum([
  'user.deactivate',
  'user.reactivate',
  'user.promote',
  'user.demote',
  /** An admin opened a report's evidence. Target: the person reported (or the reporter, for a group). */
  'report.view',
  'report.resolve',
  /** An admin removed a reported status. Target: its owner. */
  'status.remove',
  /** An admin sent the "turn on notifications" reminder. Target: the person reminded. */
  'notifications.remind',
  /** An admin changed someone's storage limit. Target: that person. */
  'storage.quota',
  /** An admin signed someone out of every device. Target: that person. */
  'user.signout',
  /** An admin downloaded the list of people as CSV. Target: the admin. */
  'users.export',
  /** An admin suspended someone until a date (details.until), or ended it early. */
  'user.suspend',
  'user.unsuspend',
  /** An admin changed an organization setting. Target: the admin; details: setting, from, to. */
  'settings.change',
  /** An admin made an announcement, or ended its banner early. Target: the admin. */
  'announcement.create',
  'announcement.end',
  /** An admin archived, restored or deleted a group. Target: the admin; details: group, members. */
  'group.archive',
  'group.restore',
  'group.delete',
  /** An admin ended an email's sign-in lock early. Target: the admin; details: email. */
  'security.unlock',
  /** An admin downloaded the audit log as CSV. Target: the admin. */
  'audit.export',
]);
export const auditLogEntrySchema = z.object({
  id: z.string(),
  action: auditActionSchema,
  actor: z.object({ id: z.string(), email: z.string() }),
  target: z.object({ id: z.string(), email: z.string() }),
  ipAddress: z.string().nullable(),
  at: isoDateTimeSchema,
  /** Why, in the admin's words; null for actions from before reasons were asked. */
  reason: z.string().nullable(),
  /** What changed, e.g. a storage limit from → to (MiB). */
  details: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullable(),
});
export const auditLogResponseSchema = cursorPageSchema(auditLogEntrySchema);

export type DeviceSession = z.infer<typeof deviceSessionSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUserRow = z.infer<typeof adminUserRowSchema>;
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export type AuditAction = z.infer<typeof auditActionSchema>;
