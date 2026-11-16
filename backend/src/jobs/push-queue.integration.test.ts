/** Needs a real Redis: runs only when REDIS_TEST_URL is set. Keys stay under a random prefix. */
import { randomBytes } from 'node:crypto';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { PushJob } from '../push/notify.ts';
import { queueScheduler } from '../push/scheduler.ts';
import { createPushQueue, PUSH_QUEUE } from './push-queue.ts';

const redisUrl = process.env.REDIS_TEST_URL;

describe.skipIf(!redisUrl)('the push queue', () => {
  it('turns a burst into one delayed job per person and chat, then accepts the next one', async () => {
    const connection = new Redis(redisUrl ?? '', { maxRetriesPerRequest: null });
    const prefix = `zuvo:test:${randomBytes(6).toString('hex')}`;
    const queue = createPushQueue(connection, prefix);
    const scheduler = queueScheduler(() => queue, 300);
    const runs: PushJob[] = [];
    const worker = new Worker<PushJob>(PUSH_QUEUE, async (job) => void runs.push(job.data), {
      connection,
      prefix,
    });
    try {
      for (let n = 0; n < 5; n++) await scheduler.schedule({ userId: 'u1', chatId: 'c1' });
      await scheduler.schedule({ userId: 'u1', chatId: 'c2' });
      await vi.waitFor(() => expect(runs).toHaveLength(2), { timeout: 15_000, interval: 50 });
      expect(runs).toEqual(
        expect.arrayContaining([
          { userId: 'u1', chatId: 'c1' },
          { userId: 'u1', chatId: 'c2' },
        ]),
      );
      // Done jobs are removed, so the next burst gets its own job.
      await scheduler.schedule({ userId: 'u1', chatId: 'c1' });
      await vi.waitFor(() => expect(runs).toHaveLength(3), { timeout: 15_000, interval: 50 });
      expect(await queue.getCompletedCount()).toBe(0);
    } finally {
      await worker.close();
      await queue.close();
      const keys = await connection.keys(`${prefix}:*`);
      if (keys.length > 0) await connection.del(keys);
      await connection.quit();
    }
  });
});
