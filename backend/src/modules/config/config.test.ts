import { appConfigResponseSchema } from '@zuvo/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';

const cleanups: Array<() => Promise<void>> = [];
afterAll(() => Promise.all(cleanups.map((cleanup) => cleanup())));

async function appWith(env: Record<string, string> = {}) {
  const built = await buildTestApp({}, env);
  cleanups.push(built.cleanup);
  return built.app;
}

const read = async (env?: Record<string, string>) => {
  const app = await appWith(env);
  const who = await signedIn(app, 'reader@corremadvisory.com');
  return app.inject({ method: 'GET', url: '/v1/config', headers: headers(who.cookie) });
};

describe('GET /v1/config', () => {
  it('needs a session', async () => {
    const app = await appWith();
    expect((await app.inject({ method: 'GET', url: '/v1/config' })).statusCode).toBe(401);
  });

  it('gives the limit as 1 GB by default', async () => {
    const response = await read();
    expect(response.statusCode).toBe(200);
    expect(appConfigResponseSchema.parse(response.json()).media.maxFileBytes).toBe(1024 ** 3);
  });

  it('follows MEDIA_MAX_FILE_MB', async () => {
    const response = await read({ MEDIA_MAX_FILE_MB: '5' });
    expect(response.json().media.maxFileBytes).toBe(5 * 1024 * 1024);
  });
});
