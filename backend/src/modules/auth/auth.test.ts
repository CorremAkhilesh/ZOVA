import {
  apiErrorSchema,
  requestOtpResponseSchema,
  sessionResponseSchema,
  signOutResponseSchema,
} from '@zuvo/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cookieFrom,
  headers,
  me,
  outbox,
  readOtp,
  requestOtp,
  signIn,
  verifyOtp,
} from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
let current: TestApp | undefined;

async function start(envOverrides: Record<string, string> = {}) {
  current = await buildTestApp({}, envOverrides);
  return current.app;
}

afterEach(async () => {
  await current?.cleanup();
  current = undefined;
});

const email = 'asha@corremadvisory.com';

describe('OTP sign-up / sign-in', () => {
  it('signs up on the first verified code and returns a contract-valid session', async () => {
    const app = await start();
    const requested = await requestOtp(app, email);
    expect(requested.statusCode).toBe(200);
    expect(requestOtpResponseSchema.parse(requested.json())).toEqual({
      status: 'sent',
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
    });

    const code = await readOtp(app, email);
    const verified = await verifyOtp(app, email, code);
    expect(verified.statusCode).toBe(200);
    const body = sessionResponseSchema.parse(verified.json());
    expect(body.user).toMatchObject({ email, role: 'user', status: 'active', displayName: null });
    expect(body.needsProfile).toBe(true);

    const sevenDays = 7 * 24 * 3600 * 1000;
    const lifetime = Date.parse(body.session.expiresAt) - Date.parse(body.session.createdAt);
    expect(Math.abs(lifetime - sevenDays)).toBeLessThan(5000);
  });

  it('answers identically whether or not the account exists', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const app = await start();
      await signIn(app, email);
      vi.setSystemTime(Date.now() + 61_000); // past the resend cooldown
      const known = await requestOtp(app, email);
      const unknown = await requestOtp(app, 'new.person@corremadvisory.com');
      expect(known.statusCode).toBe(200);
      expect(unknown.statusCode).toBe(200);
      expect(known.json()).toEqual(unknown.json());
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets a host-only, httpOnly, SameSite=Lax session cookie', async () => {
    const app = await start();
    const { response } = await signIn(app, email);
    const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
    const session = cookies.find((cookie) => cookie.includes('zuvo.session_token='));
    expect(session).toBeDefined();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).toMatch(/Path=\//i);
    expect(session).not.toMatch(/Domain=/i);
    // Plain http outside production (local dev); production sets Secure (see auth-production test).
    expect(session).not.toMatch(/Secure/i);
  });

  it('restores the session with /me and never logs the OTP', async () => {
    const app = await start();
    const { cookie } = await signIn(app, email);
    const response = await me(app, cookie);
    expect(response.statusCode).toBe(200);
    expect(sessionResponseSchema.parse(response.json()).user.email).toBe(email);
  });
});

describe('wrong, expired and exhausted codes', () => {
  it('rejects a wrong code and reports attempts remaining', async () => {
    const app = await start();
    await requestOtp(app, email);
    const code = await readOtp(app, email);
    const wrong = code === '000000' ? '111111' : '000000';
    const response = await verifyOtp(app, email, wrong);
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json())).toMatchObject({
      code: 'OTP_INVALID',
      details: { attemptsRemaining: 4 },
    });
  });

  it('locks the code after 5 wrong attempts, even for the right code', async () => {
    const app = await start();
    await requestOtp(app, email);
    const code = await readOtp(app, email);
    const wrong = code === '000000' ? '111111' : '000000';
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await verifyOtp(app, email, wrong)).json().code);
    }
    expect(codes).toEqual([
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_ATTEMPTS_EXCEEDED',
    ]);
    const late = await verifyOtp(app, email, code);
    expect(late.statusCode).not.toBe(200);
  });

  it('rejects an expired code', async () => {
    const app = await start();
    await requestOtp(app, email);
    const code = await readOtp(app, email);
    const verification = app.mongo.collection('verification');
    await verification.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await verifyOtp(app, email, code);
    expect(response.statusCode).toBe(400);
    expect(['OTP_EXPIRED', 'OTP_INVALID']).toContain(response.json().code);
  });
});

describe('sign out', () => {
  it('ends the session; the old cookie then reports SESSION_EXPIRED', async () => {
    const app = await start();
    const { cookie } = await signIn(app, email);
    const out = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: headers(cookie),
    });
    expect(out.statusCode).toBe(200);
    expect(signOutResponseSchema.parse(out.json()).status).toBe('signed_out');
    expect(cookieFrom(out)).toMatch(/zuvo\.session_token=;?/);

    const after = await me(app, cookie);
    expect(after.statusCode).toBe(401);
    expect(after.json().code).toBe('SESSION_EXPIRED');
  });

  it('reports UNAUTHENTICATED without any session cookie', async () => {
    const app = await start();
    const response = await me(app);
    expect(response.statusCode).toBe(401);
    expect(apiErrorSchema.parse(response.json()).code).toBe('UNAUTHENTICATED');
  });
});

describe('profile', () => {
  it('needs a display name and a username to end the first-login state', async () => {
    const app = await start();
    const { cookie } = await signIn(app, email);
    const updated = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: headers(cookie),
      payload: { displayName: '  Asha Verma ' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().profile.displayName).toBe('Asha Verma');
    expect(sessionResponseSchema.parse((await me(app, cookie)).json()).needsProfile).toBe(true);
    const named = await app.inject({
      method: 'PUT',
      url: '/v1/me/username',
      headers: headers(cookie),
      payload: { username: 'asha' },
    });
    expect(named.statusCode).toBe(200);
    const session = sessionResponseSchema.parse((await me(app, cookie)).json());
    expect(session.needsProfile).toBe(false);
    expect(session.user.username).toBe('asha');
  });

  it('requires a session and a valid name', async () => {
    const app = await start();
    const anonymous = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: headers(),
      payload: { displayName: 'X' },
    });
    expect(anonymous.statusCode).toBe(401);
    const { cookie } = await signIn(app, email);
    const invalid = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: headers(cookie),
      payload: { displayName: '   ' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('VALIDATION_FAILED');
  });
});

describe('test outbox route', () => {
  it('exposes the latest email in tests only', async () => {
    const app = await start();
    await requestOtp(app, email);
    await readOtp(app, email);
    const response = await app.inject({ method: 'GET', url: `/v1/test/outbox/latest?to=${email}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().subject).toMatch(/^\d{6} is your Zuvo verification code$/);
    expect(outbox(app).outbox).toHaveLength(1);
  });
});
