import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Mailer } from '../mail/mailer.ts';
import { EMAIL_QUEUE, type EmailJobData } from './email-queue.ts';

export function createEmailWorker(connection: Redis, mailer: Mailer, logger: Logger) {
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE,
    async (job) => {
      const { messageId } = await mailer.send(job.data);
      logger.info({ jobId: job.id, messageId }, 'email sent');
    },
    { connection, concurrency: 5 },
  );

  worker.on('failed', (job, error) => {
    logger.warn(
      { jobId: job?.id, attempt: job?.attemptsMade, err: error },
      'email job failed (will retry if attempts remain)',
    );
  });
  worker.on('error', (error) => logger.error({ err: error }, 'email worker error'));
  return worker;
}
