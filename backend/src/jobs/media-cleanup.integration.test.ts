/** Needs a real Redis: runs only when REDIS_TEST_URL is set. Keys stay under a random prefix. */
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { startMediaCleanup } from './media-cleanup.ts';

const redisUrl = process.env.REDIS_TEST_URL;

describe.skipIf(!redisUrl)('the media cleanup job', () => {
  it('runs by itself once started, and stops cleanly', async () => {
    const connection = new Redis(redisUrl ?? '', { maxRetriesPerRequest: null });
    const cleanup = vi.fn(async () => 2);
    const logger = { info: vi.fn(), error: vi.fn() };
    const prefix = `zuvo:test:${randomBytes(6).toString('hex')}`;
    const job = await startMediaCleanup(connection, cleanup, logger, prefix);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalled(), { timeout: 15_000, interval: 50 });
    await vi.waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith({ removed: 2 }, 'unattached uploads removed'),
    );
    await job.close();
    const keys = await connection.keys(`${prefix}:*`);
    if (keys.length > 0) await connection.del(keys);
    await connection.quit();
  });
});
