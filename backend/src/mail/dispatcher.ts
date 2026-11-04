import type { Queue } from 'bullmq';
import type { EmailJobData } from '../jobs/email-queue.ts';
import type { Mailer, MailMessage } from './mailer.ts';

/** Jobs carrying one-time codes or links must not linger in Redis. */
const SENSITIVE_JOBS = new Set(['otp', 'login-alert']);
const SENSITIVE_JOB_OPTIONS = { removeOnComplete: true, removeOnFail: { age: 3600 } } as const;

type Logger = { error: (object: object, message: string) => void };

/** Hands an email off for delivery without making the HTTP request wait for SMTP. */
export interface EmailDispatcher {
  dispatch(message: MailMessage, jobName: string): Promise<void>;
}

/** Production path: the BullMQ "email" queue; the worker sends with retries. */
export function queueDispatcher(queue: Pick<Queue<EmailJobData>, 'add'>): EmailDispatcher {
  return {
    async dispatch(message, jobName) {
      await queue.add(jobName, message, SENSITIVE_JOBS.has(jobName) ? SENSITIVE_JOB_OPTIONS : {});
    },
  };
}

/**
 * Development/test path without Redis: send in the background (fire and forget, errors logged).
 * Never used in production, where Redis and the queue are required.
 */
export function directDispatcher(mailer: Mailer, logger: Logger): EmailDispatcher {
  return {
    async dispatch(message, jobName) {
      void mailer.send(message).catch((error: unknown) => {
        // Never log the message itself: it can contain a one-time code.
        logger.error({ err: error, jobName }, 'email delivery failed');
      });
    },
  };
}
