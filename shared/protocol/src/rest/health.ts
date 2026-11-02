import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';

/** GET /health — liveness: the process is up. Never checks dependencies. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  /** Process uptime in seconds. */
  uptime: z.number().nonnegative(),
  timestamp: isoDateTimeSchema,
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const dependencyStatusSchema = z.enum(['up', 'down']);

export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

/** GET /ready — readiness: all dependencies are reachable. Returns 503 when not ready. */
export const readyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    mongodb: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
  timestamp: isoDateTimeSchema,
});

export type ReadyResponse = z.infer<typeof readyResponseSchema>;
