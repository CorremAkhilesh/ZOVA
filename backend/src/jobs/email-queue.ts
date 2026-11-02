import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { MailMessage } from '../mail/mailer.ts';

export const EMAIL_QUEUE = 'email';

export type EmailJobData = MailMessage;

/** Retries failed sends 5 times with exponential backoff: 10 s, 20 s, 40 s, 80 s, 160 s. */
export const EMAIL_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
} as const;

export function createEmailQueue(connection: Redis): Queue<EmailJobData> {
  return new Queue<EmailJobData>(EMAIL_QUEUE, {
    connection,
    defaultJobOptions: EMAIL_JOB_OPTIONS,
  });
}
