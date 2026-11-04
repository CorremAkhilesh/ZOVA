import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { AUTH_BASE_PATH, type Auth, createAuth, type NewLogin } from '../auth/auth.ts';
import { type CounterStore, MemoryCounterStore, RedisCounterStore } from '../auth/counter-store.ts';
import { OtpThrottle } from '../auth/otp-throttle.ts';
import { redisSecondaryStorage } from '../auth/secondary-storage.ts';
import { toWebHeaders } from '../auth/session.ts';
import type { Env } from '../config/env.ts';
import { registerModels } from '../db/models.ts';
import { createEmailQueue } from '../jobs/email-queue.ts';
import { createBullConnection } from '../lib/redis.ts';
import { directDispatcher, type EmailDispatcher, queueDispatcher } from '../mail/dispatcher.ts';
import { loginAlertEmail } from '../mail/templates/login-alert-email.tsx';
import { describeDevice } from '../security/devices.ts';
import { createRevokeToken } from '../security/security-tokens.ts';

declare module 'fastify' {
  interface FastifyInstance {
    auth: Auth;
    otpThrottle: OtpThrottle;
    /** Expiring counters/locks (Redis when available). */
    counterStore: CounterStore;
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

/** New-login alert: queued email with a single-use "This wasn't me" link. Never fails a sign-in. */
function newLoginAlert(app: FastifyInstance, env: Env, dispatcher: EmailDispatcher) {
  return async (login: NewLogin) => {
    try {
      const token = await createRevokeToken(app, login.userId);
      // The token travels in the fragment: never sent to servers, proxies or Referer headers.
      const notMeUrl = `${env.APP_URL}/security/not-me#token=${token}`;
      const message = await loginAlertEmail(login.email, {
        device: describeDevice(login.userAgent),
        signedInAt: login.signedInAt,
        notMeUrl,
      });
      await dispatcher.dispatch(message, 'login-alert');
    } catch (error) {
      app.log.error({ err: error, userId: login.userId }, 'new-login alert failed');
    }
  };
}

async function setupAuth(app: FastifyInstance, options: AuthPluginOptions) {
  const { env } = options;
  const redis = app.redis instanceof Redis ? app.redis : null;
  const db = app.mongo.db;
  if (!db) throw new Error('MongoDB is not connected');

  // Index definitions for Better Auth's collections (built here outside production).
  registerModels(app.mongo);

  const counterStore: CounterStore = redis
    ? new RedisCounterStore(redis)
    : new MemoryCounterStore();
  const throttle = new OtpThrottle(counterStore, {
    ipLimitPerHour: env.OTP_IP_LIMIT_PER_HOUR,
  });

  const dispatcher = options.dispatcher ?? (await createDispatcher(app, env));
  const auth = createAuth({
    db: db as unknown as Parameters<typeof createAuth>[0]['db'],
    client: app.mongo.getClient() as unknown as Parameters<typeof createAuth>[0]['client'],
    secret: env.AUTH_SECRET,
    baseURL: env.API_URL,
    trustedOrigins: [...new Set([env.APP_URL, ...env.CORS_ORIGINS])],
    production: env.NODE_ENV === 'production',
    policy: { allowedDomains: env.ALLOWED_EMAIL_DOMAINS, adminEmails: env.ADMIN_EMAILS },
    throttle,
    dispatcher,
    onNewLogin: newLoginAlert(app, env, dispatcher),
    secondaryStorage: redis ? redisSecondaryStorage(redis) : undefined,
    rateLimitEnabled: env.NODE_ENV !== 'test',
  });

  app.decorate('auth', auth);
  app.decorate('otpThrottle', throttle);
  app.decorate('counterStore', counterStore);
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
