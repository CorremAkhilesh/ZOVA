import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';
import { cursorPageQuerySchema } from '../common/pagination.ts';
import { auditActionSchema } from './security.ts';

/** Admin → Security: who is signed in, emails locked for the day, and recent wrong codes. */
export const adminSecurityResponseSchema = z.object({
  sessions: z.object({
    /** Signed-in devices right now. */
    active: z.number().int().nonnegative(),
    /** Different people signed in on at least one device. */
    people: z.number().int().nonnegative(),
  }),
  locks: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      /** Masked: "203.0.113.*". */
      ip: z.string(),
      lockedAt: isoDateTimeSchema,
      until: isoDateTimeSchema,
    }),
  ),
  failures: z.array(z.object({ email: z.string(), ip: z.string(), at: isoDateTimeSchema })),
});
export type AdminSecurity = z.infer<typeof adminSecurityResponseSchema>;
export const adminUnlockResponseSchema = z.object({ unlocked: z.literal(true) });

/** Admin → Audit log filters (all optional), also for the CSV. */
export const auditFilterSchema = z.object({
  action: auditActionSchema.optional(),
  /** The admin who did it, by email (exact, any case). */
  actor: z.string().trim().toLowerCase().max(254).optional(),
  /** The person it was done to, by email (exact, any case). */
  target: z.string().trim().toLowerCase().max(254).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export const auditLogQuerySchema = cursorPageQuerySchema.extend(auditFilterSchema.shape);
export type AuditFilter = z.infer<typeof auditFilterSchema>;
