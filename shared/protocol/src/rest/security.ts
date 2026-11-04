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
  /** Partially hidden, e.g. 103.201.140.••• */
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
export const adminUsersQuerySchema = cursorPageQuerySchema.extend({
  q: z.string().trim().max(100).default(''),
});
export const adminUsersResponseSchema = cursorPageSchema(adminUserSchema);
export const adminRoleBodySchema = z.object({ role: userRoleSchema });
export const adminUserResponseSchema = z.object({ user: adminUserSchema });

/** Admin → Audit log */
export const auditActionSchema = z.enum([
  'user.deactivate',
  'user.reactivate',
  'user.promote',
  'user.demote',
]);
export const auditLogEntrySchema = z.object({
  id: z.string(),
  action: auditActionSchema,
  actor: z.object({ id: z.string(), email: z.string() }),
  target: z.object({ id: z.string(), email: z.string() }),
  ipAddress: z.string().nullable(),
  at: isoDateTimeSchema,
});
export const auditLogResponseSchema = cursorPageSchema(auditLogEntrySchema);

export type DeviceSession = z.infer<typeof deviceSessionSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export type AuditAction = z.infer<typeof auditActionSchema>;
