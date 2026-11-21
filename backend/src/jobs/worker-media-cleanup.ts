import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import type { Logger } from 'pino';
import type { Env } from '../config/env.ts';
import { cleanupOrphans } from '../media/media.service.ts';
import { cleanupDeletedMedia } from '../media/media-access.ts';
import { cleanupOldFiles } from '../settings/admin-settings.ts';
import { createSettingsStore } from '../settings/app-settings.ts';
import { LocalDiskDriver } from '../storage/local-disk-driver.ts';
import { startMediaCleanup } from './media-cleanup.ts';

/** The worker has no Fastify app: this gives the cleanup the same few things it needs from one. */
export async function startWorkerMediaCleanup(
  env: Env,
  mongo: Connection,
  connection: Redis,
  logger: Logger,
) {
  // Admin → Settings, read here too (auto-cleanup), refreshed every 10 seconds.
  const settings = createSettingsStore(mongo, env);
  await settings.refresh();
  const context = {
    mongo,
    env,
    settings,
    storage: new LocalDiskDriver(env.MEDIA_STORAGE_PATH),
  } as unknown as FastifyInstance;
  const job = await startMediaCleanup(
    connection,
    async () =>
      (await cleanupOrphans(context)) +
      (await cleanupDeletedMedia(context)) +
      (await cleanupOldFiles(context)),
    logger,
  );
  return {
    async close() {
      settings.close();
      await job.close();
    },
  };
}
