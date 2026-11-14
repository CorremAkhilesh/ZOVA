import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import { AVATAR_MAX_BYTES } from '@zuvo/protocol';
import Fastify, { LogController } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import type { Env } from './config/env.ts';
import { loggerOptions } from './lib/logger.ts';
import type { SafeFetchOptions } from './link-preview/types.ts';
import type { EmailDispatcher } from './mail/dispatcher.ts';
import { createMailer, type Mailer } from './mail/mailer.ts';
import { createMemoryMailer, isMemoryMailer } from './mail/memory-mailer.ts';
import { adminRoutes } from './modules/admin/admin.routes.ts';
import { appearanceRoutes } from './modules/appearance/appearance.routes.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { chatsRoutes } from './modules/chats/chats.routes.ts';
import { disappearingRoutes } from './modules/chats/disappearing.routes.ts';
import { draftsRoutes } from './modules/chats/drafts.routes.ts';
import { foldersRoutes } from './modules/chats/folders.routes.ts';
import { groupsRoutes } from './modules/chats/groups.routes.ts';
import { messageActionsRoutes } from './modules/chats/message-actions.routes.ts';
import { pinsRoutes } from './modules/chats/pins.routes.ts';
import { pollsRoutes } from './modules/chats/polls.routes.ts';
import { scheduledRoutes } from './modules/chats/scheduled.routes.ts';
import { viewOnceRoutes } from './modules/chats/view-once.routes.ts';
import { configRoutes } from './modules/config/config.routes.ts';
import { healthRoutes } from './modules/health/health.routes.ts';
import { lockRoutes } from './modules/lock/lock.routes.ts';
import { mediaRoutes } from './modules/media/media.routes.ts';
import { blocksRoutes } from './modules/moderation/blocks.routes.ts';
import { adminReportsRoutes, reportsRoutes } from './modules/moderation/reports.routes.ts';
import { linkPreviewsRoutes } from './modules/previews/link-previews.routes.ts';
import { notificationActionRoutes } from './modules/push/notification-actions.routes.ts';
import { pushRoutes } from './modules/push/push.routes.ts';
import { searchRoutes } from './modules/search/search.routes.ts';
import { sessionsRoutes } from './modules/security/sessions.routes.ts';
import { quietHoursRoutes } from './modules/settings/quiet-hours.routes.ts';
import { expireTestRoutes } from './modules/test-support/expire.routes.ts';
import { outboxRoutes } from './modules/test-support/outbox.routes.ts';
import { pushOutboxRoutes } from './modules/test-support/push-outbox.routes.ts';
import { scheduledTestRoutes } from './modules/test-support/scheduled.routes.ts';
import { meRoutes } from './modules/users/me.routes.ts';
import { usersRoutes } from './modules/users/users.routes.ts';
import { authPlugin } from './plugins/auth.ts';
import { docsPlugin } from './plugins/docs.ts';
import { errorHandlerPlugin } from './plugins/error-handler.ts';
import { expirySweepPlugin, SWEEP_EVERY_MS } from './plugins/expiry-sweep.ts';
import { mongoPlugin } from './plugins/mongo.ts';
import { originCheckPlugin } from './plugins/origin-check.ts';
import { pushPlugin } from './plugins/push.ts';
import { rateLimitPlugin } from './plugins/rate-limit.ts';
import { redisPlugin } from './plugins/redis.ts';
import { securityPlugin } from './plugins/security.ts';
import { servicesPlugin } from './plugins/services.ts';
import { isMemoryPushSender, type PushSender } from './push/sender.ts';
import { realtimePlugin } from './realtime/server.ts';
import type { StorageDriver } from './storage/driver.ts';
import { LocalDiskDriver } from './storage/local-disk-driver.ts';

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
  }
}

