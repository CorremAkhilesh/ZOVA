import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

const MEDIA_CLEANUP_QUEUE = 'media-cleanup';
const EVERY_HOUR_MS = 3600_000;

type WorkerLogger = Pick<Logger, 'info' | 'error'>;

/** Runs `cleanup` hourly, once across all workers. */
export async function startMediaCleanup(
  connection: Redis,
  cleanup: () => Promise<number>,
  logger: WorkerLogger,
  prefix?: string,
) {
  const scope = prefix ? { prefix } : {};
  const queue = new Queue(MEDIA_CLEANUP_QUEUE, { connection, ...scope });
  await queue.upsertJobScheduler('hourly', { every: EVERY_HOUR_MS }, { name: 'orphans' });
  const worker = new Worker(
    MEDIA_CLEANUP_QUEUE,
    async () => {
      const removed = await cleanup();
      logger.info({ removed }, 'unattached uploads removed');
    },
    { connection, ...scope },
  );
  worker.on('error', (error) => logger.error({ err: error }, 'media cleanup error'));
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
