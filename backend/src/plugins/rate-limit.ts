import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { AppError } from '../lib/errors.ts';

export interface RateLimitOptions {
  /** Requests per window per IP. Default 300. */
  max?: number;
  /** Default '1 minute'. */
  timeWindow?: string;
  /** Redis key prefix. Default 'zuvo:rate-limit:'. */
  nameSpace?: string;
}

/** Global per-IP limit. Routes can tighten it with `config: { rateLimit: { … } }`. */
async function setupRateLimit(app: FastifyInstance, options: RateLimitOptions) {
  await app.register(rateLimit, {
    global: true,
    max: options.max ?? 300,
    timeWindow: options.timeWindow ?? '1 minute',
    nameSpace: options.nameSpace ?? 'zuvo:rate-limit:',
    // Shared across instances with a real Redis client; in-memory otherwise (development, tests).
    ...(app.redis instanceof Redis ? { redis: app.redis } : {}),
    // If Redis is briefly unavailable, let requests through rather than failing them all.
    skipOnError: true,
    // Container health probes.
    allowList: ['127.0.0.1', '::1'],
    errorResponseBuilder: (_request, context) =>
      new AppError('RATE_LIMITED', `Too many requests. Try again in ${context.after}.`),
  });
}

export const rateLimitPlugin = fp(setupRateLimit, {
  name: 'rate-limit',
  fastify: '5.x',
  dependencies: ['redis'],
});
