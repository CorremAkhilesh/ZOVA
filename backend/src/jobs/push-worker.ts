import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { type PushContext, type PushJob, runPushJob } from '../push/notify.ts';
import { PUSH_QUEUE } from './push-queue.ts';

/** Sends the pushes the API queued. Every decision is made again here, at send time. */
export function createPushWorker(
  connection: Redis,
  context: PushContext,
  logger: Pick<Logger, 'warn' | 'error'>,
  prefix?: string,
) {
  const worker = new Worker<PushJob>(PUSH_QUEUE, (job) => runPushJob(context, job.data), {
    connection,
    concurrency: 10,
    ...(prefix ? { prefix } : {}),
  });
  worker.on('failed', (job, error) => {
    logger.warn(
      { jobId: job?.id, attempt: job?.attemptsMade, reason: error.name },
      'push job failed (will retry if attempts remain)',
    );
  });
  worker.on('error', (error) => logger.error({ err: error }, 'push worker error'));
  return worker;
}
