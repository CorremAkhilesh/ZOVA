/** Needs a real Redis: runs only when REDIS_TEST_URL is set. Keys stay under a random prefix. */
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { startScheduledQueue } from './scheduled-runner.ts';

const redisUrl = process.env.REDIS_TEST_URL;

describe.skipIf(!redisUrl)('the scheduled messages queue', () => {
  it('runs each job at its time, forgets a removed one, and stops cleanly', async () => {
    const connection = new Redis(redisUrl ?? '', { maxRetriesPerRequest: null });
    const ran: string[] = [];
    const run = vi.fn(async (id: string) => {
      ran.push(id);
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const prefix = `zuvo:test:${randomBytes(6).toString('hex')}`;
    const queue = startScheduledQueue(connection, run, logger, prefix);
    const soon = new Date(Date.now() + 1500);
    const edited = new Date(Date.now() + 1000);
    await queue.jobs.schedule('aaaaaaaaaaaaaaaaaaaaaaaa', soon);
    // Scheduled, then moved: only the new time runs.
    await queue.jobs.schedule('bbbbbbbbbbbbbbbbbbbbbbbb', soon);
    await queue.jobs.unschedule('bbbbbbbbbbbbbbbbbbbbbbbb', soon);
    await queue.jobs.schedule('bbbbbbbbbbbbbbbbbbbbbbbb', edited);
    // Scheduled twice for the same time: one job.
    await queue.jobs.schedule('aaaaaaaaaaaaaaaaaaaaaaaa', soon);
    expect(run).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(ran).toHaveLength(2), { timeout: 15_000, interval: 50 });
    expect(ran.sort()).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb']);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(ran).toHaveLength(2);
    await queue.close();
    const keys = await connection.keys(`${prefix}:*`);
    if (keys.length > 0) await connection.del(keys);
    await connection.quit();
  });
});
