import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cookieFrom,
  headers,
  me,
  ORIGIN,
  readOtp,
  requestOtp,
  verifyOtp,
} from '../../test/auth-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  nextDisconnect,
  signedIn,
} from '../../test/realtime-helpers.ts';
import { createRevokeToken } from '../security/security-tokens.ts';

/** Sign-in hardening: fixation, enumeration, per-IP limits, Better Auth's raw endpoints, CSRF. */
/** Signing several people in through the real OTP flow is slow on a busy machine. */
const SETUP_TIMEOUT = 600_000;
let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
}, SETUP_TIMEOUT);
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const tokenOf = (cookie: string) => /zuvo\.session_token=([^;]+)/.exec(cookie)?.[1] ?? '';

describe('session fixation', () => {
  it(
    'always issues a new session token at sign-in; a planted one is never adopted',
    async () => {
      const attacker = await signedIn(app(), 'fix-attacker@corremadvisory.com');
      const planted = `${attacker.cookie}; zuvo.session_token=planted-token-value`;
      const email = 'fix-victim@corremadvisory.com';
      await app().otpThrottle.resetEmail(email);
      expect((await requestOtp(app(), email, { cookie: planted })).statusCode).toBe(200);
      const code = await readOtp(app(), email);
      const verified = await app().inject({
        method: 'POST',
        url: '/v1/auth/otp/verify',
        headers: { ...headers(), cookie: planted },
        payload: { email, code },
      });
      expect(verified.statusCode).toBe(200);
      const issued = tokenOf(cookieFrom(verified));
      expect(issued).not.toBe('');
      expect(issued).not.toBe(tokenOf(attacker.cookie));
      expect(issued).not.toBe('planted-token-value');
      // The new cookie is the victim's; the attacker's own session still is only the attacker's.
      expect((await me(app(), cookieFrom(verified))).json().user.email).toBe(email);
      expect((await me(app(), attacker.cookie)).json().user.email).toBe(attacker.email);
    },
    SETUP_TIMEOUT,
  );
});

describe('enumeration', () => {
  it('a wrong code reads the same for an existing account and an unknown address', async () => {
    const known = await signedIn(app(), 'enum-known@corremadvisory.com');
    const unknown = 'enum-unknown@corremadvisory.com';
    const shape = (response: Awaited<ReturnType<typeof verifyOtp>>) => {
      const { requestId: _, ...rest } = response.json() as Record<string, unknown>;
      return { status: response.statusCode, body: rest };
    };
    const a = shape(await verifyOtp(app(), known.email, '000000'));
    const b = shape(await verifyOtp(app(), unknown, '000000'));
    expect(a).toEqual(b);
  });
});

describe('per-IP limits', () => {
  it(
    'the verify route allows 20 attempts a minute from one address, whatever the email',
    async () => {
      // One by one: concurrent injections all count before any is answered. On a very slow machine
      // the 21 requests can outlast the one-minute window, so the 429 is only required inside it.
      const started = Date.now();
      const statuses: number[] = [];
      for (let i = 0; i < 21; i += 1) {
        const response = await app().inject({
          method: 'POST',
          url: '/v1/auth/otp/verify',
          headers: headers(),
          remoteAddress: '203.0.113.7',
          payload: { email: `ip${i}@corremadvisory.com`, code: '123456' },
        });
        statuses.push(response.statusCode);
      }
      expect(statuses.slice(0, 20)).not.toContain(429);
      if (Date.now() - started < 55_000) expect(statuses[20]).toBe(429);
    },
    SETUP_TIMEOUT,
  );
});

describe("Better Auth's own endpoints", () => {
  it('are not exposed: no raw session tokens, no sign-in that skips our limits', async () => {
    const user = await signedIn(app(), 'raw-endpoints@corremadvisory.com');
    const paths: Array<['GET' | 'POST', string, object?]> = [
      ['GET', '/v1/auth/get-session'],
      ['GET', '/v1/auth/list-sessions'],
      ['GET', '/v1/auth/ok'],
      ['GET', '/v1/auth/list-accounts'],
      ['POST', '/v1/auth/sign-out', {}],
      ['POST', '/v1/auth/revoke-sessions', {}],
      ['POST', '/v1/auth/revoke-other-sessions', {}],
      ['POST', '/v1/auth/update-session', {}],
      ['POST', '/v1/auth/sign-in/email-otp', { email: user.email, otp: '000000' }],
      ['POST', '/v1/auth/email-otp/send-verification-otp', { email: user.email, type: 'sign-in' }],
      [
        'POST',
        '/v1/auth/email-otp/check-verification-otp',
        { email: user.email, type: 'sign-in', otp: '000000' },
      ],
      ['POST', '/v1/auth/email-otp/request-email-change', { newEmail: 'x@evil.com' }],
    ];
    for (const [method, path, payload] of paths) {
      const response = await app().inject({
        method,
        url: path,
        headers: headers(user.cookie),
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode, path).toBe(404);
      expect(response.body, path).not.toContain(tokenOf(user.cookie));
    }
    expect((await me(app(), user.cookie)).statusCode).toBe(200);
  });
});

describe('cross-site requests (CSRF)', () => {
  it('a state change from another origin, a null origin or a foreign fetch is refused', async () => {
    const user = await signedIn(app(), 'csrf@corremadvisory.com');
    const attempts = [
      { origin: 'https://evil.example' },
      { origin: 'null' },
      // A sibling subdomain is "same site": SameSite=Lax cookies would still be sent.
      { origin: 'https://other.corremadvisory.com' },
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
    ];
    for (const extra of attempts) {
      const response = await app().inject({
        method: 'PATCH',
        url: '/v1/me/profile',
        headers: { cookie: user.cookie, ...extra },
        payload: { about: 'pwned' },
      });
      expect(response.statusCode, JSON.stringify(extra)).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    }
    const profile = await app().inject({
      method: 'GET',
      url: '/v1/me/profile',
      headers: { cookie: user.cookie },
    });
    expect(profile.body).not.toContain('pwned');
  });

  it('allows the app itself, and non-browser clients that send no Origin', async () => {
    const user = await signedIn(app(), 'csrf-ok@corremadvisory.com');
    for (const extra of [
      { origin: ORIGIN },
      { origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
      {},
      { 'sec-fetch-site': 'same-origin' },
      { 'sec-fetch-site': 'none' },
    ]) {
      const response = await app().inject({
        method: 'PATCH',
        url: '/v1/me/profile',
        headers: { cookie: user.cookie, ...extra },
        payload: { about: 'fine' },
      });
      expect(response.statusCode, JSON.stringify(extra)).toBe(200);
    }
    // Reads are never blocked (CORS keeps other sites from reading the answer).
    const read = await app().inject({
      method: 'GET',
      url: '/v1/me/profile',
      headers: { cookie: user.cookie, origin: 'https://evil.example' },
    });
    expect(read.statusCode).toBe(200);
    expect(read.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('"This wasn\'t me"', () => {
  it('disconnects every live socket of the account', async () => {
    const user = await signedIn(app(), 'not-me@corremadvisory.com');
    const socket = await connect(url, user.cookie);
    const gone = nextDisconnect(socket);
    const token = await createRevokeToken(app(), user.id);
    const response = await app().inject({
      method: 'POST',
      url: '/v1/auth/not-me',
      headers: headers(),
      payload: { token },
    });
    expect(response.statusCode).toBe(200);
    await gone;
    expect((await me(app(), user.cookie)).json().code).toBe('SESSION_EXPIRED');
  });
});
