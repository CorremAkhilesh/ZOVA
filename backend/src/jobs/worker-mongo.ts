import mongoose, { type Connection } from 'mongoose';
import type { Env } from '../config/env.ts';
import { mongoClientOptions } from '../db/mongo-options.ts';
import { attachSlowQueryLogger } from '../db/slow-query.ts';

/**
 * The worker's one MongoDB client, shared by every job (media cleanup, expired pins, Web Push).
 * One client instead of one per job: each client keeps its own pool and monitoring sockets.
 */
export async function connectWorkerMongo(
  env: Pick<Env, 'MONGODB_URI' | 'MONGODB_DB'>,
  logger: { warn: (object: object, message: string) => void },
): Promise<{ mongo: Connection; close(): Promise<void> }> {
  const mongo = await mongoose
    .createConnection(env.MONGODB_URI, {
      dbName: env.MONGODB_DB,
      autoIndex: false,
      autoCreate: false,
      ...mongoClientOptions('worker'),
    })
    .asPromise();
  const detach = attachSlowQueryLogger(mongo.getClient(), logger);
  return {
    mongo,
    async close() {
      detach();
      await mongo.close();
    },
  };
}
