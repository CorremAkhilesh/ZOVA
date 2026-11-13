import type { Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { Types } from 'mongoose';
import type { Env } from '../config/env.ts';
import { createPushQueue } from '../jobs/push-queue.ts';
import { createBullConnection } from '../lib/redis.ts';
import {
  ATTENDANCE_HEARTBEAT_MS,
  ATTENDANCE_PREFIX,
  type AttendanceStore,
  memoryAttendanceStore,
  redisAttendanceStore,
} from '../push/attendance-store.ts';
import { type PushContext, type PushJob, runPushJob } from '../push/notify.ts';
import {
  memoryScheduler,
  PUSH_COALESCE_MS,
  type PushScheduler,
  queueScheduler,
} from '../push/scheduler.ts';
import { createMemoryPushSender, type PushSender, webPushSender } from '../push/sender.ts';
import { deleteSessionSubscriptions, pushModels } from '../push/subscriptions.service.ts';
import { generateVapidKeys } from '../push/vapid.ts';

export interface PushService {
  /** VAPID public key for pushManager.subscribe; null: push is off on this server. */
  publicKey: string | null;
  /** Null when push is off (no VAPID keys outside tests). */
  sender: PushSender | null;
  scheduler: PushScheduler;
  attendanceStore: AttendanceStore;
  /** A socket's tab became visible and focused, or stopped being so. */
  windowState(socketId: string, sessionId: string, attended: boolean): Promise<void>;
  socketGone(socketId: string, sessionId: string): Promise<void>;
  /** A message was stored: schedule a notification for every other member with push on. */
  messageStored(chatId: string, senderId: string, memberIds: string[]): void;
  /** A session was deleted: its subscriptions go. */
  sessionEnded(sessionId: string): void;
  /** What the push job needs, in this process. */
  context(): PushContext;
  /** Resolves once every scheduling already started has finished (tests, shutdown). */
  idle(): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    push: PushService;
  }
}

export interface PushPluginOptions {
  env: Env;
  /** Tests and E2E inject one (default: memory in NODE_ENV=test, web-push with VAPID keys). */
  sender?: PushSender | undefined;
  /** How long a burst is collected; E2E shortens it. Default PUSH_COALESCE_SECONDS. */
  coalesceMs?: number | undefined;
  scheduler?: PushScheduler | undefined;
}

function pickSender(app: FastifyInstance, options: PushPluginOptions): PushSender | null {
  const { env } = options;
  if (options.sender) return options.sender;
  if (env.NODE_ENV === 'test') return createMemoryPushSender();
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return webPushSender({
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT,
    });
  }
  app.log.info('web push is off: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set');
  return null;
}

async function setupPush(app: FastifyInstance, options: PushPluginOptions) {
  const { env } = options;
  const sender = pickSender(app, options);
  // Tests have no keys: a throwaway pair lets a browser in E2E subscribe like a real one.
  const publicKey = sender
    ? (env.VAPID_PUBLIC_KEY ?? (env.NODE_ENV === 'test' ? generateVapidKeys().publicKey : null))
    : null;
  const redis = app.redis instanceof Redis ? app.redis : null;
  const attendanceStore = redis
    ? redisAttendanceStore(redis, ATTENDANCE_PREFIX)
    : memoryAttendanceStore();
  const context = (): PushContext => ({
    mongo: app.mongo,
    log: app.log,
    sender: sender ?? createMemoryPushSender(),
    attendance: attendanceStore,
    counter: app.counterStore,
  });

  let queue: { queue: Queue<PushJob>; connection: Redis } | null = null;
  // Created on first use, so an API that never sends a push never opens the connection.
  const lazyQueue = () => {
    if (!queue) {
      const connection = createBullConnection(env.REDIS_URL ?? '', 'zuvo-api-push');
      connection.on('error', (error) => app.log.error({ err: error }, 'push queue redis error'));
      queue = { queue: createPushQueue(connection), connection };
    }
    return queue.queue;
  };
  const delay = options.coalesceMs ?? PUSH_COALESCE_MS;
  // Tests and E2E always run pushes in this process (no worker there), even with a Redis.
  const useQueue = redis !== null && Boolean(env.REDIS_URL) && env.NODE_ENV !== 'test';
  const scheduler =
    options.scheduler ??
    (useQueue
      ? queueScheduler(lazyQueue, delay)
      : memoryScheduler((job) => runPushJob(context(), job), app.log, delay));

  // Sockets of this instance whose tab is attended: refreshed so the entries stay alive.
  const attendedSockets = new Map<string, string>();
  const heartbeat = setInterval(() => {
    const entries = [...attendedSockets].map(([socketId, sessionId]): [string, string] => [
      sessionId,
      socketId,
    ]);
    attendanceStore
      .heartbeat(entries)
      .catch((error: unknown) => app.log.warn({ err: error }, 'attendance heartbeat failed'));
  }, ATTENDANCE_HEARTBEAT_MS);
  heartbeat.unref();

  const inflight = new Set<Promise<unknown>>();
  const quietly = (work: Promise<unknown>, what: string) => {
    const tracked = work
      .catch((error: unknown) => app.log.warn({ err: error }, `push: ${what} failed`))
      .finally(() => inflight.delete(tracked));
    inflight.add(tracked);
  };

  async function messageStored(chatId: string, senderId: string, memberIds: string[]) {
    const others = memberIds.filter((id) => id !== senderId);
    if (!sender || others.length === 0) return;
    // Only people with a device to notify (index: userId + createdAt).
    const withDevices = await pushModels(app.mongo).PushSubscription.distinct('userId', {
      userId: { $in: others.map((id) => new Types.ObjectId(id)) },
    });
    for (const userId of withDevices) await scheduler.schedule({ userId: String(userId), chatId });
  }

  app.decorate('push', {
    publicKey,
    sender,
    scheduler,
    attendanceStore,
    async windowState(socketId, sessionId, attended) {
      if (attended) attendedSockets.set(socketId, sessionId);
      else attendedSockets.delete(socketId);
      await attendanceStore.set(sessionId, socketId, attended);
    },
    async socketGone(socketId, sessionId) {
      if (!attendedSockets.delete(socketId)) return;
      await attendanceStore.set(sessionId, socketId, false);
    },
    messageStored: (chatId, senderId, memberIds) =>
      quietly(messageStored(chatId, senderId, memberIds), 'scheduling'),
    sessionEnded: (sessionId) =>
      quietly(deleteSessionSubscriptions(app.mongo, sessionId), 'removing subscriptions'),
    context,
    async idle() {
      await Promise.all([...inflight]);
    },
  } satisfies PushService);

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    await Promise.all([...inflight]);
    await scheduler.close();
    if (queue) {
      await queue.queue.close();
      await queue.connection.quit().catch(() => undefined);
    }
  });
}

export const pushPlugin = fp(setupPush, {
  name: 'push',
  fastify: '5.x',
  dependencies: ['auth', 'mongo', 'redis'],
});