/** Replaceable dependencies, mainly for tests. Anything omitted is created from env. */
export interface AppDeps {
  /** `null` runs without Redis. */
  redis: Redis | null;
  mailer: Mailer;
  storage: StorageDriver;
  /** How emails are handed off (default: BullMQ queue with Redis, direct send otherwise). */
  emailDispatcher: EmailDispatcher;
  /** Redis for the Socket.IO adapter (tests with several instances). Default: `redis`. */
  realtimeRedis: Redis | null;
  /** Adapter channel prefix (tests sharing a Redis). */
  realtimeKey: string;
  /** How link previews are fetched. Default: the real internet, private addresses blocked. */
  linkPreviewOptions: SafeFetchOptions;
  /** How Web Push leaves (default: in-memory in NODE_ENV=test, web-push with VAPID keys). */
  pushSender: PushSender;
  /** How long a burst of messages is collected into one push (E2E shortens it). */
  pushCoalesceMs: number;
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
    // Long enough for the largest upload chunk on a very slow link. What arrived is kept and resumed.
    requestTimeout: 10 * 60_000,
  }).withTypeProvider<ZodTypeProvider>();

  app.decorate('env', env);
  app.decorate('linkPreviewOptions', deps.linkPreviewOptions ?? {});
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin, { env });
  // CSRF: state-changing requests only from our own origins (docs/security-routes.md).
  await app.register(originCheckPlugin, { env });
  await app.register(redisPlugin, {
    url: env.REDIS_URL,
    ...(deps.redis !== undefined ? { client: deps.redis } : {}),
  });
  await app.register(rateLimitPlugin);
  await app.register(mongoPlugin, {
    uri: env.MONGODB_URI,
    dbName: env.MONGODB_DB,
    autoIndex: env.NODE_ENV !== 'production',
    compress: env.NODE_ENV === 'production',
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

  await app.register(pushPlugin, {
    env,
    sender: deps.pushSender,
    coalesceMs: deps.pushCoalesceMs,
  });

  await app.register(realtimePlugin, {
    env,
    ...(deps.realtimeRedis !== undefined ? { adapterRedis: deps.realtimeRedis } : {}),
    ...(deps.realtimeKey !== undefined ? { adapterKey: deps.realtimeKey } : {}),
  });

  // Multipart only for uploads; each route sets its own file-size limit.
  await app.register(multipart, { limits: { files: 1, fields: 5, fileSize: AVATAR_MAX_BYTES } });

  await app.register(healthRoutes, { prefix: '/v1' });
  await app.register(configRoutes, { prefix: '/v1' });
  await app.register(authRoutes, { prefix: '/v1' });
  await app.register(meRoutes, { prefix: '/v1' });
  await app.register(usersRoutes, { prefix: '/v1' });
  await app.register(sessionsRoutes, { prefix: '/v1' });
  await app.register(chatsRoutes, { prefix: '/v1' });
  await app.register(groupsRoutes, { prefix: '/v1' });
  await app.register(messageActionsRoutes, { prefix: '/v1' });
  await app.register(mediaRoutes, { prefix: '/v1' });
  await app.register(adminRoutes, { prefix: '/v1' });
  await app.register(blocksRoutes, { prefix: '/v1' });
  await app.register(reportsRoutes, { prefix: '/v1' });
  await app.register(adminReportsRoutes, { prefix: '/v1' });
  await app.register(linkPreviewsRoutes, { prefix: '/v1' });
  await app.register(searchRoutes, { prefix: '/v1' });
  await app.register(draftsRoutes, { prefix: '/v1' });
  await app.register(foldersRoutes, { prefix: '/v1' });
  await app.register(pinsRoutes, { prefix: '/v1' });
  await app.register(lockRoutes, { prefix: '/v1' });
  await app.register(quietHoursRoutes, { prefix: '/v1' });
  await app.register(appearanceRoutes, { prefix: '/v1' });
  await app.register(pollsRoutes, { prefix: '/v1' });
  await app.register(scheduledRoutes, { prefix: '/v1' });
  await app.register(disappearingRoutes, { prefix: '/v1' });
  await app.register(viewOnceRoutes, { prefix: '/v1' });
  await app.register(pushRoutes, { prefix: '/v1' });
  await app.register(notificationActionRoutes, { prefix: '/v1' });
  // Tests run passes themselves (POST /v1/test/expire-messages, or app.expirySweep.run()).
  await app.register(expirySweepPlugin, { every: env.NODE_ENV === 'test' ? null : SWEEP_EVERY_MS });
  if (env.NODE_ENV === 'test' && isMemoryMailer(app.mailer)) {
    await app.register(outboxRoutes(app.mailer), { prefix: '/v1' });
    await app.register(expireTestRoutes, { prefix: '/v1' });
    await app.register(scheduledTestRoutes, { prefix: '/v1' });
  }
  if (env.NODE_ENV === 'test' && app.push.sender && isMemoryPushSender(app.push.sender)) {
    await app.register(pushOutboxRoutes(app.push.sender), { prefix: '/v1' });
  }
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
