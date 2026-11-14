import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { headers, requestOtp, verifyOtp } from '../../test/auth-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import { generateVapidKeys } from '../push/vapid.ts';
import { routeTable, sampleUrl, TEST_ONLY_ROUTES } from './route-table.ts';

/**
 * What a production build exposes: no test-only routes, no API docs, and the session cookie with
 * every flag. Built with NODE_ENV=production and fake values (no Redis, SMTP or Atlas is touched).
 */
/** Signing several people in through the real OTP flow is slow on a busy machine. */
const SETUP_TIMEOUT = 600_000;
let built: Awaited<ReturnType<typeof buildTestApp>>;
const sent: Array<{ subject: string }> = [];
const app = () => built.app;

beforeAll(async () => {
  const keys = generateVapidKeys();
  built = await buildTestApp(
    { emailDispatcher: { dispatch: async (message) => void sent.push(message) } },
    {
      NODE_ENV: 'production',
      // Required by production env validation; the app is given no Redis client (redis: null).
      REDIS_URL: 'redis://127.0.0.1:1',
      MONGODB_DB: `zuvo_e2e_prod_${randomBytes(4).toString('hex')}`,
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
    },
  );
}, SETUP_TIMEOUT);
afterAll(async () => {
  await built.cleanup();
});

const TEST_ONLY = TEST_ONLY_ROUTES.map(
  (route) => route.split(' ') as ['GET' | 'POST' | 'DELETE', string],
);

describe('a production build', () => {
  it('has no /v1/test/* route and no API docs', () => {
    const urls = routeTable(app()).map((route) => route.url);
    expect(urls.length).toBeGreaterThan(100);
    expect(urls.filter((url) => url.startsWith('/v1/test') || url.startsWith('/docs'))).toEqual([]);
  });

  it.each(TEST_ONLY)('answers 404 to %s %s', async (method, url) => {
    const response = await app().inject({
      method,
      url,
      headers: headers(),
      ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');
  });

  it('answers 404 to the API docs', async () => {
    for (const url of ['/docs', '/docs/', '/docs/openapi.json']) {
      expect((await app().inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
  });

  it(
    'sets the session cookie host-only, __Secure-, Secure, HttpOnly, SameSite=Lax, 7 days',
    async () => {
      const email = 'prod-cookie@corremadvisory.com';
      expect((await requestOtp(app(), email)).statusCode).toBe(200);
      await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0), { timeout: 15_000 });
      const code = /^(\d{6})/.exec(sent.at(-1)?.subject ?? '')?.[1] ?? '';
      const verified = await verifyOtp(app(), email, code);
      expect(verified.statusCode).toBe(200);
      const cookies = ([] as string[]).concat(verified.headers['set-cookie'] ?? []);
      const session = cookies.find((cookie) => cookie.includes('zuvo.session_token=')) ?? '';
      expect(session).toMatch(/^__Secure-zuvo\.session_token=/);
      const flags = session.split(';').map((part) => part.trim().toLowerCase());
      expect(flags).toEqual(
        expect.arrayContaining(['secure', 'httponly', 'samesite=lax', 'path=/']),
      );
      expect(flags.some((flag) => flag.startsWith('domain='))).toBe(false);
      const maxAge = Number(flags.find((flag) => flag.startsWith('max-age='))?.split('=')[1]);
      expect(maxAge).toBe(7 * 24 * 60 * 60);
      // Every other cookie Better Auth may set is protected the same way.
      for (const cookie of cookies) expect(cookie.toLowerCase()).toContain('httponly');
    },
    SETUP_TIMEOUT,
  );

  it('every route still needs what it needed in the test build', async () => {
    const open = new Set(['/v1/health', '/v1/ready']);
    const failures: string[] = [];
    for (const route of routeTable(app())) {
      if (open.has(route.url) || route.url.startsWith('/v1/auth/')) continue;
      const response = await app().inject({
        method: route.method as 'GET',
        url: sampleUrl(route.url),
        headers: headers(),
        ...(route.method === 'GET' || route.method === 'DELETE' ? {} : { payload: {} }),
      });
      if (response.statusCode !== 401)
        failures.push(`${route.method} ${route.url} ${response.statusCode}`);
    }
    expect(failures).toEqual([]);
  });
});
