import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { AppError } from '../lib/errors.ts';

/** Global per-IP limit. Routes can tighten it with `config: { rateLimit: { … } }`. */
async function setupRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    nameSpace: 'zuvo:rate-limit:',
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
