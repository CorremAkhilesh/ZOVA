import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { AUTH_BASE_PATH, type Auth, createAuth } from '../auth/auth.ts';
import { MemoryCounterStore, RedisCounterStore } from '../auth/counter-store.ts';
import { OtpThrottle } from '../auth/otp-throttle.ts';
import { redisSecondaryStorage } from '../auth/secondary-storage.ts';
import { toWebHeaders } from '../auth/session.ts';
import type { Env } from '../config/env.ts';
import { registerModels } from '../db/models.ts';
import { createEmailQueue } from '../jobs/email-queue.ts';
import { createBullConnection } from '../lib/redis.ts';
import { directDispatcher, type EmailDispatcher, queueDispatcher } from '../mail/dispatcher.ts';

declare module 'fastify' {
  interface FastifyInstance {
    auth: Auth;
    otpThrottle: OtpThrottle;
  }
}

interface AuthPluginOptions {
  env: Env;
  /** Override email delivery (tests). Default: queue with Redis, direct send otherwise. */
  dispatcher?: EmailDispatcher;
}

async function createDispatcher(app: FastifyInstance, env: Env): Promise<EmailDispatcher> {
  if (app.redis instanceof Redis && env.REDIS_URL) {
    const connection = createBullConnection(env.REDIS_URL, 'zuvo-api-queue');
    const queue = createEmailQueue(connection);
    app.addHook('onClose', async () => {
      await queue.close();
      await connection.quit();
    });
    return queueDispatcher(queue);
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('Redis is required in production to queue emails');
  }
  app.log.warn('no Redis: emails are sent directly (development/test only)');
  return directDispatcher(app.mailer, app.log);
}

async function setupAuth(app: FastifyInstance, options: AuthPluginOptions) {
  const { env } = options;
  const redis = app.redis instanceof Redis ? app.redis : null;
  const db = app.mongo.db;
  if (!db) throw new Error('MongoDB is not connected');

  // Index definitions for Better Auth's collections (built here outside production).
  registerModels(app.mongo);

  const throttle = new OtpThrottle(
    redis ? new RedisCounterStore(redis) : new MemoryCounterStore(),
    {
      ipLimitPerHour: env.OTP_IP_LIMIT_PER_HOUR,
    },
  );

  const auth = createAuth({
    db: db as unknown as Parameters<typeof createAuth>[0]['db'],
    client: app.mongo.getClient() as unknown as Parameters<typeof createAuth>[0]['client'],
    secret: env.AUTH_SECRET,
    baseURL: env.API_URL,
    trustedOrigins: [...new Set([env.APP_URL, ...env.CORS_ORIGINS])],
    production: env.NODE_ENV === 'production',
    policy: { allowedDomains: env.ALLOWED_EMAIL_DOMAINS, adminEmails: env.ADMIN_EMAILS },
    throttle,
    dispatcher: options.dispatcher ?? (await createDispatcher(app, env)),
    secondaryStorage: redis ? redisSecondaryStorage(redis) : undefined,
    rateLimitEnabled: env.NODE_ENV !== 'test',
  });

  app.decorate('auth', auth);
  app.decorate('otpThrottle', throttle);
  app.decorateRequest('auth', null);

  // Better Auth's own endpoints (get-session, sign-out, …). Our typed routes under the same
  // prefix are more specific and take precedence.
  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    async handler(request, reply) {
      const url = new URL(request.url, env.API_URL);
      const hasBody = request.method !== 'GET' && request.body !== undefined;
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: toWebHeaders(request),
          ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') reply.header(name, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}

export const authPlugin = fp(setupAuth, {
  name: 'auth',
  fastify: '5.x',
  dependencies: ['mongo', 'redis', 'services'],
});
