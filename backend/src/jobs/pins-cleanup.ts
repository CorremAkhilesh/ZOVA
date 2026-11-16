import { Queue, Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import type { Logger } from 'pino';
import { sweepExpiredPins } from '../chats/pins.service.ts';
import type { Env } from '../config/env.ts';

const PINS_QUEUE = 'pins-cleanup';
/** Screens hide an expired pin at once by its time; this only tidies the database. */
export const PINS_SWEEP_MS = 5 * 60_000;

/** Removes expired pins every 5 minutes, once across all workers. */
export async function startPinsCleanup(
  connection: Redis,
  sweep: () => Promise<number>,
  logger: Pick<Logger, 'info' | 'error'>,
  prefix?: string,
) {
  const scope = prefix ? { prefix } : {};
  const queue = new Queue(PINS_QUEUE, { connection, ...scope });
  await queue.upsertJobScheduler('every-5-minutes', { every: PINS_SWEEP_MS }, { name: 'expired' });
  const worker = new Worker(
    PINS_QUEUE,
    async () => {
      const chats = await sweep();
      if (chats > 0) logger.info({ chats }, 'expired pins removed');
    },
    { connection, ...scope },
  );
  worker.on('error', (error) => logger.error({ err: error }, 'pins cleanup error'));
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}

/** The worker has no Fastify app: the sweep only needs MongoDB from one. */
export async function startWorkerPinsCleanup(
  env: Env,
  mongo: Connection,
  connection: Redis,
  logger: Logger,
) {
  const context = { mongo, env } as unknown as FastifyInstance;
  const job = await startPinsCleanup(connection, () => sweepExpiredPins(context), logger);
  return {
    async close() {
      await job.close();
    },
  };
}
