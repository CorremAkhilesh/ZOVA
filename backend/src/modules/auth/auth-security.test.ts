import { adminUserStatusResponseSchema, apiErrorSchema } from '@zuvo/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { headers, me, outbox, requestOtp, signIn, verifyOtp } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { generateVapidKeys } from '../../push/vapid.ts';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
let current: TestApp | undefined;

async function start(envOverrides: Record<string, string> = {}, deps = {}) {
  current = await buildTestApp(deps, envOverrides);
  return current.app;
}

afterEach(async () => {
  vi.useRealTimers();
  await current?.cleanup();
  current = undefined;
});

const DOMAIN_MESSAGE = 'Only @corremadvisory.com email addresses can use Zuvo';

describe('organization-only access', () => {
  it.each([
    'user@corremadvisory.com.evil.com',
    'user@evilcorremadvisory.com',
    'user@sub.corremadvisory.com',
    'user@gmail.com',
    'us er@corremadvisory.com',
    'user@evil.com@corremadvisory.com',
  ])('rejects %s with 403 before any code is generated or emailed', async (address) => {
    const app = await start();
    const response = await requestOtp(app, address);
    // Malformed addresses fail validation; well-formed outsiders get the domain error.
    if (response.statusCode === 400) {
      expect(response.json().code).toBe('VALIDATION_FAILED');
    } else {
      expect(response.statusCode).toBe(403);
      expect(apiErrorSchema.parse(response.json())).toMatchObject({
        code: 'EMAIL_DOMAIN_NOT_ALLOWED',
        message: DOMAIN_MESSAGE,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(outbox(app).outbox).toHaveLength(0);
    expect(await app.mongo.collection('verification').countDocuments()).toBe(0);
  });

  it('re-checks the domain on verify', async () => {
    const app = await start();
    const response = await verifyOtp(app, 'user@gmail.com', '123456');
    expect(response.statusCode).toBe(403);
    expect(response.json().message).toBe(DOMAIN_MESSAGE);
  });
});

describe('rate limits', () => {
  const email = 'rahul@corremadvisory.com';

  it('enforces the 60 s resend cooldown', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const app = await start();
    expect((await requestOtp(app, email)).statusCode).toBe(200);
    const again = await requestOtp(app, email);
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(again.json().details.retryAfterSeconds).toBeGreaterThan(50);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await requestOtp(app, email)).statusCode).toBe(200);
  });

  it('allows at most 5 codes per email per hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const app = await start();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await requestOtp(app, email)).statusCode);
      vi.setSystemTime(Date.now() + 61_000);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('limits code requests per IP, counting rejected domains too', async () => {
    const app = await start({ OTP_IP_LIMIT_PER_HOUR: '3' });
    const results = [
      (await requestOtp(app, 'a@corremadvisory.com')).statusCode,
      (await requestOtp(app, 'b@gmail.com')).statusCode,
      (await requestOtp(app, 'c@corremadvisory.com')).statusCode,
      (await requestOtp(app, 'd@corremadvisory.com')).statusCode,
    ];
    expect(results).toEqual([200, 403, 200, 429]);
  });
});

describe('absolute 7-day sessions', () => {
  it('never extends the session, then reports SESSION_EXPIRED after 7 days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const app = await start();
    const { cookie, response } = await signIn(app, 'neha@corremadvisory.com');
    const expiresAt = response.json().session.expiresAt as string;
    const signedInAt = Date.now();

    // Activity on days 1, 3 and 6 must not move the expiry.
    for (const days of [1, 3, 6]) {
      vi.setSystemTime(signedInAt + days * 24 * 3600 * 1000);
      const active = await me(app, cookie);
      expect(active.statusCode).toBe(200);
      expect(active.json().session.expiresAt).toBe(expiresAt);
    }

    vi.setSystemTime(Date.parse(expiresAt) + 60_000);
    const expired = await me(app, cookie);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().code).toBe('SESSION_EXPIRED');
  });
});

describe('admin deactivate / reactivate', () => {
  async function setup() {
    const app = await start();
    const admin = await signIn(app, 'admin@corremadvisory.com');
    const user = await signIn(app, 'meera@corremadvisory.com');
    return {
      app,
      adminCookie: admin.cookie,
      adminId: admin.response.json().user.id as string,
      userCookie: user.cookie,
      userId: user.response.json().user.id as string,
    };
  }

  const post = (app: TestApp['app'], path: string, cookie?: string) =>
    app.inject({ method: 'POST', url: path, headers: headers(cookie) });

  it('gives ADMIN_EMAILS the admin role on first login', async () => {
    const { app, adminCookie } = await setup();
    expect((await me(app, adminCookie)).json().user.role).toBe('admin');
  });

  it('deactivation revokes every session at once and blocks new codes', async () => {
    const { app, adminCookie, userCookie, userId } = await setup();
    const response = await post(app, `/v1/admin/users/${userId}/deactivate`, adminCookie);
    expect(response.statusCode).toBe(200);
    expect(adminUserStatusResponseSchema.parse(response.json())).toMatchObject({
      user: { id: userId, status: 'deactivated' },
      revokedSessions: 1,
    });

    const kicked = await me(app, userCookie);
    expect(kicked.statusCode).toBe(401);
    expect(kicked.json().code).toBe('SESSION_EXPIRED');

    const blocked = await requestOtp(app, 'meera@corremadvisory.com');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('ACCOUNT_DEACTIVATED');

    const reactivated = await post(app, `/v1/admin/users/${userId}/reactivate`, adminCookie);
    expect(reactivated.json().user.status).toBe('active');
  });

  it('is admin-only', async () => {
    const { app, userCookie, adminId } = await setup();
    const anonymous = await post(app, `/v1/admin/users/${adminId}/deactivate`);
    expect(anonymous.statusCode).toBe(401);
    const forbidden = await post(app, `/v1/admin/users/${adminId}/deactivate`, userCookie);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe('FORBIDDEN');
  });

  it('refuses self-deactivation and unknown users', async () => {
    const { app, adminCookie, adminId } = await setup();
    expect((await post(app, `/v1/admin/users/${adminId}/deactivate`, adminCookie)).statusCode).toBe(
      409,
    );
    const unknown = await post(
      app,
      '/v1/admin/users/0123456789abcdef01234567/deactivate',
      adminCookie,
    );
    expect(unknown.statusCode).toBe(404);
    expect((await post(app, '/v1/admin/users/not-an-id/deactivate', adminCookie)).statusCode).toBe(
      404,
    );
  });
});

/** Production requires a VAPID pair. */
function vapidEnv() {
  const keys = generateVapidKeys();
  return { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
}

describe('production cookies', () => {
  it('marks the session cookie Secure', async () => {
    const sent: unknown[] = [];
    const app = await start(
      {
        NODE_ENV: 'production',
        REDIS_URL: 'redis://127.0.0.1:1',
        MONGODB_DB: 'zuvo_e2e_prod_like',
        ...vapidEnv(),
      },
      { emailDispatcher: { dispatch: async (message: unknown) => void sent.push(message) } },
    );
    await requestOtp(app, 'priya@corremadvisory.com');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const subject = (sent[0] as { subject: string }).subject;
    const code = /^(\d{6})/.exec(subject)?.[1] ?? '';
    const verified = await verifyOtp(app, 'priya@corremadvisory.com', code);
    const cookies = ([] as string[]).concat(verified.headers['set-cookie'] ?? []);
    const session = cookies.find((cookie) => cookie.includes('zuvo.session_token='));
    expect(session).toMatch(/Secure/i);
    expect(session).toMatch(/^__Secure-zuvo\.session_token=/);
  });
});
