/**
 * Runs against a real Redis only when REDIS_TEST_URL is set (CI service container, or database 15
 * of the local Memurai-Zuvo service). Every key lives under a random per-run prefix and is removed.
 */
import { randomBytes } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_JOB_OPTIONS, type EmailJobData } from '../jobs/email-queue.ts';
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

  it('processes an email job through BullMQ', async () => {
    const queueConnection = createBullConnection(url ?? '', 'zuvo-test-queue');
    const workerConnection = createBullConnection(url ?? '', 'zuvo-test-worker');
    const queue = new Queue<EmailJobData>('email', {
      connection: queueConnection,
      prefix,
      defaultJobOptions: EMAIL_JOB_OPTIONS,
    });
    const sent: string[] = [];
    const worker = new Worker<EmailJobData>(
      'email',
      async (job) => {
        sent.push(job.data.to);
      },
      { connection: workerConnection, prefix },
    );
    const done = new Promise<void>((resolve) => worker.once('completed', () => resolve()));

    await queue.add('test', {
      to: 'a@corremadvisory.com',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    });
    await done;
    expect(sent).toEqual(['a@corremadvisory.com']);

    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await Promise.all([queueConnection.quit(), workerConnection.quit()]);
  });
});
