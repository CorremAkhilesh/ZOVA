import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';

/** GET /v1/health — liveness: the process is up. Never checks dependencies. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  /** Process uptime in seconds. */
  uptime: z.number().nonnegative(),
  timestamp: isoDateTimeSchema,
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** `skipped` means the dependency is not configured (allowed in development only). */
export const checkStatusSchema = z.enum(['ok', 'error', 'skipped']);

export type CheckStatus = z.infer<typeof checkStatusSchema>;

/** GET /v1/ready — readiness: all dependencies are reachable. Returns 503 when not ready. */
export const readyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    mongodb: checkStatusSchema,
    redis: checkStatusSchema,
    storage: checkStatusSchema,
  }),
  timestamp: isoDateTimeSchema,
});

export type ReadyResponse = z.infer<typeof readyResponseSchema>;
