import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PushJob } from '../push/notify.ts';

export const PUSH_QUEUE = 'push';

/**
 * Retries 3 times with exponential backoff (5 s, 10 s). Removed when done, kept briefly when failed:
 * a failed job never blocks a new one, since coalescing uses deduplication ids, not job ids.
 */
export const PUSH_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: { count: 1000 },
} as const;

/** `prefix` isolates keys (tests); BullMQ's default is "bull". */
export function createPushQueue(connection: Redis, prefix?: string): Queue<PushJob> {
  return new Queue<PushJob>(PUSH_QUEUE, {
    connection,
    ...(prefix ? { prefix } : {}),
    defaultJobOptions: PUSH_JOB_OPTIONS,
  });
}
