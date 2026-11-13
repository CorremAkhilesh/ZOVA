import { PUSH_COALESCE_SECONDS } from '@zuvo/protocol';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { PushJob } from './notify.ts';

/** How a "notify this person about this chat" leaves the request: later, and once per burst. */
export interface PushScheduler {
  schedule(job: PushJob): Promise<void>;
  close(): Promise<void>;
}

export const PUSH_COALESCE_MS = PUSH_COALESCE_SECONDS * 1000;

/** The same key in both schedulers: one pending notification per person and chat. */
export const coalesceKey = (job: PushJob) => `push-${job.userId}-${job.chatId}`;

/**
 * BullMQ: one delayed job per person and chat. Deduplication (throttle mode) ignores every add with
 * the same key while one is pending, so a burst becomes one job that, when it runs, reads all of it.
 */
export function queueScheduler(
  queue: () => Queue<PushJob>,
  delayMs = PUSH_COALESCE_MS,
): PushScheduler {
  return {
    async schedule(job) {
      await queue().add('notify', job, {
        delay: delayMs,
        deduplication: { id: coalesceKey(job), ttl: delayMs },
      });
    },
    async close() {},
  };
}

/**
 * Without Redis (tests, E2E server, development): the same rule with timers in this process.
 * Runs are not retried; a failure is logged.
 */
export function memoryScheduler(
  run: (job: PushJob) => Promise<unknown>,
  log: Pick<Logger, 'warn'>,
  delayMs = PUSH_COALESCE_MS,
): PushScheduler & { pending(): number; flush(): Promise<void> } {
  const timers = new Map<string, { timer: NodeJS.Timeout; job: PushJob }>();
  const running = new Set<Promise<unknown>>();
  const fire = (key: string) => {
    const entry = timers.get(key);
    if (!entry) return;
    timers.delete(key);
    const work = run(entry.job)
      .catch((error: unknown) => log.warn({ err: error, ...entry.job }, 'push job failed'))
      .finally(() => running.delete(work));
    running.add(work);
  };
  return {
    async schedule(job) {
      const key = coalesceKey(job);
      if (timers.has(key)) return;
      const timer = setTimeout(() => fire(key), delayMs);
      timer.unref();
      timers.set(key, { timer, job });
    },
    pending: () => timers.size,
    /** Runs everything pending now and waits for it (tests). */
    async flush() {
      for (const [key, { timer }] of [...timers]) {
        clearTimeout(timer);
        fire(key);
      }
      await Promise.all([...running]);
    },
    async close() {
      for (const { timer } of timers.values()) clearTimeout(timer);
      timers.clear();
      await Promise.all([...running]);
    },
  };
}
