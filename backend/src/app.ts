import { randomUUID } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import type { Env } from './config/env.ts';
import { loggerOptions } from './lib/logger.ts';
import type { EmailDispatcher } from './mail/dispatcher.ts';
import { createMailer, type Mailer } from './mail/mailer.ts';
import { createMemoryMailer, isMemoryMailer } from './mail/memory-mailer.ts';
import { adminRoutes } from './modules/admin/admin.routes.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { profileRoutes } from './modules/auth/profile.routes.ts';
import { healthRoutes } from './modules/health/health.routes.ts';
import { outboxRoutes } from './modules/test-support/outbox.routes.ts';
import { authPlugin } from './plugins/auth.ts';
import { docsPlugin } from './plugins/docs.ts';
import { errorHandlerPlugin } from './plugins/error-handler.ts';
import { mongoPlugin } from './plugins/mongo.ts';
import { rateLimitPlugin } from './plugins/rate-limit.ts';
import { redisPlugin } from './plugins/redis.ts';
import { securityPlugin } from './plugins/security.ts';
import { servicesPlugin } from './plugins/services.ts';
import type { StorageDriver } from './storage/driver.ts';
import { LocalDiskDriver } from './storage/local-disk-driver.ts';

/** Replaceable dependencies, mainly for tests. Anything omitted is created from env. */
export interface AppDeps {
  /** `null` runs without Redis. */
  redis: Redis | null;
  mailer: Mailer;
  storage: StorageDriver;
  /** How emails are handed off (default: BullMQ queue with Redis, direct send otherwise). */
  emailDispatcher: EmailDispatcher;
}

export async function buildApp(env: Env, deps: Partial<AppDeps> = {}) {
  const app = Fastify({
    logger: loggerOptions(env),
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    // Caddy runs on the same Docker network (private address range).
    trustProxy: ['loopback', 'uniquelocal'],
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin, { env });
  await app.register(redisPlugin, {
    url: env.REDIS_URL,
    ...(deps.redis !== undefined ? { client: deps.redis } : {}),
  });
  await app.register(rateLimitPlugin);
  await app.register(mongoPlugin, {
    uri: env.MONGODB_URI,
    dbName: env.MONGODB_DB,
    autoIndex: env.NODE_ENV !== 'production',
  });
  await app.register(servicesPlugin, {
    storage: deps.storage ?? new LocalDiskDriver(env.MEDIA_STORAGE_PATH),
    // Tests never talk to SMTP: an in-memory mailer lets them read the OTP.
    mailer: deps.mailer ?? (env.NODE_ENV === 'test' ? createMemoryMailer() : createMailer(env)),
    verifyMailer: env.NODE_ENV !== 'test',
  });
  if (env.NODE_ENV !== 'production') {
    await app.register(docsPlugin, { apiUrl: env.API_URL });
  }

  await app.register(authPlugin, {
    env,
    ...(deps.emailDispatcher ? { dispatcher: deps.emailDispatcher } : {}),
  });

  await app.register(healthRoutes, { prefix: '/v1' });
  await app.register(authRoutes, { prefix: '/v1' });
  await app.register(profileRoutes, { prefix: '/v1' });
  await app.register(adminRoutes, { prefix: '/v1' });
  if (env.NODE_ENV === 'test' && isMemoryMailer(app.mailer)) {
    await app.register(outboxRoutes(app.mailer), { prefix: '/v1' });
  }
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
