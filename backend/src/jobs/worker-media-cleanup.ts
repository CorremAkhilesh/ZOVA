import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import type { Logger } from 'pino';
import type { Env } from '../config/env.ts';
import { cleanupOrphans } from '../media/media.service.ts';
import { cleanupDeletedMedia } from '../media/media-access.ts';
import { LocalDiskDriver } from '../storage/local-disk-driver.ts';
import { startMediaCleanup } from './media-cleanup.ts';

/** The worker has no Fastify app: this gives the cleanup the same few things it needs from one. */
export async function startWorkerMediaCleanup(
  env: Env,
  mongo: Connection,
  connection: Redis,
  logger: Logger,
) {
  const context = {
    mongo,
    env,
    storage: new LocalDiskDriver(env.MEDIA_STORAGE_PATH),
  } as unknown as FastifyInstance;
  const job = await startMediaCleanup(
    connection,
    async () => (await cleanupOrphans(context)) + (await cleanupDeletedMedia(context)),
    logger,
  );
  return {
    async close() {
      await job.close();
    },
  };
}
