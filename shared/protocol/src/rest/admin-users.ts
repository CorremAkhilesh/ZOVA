import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';
import { adminPushDeviceSchema } from './admin-notifications.ts';
import { storageUsageSchema } from './media.ts';
import { adminReasonSchema, adminStorageQuotaBodySchema, adminUserRowSchema } from './security.ts';

/**
 * Admin → Users → one person: who they are, their devices and their storage. Metadata only: no
 * message, file name or file content.
 */
export const adminUserDetailSchema = z.object({
  user: adminUserRowSchema,
  storage: storageUsageSchema.extend({ custom: z.boolean() }),
  devices: z.array(adminPushDeviceSchema),
});
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;

/** POST /v1/admin/users/:id/sign-out: every device of that person, now. */
export const adminSignOutResponseSchema = z.object({
  revokedSessions: z.number().int().nonnegative(),
});

/** Most people one bulk action may touch. */
export const ADMIN_BULK_MAX = 100;

/** POST /v1/admin/users/:id/suspend: until when (5 minutes to a year from now), and why. */
export const adminSuspendBodySchema = z.object({
  until: isoDateTimeSchema,
  reason: adminReasonSchema,
});
export const adminSuspendResponseSchema = z.object({
  suspendedUntil: isoDateTimeSchema.nullable(),
});

export const adminBulkActionSchema = z.enum([
  'deactivate',
  'reactivate',
  'signOut',
  'storageQuota',
  'suspend',
  'unsuspend',
]);
export type AdminBulkAction = z.infer<typeof adminBulkActionSchema>;

/** POST /v1/admin/users/bulk. `quotaMb` with `storageQuota` (null: the default), `until` with `suspend`. */
export const adminBulkBodySchema = z
  .object({
    userIds: z
      .array(z.string().regex(/^[0-9a-f]{24}$/))
      .min(1)
      .max(ADMIN_BULK_MAX)
      .refine((ids) => new Set(ids).size === ids.length, 'Each person once'),
    action: adminBulkActionSchema,
    quotaMb: adminStorageQuotaBodySchema.shape.quotaMb.optional(),
    until: isoDateTimeSchema.optional(),
    reason: adminReasonSchema,
  })
  .refine((body) => body.action !== 'storageQuota' || body.quotaMb !== undefined, {
    message: 'Choose a storage limit',
    path: ['quotaMb'],
  })
  .refine((body) => body.action !== 'suspend' || body.until !== undefined, {
    message: 'Choose until when',
    path: ['until'],
  });
export type AdminBulkBody = z.infer<typeof adminBulkBodySchema>;

/** One result per person, in the order asked. A refusal names why (e.g. LAST_ADMIN, CONFLICT). */
export const adminBulkResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      ok: z.boolean(),
      code: z.string().nullable(),
    }),
  ),
});
export type AdminBulkResponse = z.infer<typeof adminBulkResponseSchema>;
