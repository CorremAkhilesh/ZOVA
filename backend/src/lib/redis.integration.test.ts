/**
 * Runs against a real Redis only when REDIS_TEST_URL is set (CI service container, or database 15
 * of the local Memurai-Zuvo service). Every key lives under a random per-run prefix and is removed.
 */
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEmailQueue } from '../jobs/email-queue.ts';
import { createEmailWorker } from '../jobs/email-worker.ts';
import type { Mailer } from '../mail/mailer.ts';
import { errorHandlerPlugin } from '../plugins/error-handler.ts';
import { rateLimitPlugin } from '../plugins/rate-limit.ts';
import { redisPlugin } from '../plugins/redis.ts';
import { checkEvictionPolicy, createBullConnection, createRedis } from './redis.ts';

const url = process.env.REDIS_TEST_URL;
const prefix = `zuvo-test-${randomBytes(4).toString('hex')}`;

async function deleteKeys(redis: Redis, pattern: string) {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    if (keys.length > 0) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}

describe.skipIf(!url)('Redis integration (REDIS_TEST_URL)', () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = createRedis(url ?? '');
    await redis.ping();
  });

  afterAll(async () => {
    await deleteKeys(redis, `${prefix}*`);
    await redis.quit();
  });

  it('uses the noeviction policy required by BullMQ', async () => {
    const warnings: string[] = [];
    const policy = await checkEvictionPolicy(redis, {
      warn: (_o, message) => warnings.push(message),
    });
    expect(policy).toBe('noeviction');
    expect(warnings).toEqual([]);
  });

  it('enforces the rate limit with counters stored in Redis', async () => {
    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(redisPlugin, { url: undefined, client: redis });
    await app.register(rateLimitPlugin, {
      max: 3,
      timeWindow: '1 minute',
      nameSpace: `${prefix}:rl:`,
    });
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const hit = () => app.inject({ method: 'GET', url: '/ping', remoteAddress: '10.20.30.40' });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await hit()).statusCode);
    expect(statuses).toEqual([200, 200, 200, 429]);

    const limited = await hit();
    expect(limited.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(limited.headers['retry-after']).toBeDefined();

    const keys = await redis.keys(`${prefix}:rl:*`);
    expect(keys.length).toBeGreaterThan(0);
    await app.close();
  });

  it('delivers an email job through the real queue and worker, retrying on failure', async () => {
    const queueConnection = createBullConnection(url ?? '', 'zuvo-test-queue');
    const workerConnection = createBullConnection(url ?? '', 'zuvo-test-worker');
    const sent: string[] = [];
    const mailer: Mailer = {
      send: vi.fn(async (message) => {
        sent.push(message.to);
        return { messageId: 'm-1' };
      }),
      verify: async () => {},
      close: () => {},
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const queue = createEmailQueue(queueConnection, prefix);
    const worker = createEmailWorker(workerConnection, mailer, logger, prefix);
    const done = new Promise<void>((resolve) => worker.once('completed', () => resolve()));

    await queue.add('test', {
      to: 'a@corremadvisory.com',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    });
    await done;
    expect(sent).toEqual(['a@corremadvisory.com']);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm-1' }),
      'email sent',
    );

    // A failing send is logged and kept for retry (attempts: 5).
    vi.mocked(mailer.send).mockRejectedValueOnce(new Error('SMTP down'));
    const failed = new Promise<void>((resolve) => worker.once('failed', () => resolve()));
    const job = await queue.add('test', {
      to: 'b@corremadvisory.com',
      subject: 's',
      html: 'h',
      text: 't',
    });
    await failed;
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: job.id, attempt: 1 }),
      'email job failed (will retry if attempts remain)',
    );
    expect(await job.getState()).toBe('delayed');

    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await Promise.all([queueConnection.quit(), workerConnection.quit()]);
  });

  it('connects the API redis plugin from a URL and quits it on close', async () => {
    const app = Fastify({ logger: false });
    const info = vi.spyOn(app.log, 'info');
    await app.register(redisPlugin, { url });
    await app.ready();
    expect(app.redis).toBeInstanceOf(Redis);
    await expect(app.redis?.ping()).resolves.toBe('PONG');
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith('redis connected'));
    await app.close();
    await vi.waitFor(() => expect(app.redis?.status).toBe('end'));
  });
});
