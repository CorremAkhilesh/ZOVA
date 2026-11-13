import { apiErrorSchema, healthResponseSchema, readyResponseSchema } from '@zuvo/protocol';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/helpers.ts';
import type { StorageDriver } from '../../storage/driver.ts';
import { LocalDiskDriver } from '../../storage/local-disk-driver.ts';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
let current: TestApp | undefined;

async function start(deps: Parameters<typeof buildTestApp>[0] = {}) {
  current = await buildTestApp(deps);
  return current.app;
}

afterEach(async () => {
  await current?.cleanup();
  current = undefined;
});

const redisStub = (ping: () => Promise<string>) => ({ ping }) as unknown as Redis;

describe('GET /v1/health', () => {
  it('returns liveness info and a request id header', async () => {
    const app = await start();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json()).status).toBe('ok');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets security headers', async () => {
    const app = await start();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /v1/ready', () => {
  it('is ready with MongoDB and storage ok and Redis skipped', async () => {
    const app = await start();
    const res = await app.inject({ method: 'GET', url: '/v1/ready' });
    expect(res.statusCode).toBe(200);
    expect(readyResponseSchema.parse(res.json())).toMatchObject({
      status: 'ready',
      checks: { mongodb: 'ok', redis: 'skipped', storage: 'ok' },
    });
  });

  it('reports Redis ok when it answers PING', async () => {
    const app = await start({ redis: redisStub(async () => 'PONG') });
    const res = await app.inject({ method: 'GET', url: '/v1/ready' });
    expect(res.json()).toMatchObject({ status: 'ready', checks: { redis: 'ok' } });
  });

  it('returns 503 when Redis fails', async () => {
    const app = await start({
      redis: redisStub(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });
    const res = await app.inject({ method: 'GET', url: '/v1/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'not_ready', checks: { redis: 'error' } });
  });

  it('returns 503 when the media folder is not writable', async () => {
    const broken: StorageDriver = Object.assign(new LocalDiskDriver('.'), {
      checkWritable: async () => {
        throw new Error('EACCES');
      },
    });
    const app = await start({ storage: broken });
    const res = await app.inject({ method: 'GET', url: '/v1/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ checks: { mongodb: 'ok', storage: 'error' } });
  });

  it('returns 503 when MongoDB is unreachable', async () => {
    const app = await start();
    await app.mongo.close();
    const res = await app.inject({ method: 'GET', url: '/v1/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ checks: { mongodb: 'error' } });
    await app.mongo.openUri(current?.env.MONGODB_URI ?? '');
  });
});

describe('unknown routes', () => {
  it('return the shared ApiError shape', async () => {
    const app = await start();
    const res = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).code).toBe('NOT_FOUND');
  });
});
