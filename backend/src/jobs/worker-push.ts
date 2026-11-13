import type { Redis } from 'ioredis';
import mongoose from 'mongoose';
import type { Logger } from 'pino';
import { RedisCounterStore } from '../auth/counter-store.ts';
import type { Env } from '../config/env.ts';
import { redisAttendanceStore } from '../push/attendance-store.ts';
import { webPushSender } from '../push/sender.ts';
import { createPushWorker } from './push-worker.ts';

/**
 * The worker side of Web Push: the API queues "notify this person about this chat", and this
 * decides and sends, reading socket attendance from the same Redis. Off without VAPID keys.
 */
export async function startWorkerPush(env: Env, connection: Redis, logger: Logger) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    logger.info('web push is off: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set');
    return null;
  }
  const mongo = await mongoose
    .createConnection(env.MONGODB_URI, {
      dbName: env.MONGODB_DB,
      autoIndex: false,
      appName: 'zuvo-worker-push',
    })
    .asPromise();
  const worker = createPushWorker(
    connection,
    {
      mongo,
      log: logger,
      sender: webPushSender({
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      }),
      attendance: redisAttendanceStore(connection),
      counter: new RedisCounterStore(connection),
    },
    logger,
  );
  return {
    async close() {
      await worker.close();
      await mongo.close();
    },
  };
}
