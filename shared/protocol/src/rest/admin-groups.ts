import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination.ts';
import { adminReasonSchema } from './security.ts';

/**
 * Admin → Groups: every group's name, size, admins, age, activity and storage. Never a message or
 * a file: an admin moderates groups without reading them.
 */
export const adminGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number().int().nonnegative(),
  /** Admins and the owner. */
  adminCount: z.number().int().nonnegative(),
  owner: z.object({ id: z.string(), email: z.string(), name: z.string() }).nullable(),
  createdAt: isoDateTimeSchema,
  lastActivityAt: isoDateTimeSchema.nullable(),
  storageBytes: z.number().nonnegative(),
  archived: z.boolean(),
});
export type AdminGroup = z.infer<typeof adminGroupSchema>;

export const adminGroupsQuerySchema = cursorPageQuerySchema.extend({
  q: z.string().trim().max(100).default(''),
  filter: z.enum(['all', 'archived']).default('all'),
});
export const adminGroupsResponseSchema = cursorPageSchema(adminGroupSchema);
export const adminGroupResponseSchema = z.object({ group: adminGroupSchema });

/** POST /v1/admin/groups/:id/delete: the group's name typed again, so it is never a slip. */
export const adminDeleteGroupBodySchema = z.object({
  confirmName: z.string().trim().min(1).max(100),
  reason: adminReasonSchema,
});
export const adminDeleteGroupResponseSchema = z.object({
  deleted: z.literal(true),
  members: z.number().int().nonnegative(),
});
