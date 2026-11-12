/** Needs a real Redis: runs only when REDIS_TEST_URL is set. Keys stay under a random prefix. */
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { startPinsCleanup } from './pins-cleanup.ts';

const redisUrl = process.env.REDIS_TEST_URL;

describe.skipIf(!redisUrl)('the expired pins job', () => {
  it('runs by itself once started, logs only when it removed something, and stops cleanly', async () => {
    const connection = new Redis(redisUrl ?? '', { maxRetriesPerRequest: null });
    const sweep = vi.fn(async () => 3);
    const logger = { info: vi.fn(), error: vi.fn() };
    const prefix = `zuvo:test:${randomBytes(6).toString('hex')}`;
    const job = await startPinsCleanup(connection, sweep, logger, prefix);
    await vi.waitFor(() => expect(sweep).toHaveBeenCalled(), { timeout: 15_000, interval: 50 });
    await vi.waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith({ chats: 3 }, 'expired pins removed'),
    );
    await job.close();
    const keys = await connection.keys(`${prefix}:*`);
    if (keys.length > 0) await connection.del(keys);
    await connection.quit();
  });
});
