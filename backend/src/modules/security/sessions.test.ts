import {
  deviceSessionsResponseSchema,
  notMeResponseSchema,
  renameSessionResponseSchema,
  revokedSessionsResponseSchema,
} from '@zuvo/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { headers, me, outbox, signIn } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { registerAuthModels } from '../../db/auth-models.ts';
import { createRevokeToken } from '../../security/security-tokens.ts';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
let current: TestApp | undefined;
async function start() {
  current = await buildTestApp();
  return current.app;
}
afterEach(async () => {
  await current?.cleanup();
  current = undefined;
});

const asha = 'asha@corremadvisory.com';
const sessions = (app: TestApp['app'], cookie?: string) =>
  app.inject({ method: 'GET', url: '/v1/me/sessions', headers: headers(cookie) });

function alertToken(app: TestApp['app'], email: string): string {
  const text = outbox(app).lastTo(email)?.text ?? '';
  const token = /#token=([\w-]+)/.exec(text)?.[1];
  if (!token) throw new Error('no login alert yet');
  return token;
}

const notMe = (app: TestApp['app'], token: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/not-me', headers: headers(), payload: { token } });

describe('Settings → Devices', () => {
  it('lists only my sessions, marks this device and masks IPs', async () => {
    const app = await start();
    const first = await signIn(app, asha);
    const second = await signIn(app, asha);
    await signIn(app, 'bob@corremadvisory.com');
    const response = await sessions(app, second.cookie);
    const body = deviceSessionsResponseSchema.parse(response.json());
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.filter((s) => s.current)).toHaveLength(1);
    for (const session of body.sessions) {
      expect(session.ipAddress === null || session.ipAddress.endsWith('•••')).toBe(true);
    }
    expect((await sessions(app)).statusCode).toBe(401);
    expect(first.cookie).not.toBe(second.cookie);
  });

  it('signs out one device, never another user’s, and all other devices', async () => {
    const app = await start();
    const a1 = await signIn(app, asha);
    const a2 = await signIn(app, asha);
    const a3 = await signIn(app, asha);
    const bob = await signIn(app, 'bob@corremadvisory.com');
    const list = deviceSessionsResponseSchema.parse((await sessions(app, a1.cookie)).json());
    const other = list.sessions.find((s) => !s.current);

    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/v1/me/sessions/${other?.id}`,
      headers: headers(bob.cookie),
    });
    expect(forbidden.statusCode).toBe(404);

    const revokedOne = await app.inject({
      method: 'DELETE',
      url: `/v1/me/sessions/${other?.id}`,
      headers: headers(a1.cookie),
    });
    expect(revokedSessionsResponseSchema.parse(revokedOne.json())).toEqual({ revoked: 1 });

    const others = await app.inject({
      method: 'POST',
      url: '/v1/me/sessions/revoke-others',
      headers: headers(a1.cookie),
    });
    expect(others.json()).toEqual({ revoked: 1 });
    expect((await me(app, a1.cookie)).statusCode).toBe(200);
    expect((await me(app, a2.cookie)).statusCode).toBe(401);
    expect((await me(app, a3.cookie)).statusCode).toBe(401);
    expect((await me(app, bob.cookie)).statusCode).toBe(200);
  });

  it('names my own devices (trimmed, max 30), never someone else’s', async () => {
    const app = await start();
    const mine = await signIn(app, asha);
    const bob = await signIn(app, 'bob@corremadvisory.com');
    const [device] = deviceSessionsResponseSchema.parse(
      (await sessions(app, mine.cookie)).json(),
    ).sessions;
    const rename = (cookie: string | undefined, name: unknown) =>
      app.inject({
        method: 'PATCH',
        url: `/v1/me/sessions/${device?.id}`,
        headers: headers(cookie),
        payload: { name },
      });
    expect(device?.name).toBeNull();

    const named = await rename(mine.cookie, '  Work laptop ');
    expect(renameSessionResponseSchema.parse(named.json())).toEqual({ name: 'Work laptop' });
    const list = deviceSessionsResponseSchema.parse((await sessions(app, mine.cookie)).json());
    expect(list.sessions[0]?.name).toBe('Work laptop');

    expect((await rename(mine.cookie, 'x'.repeat(31))).statusCode).toBe(400);
    expect((await rename(bob.cookie, 'Mine now')).statusCode).toBe(404);
    expect((await rename(undefined, 'Anyone')).statusCode).toBe(401);

    expect((await rename(mine.cookie, '   ')).json()).toEqual({ name: null });
    expect((await rename(mine.cookie, 'Phone')).statusCode).toBe(200);
    expect((await rename(mine.cookie, null)).json()).toEqual({ name: null });
  });

  it('records last activity without ever extending the 7-day expiry', async () => {
    const app = await start();
    const { cookie, response } = await signIn(app, asha);
    const expiresAt = response.json().session.expiresAt as string;
    await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { ...headers(cookie), 'user-agent': CHROME },
    });
    const Sessions = registerAuthModels(app.mongo).AuthSession;
    await vi.waitFor(async () => {
      const doc = (await Sessions.findOne({}).lean()) as { lastActiveAt?: Date } | null;
      expect(doc?.lastActiveAt).toBeInstanceOf(Date);
    });
    const body = (await me(app, cookie)).json();
    expect(body.session.expiresAt).toBe(expiresAt);
  });
});

describe('new-login alert and "This wasn’t me"', () => {
  it('sends no alert on sign-up, then one per new sign-in with device and IST time', async () => {
    const app = await start();
    await signIn(app, asha);
    expect(outbox(app).outbox.filter((m) => m.subject.startsWith('New sign-in'))).toHaveLength(0);
    await signIn(app, asha);
    await vi.waitFor(() => expect(alertToken(app, asha)).toBeTruthy(), { timeout: 15_000 });
    const alert = outbox(app).lastTo(asha);
    expect(alert?.subject).toBe('New sign-in to your Zuvo account');
    expect(alert?.text).toMatch(/Time: .+ IST/);
    expect(alert?.text).toContain('http://localhost:5173/security/not-me#token=');
    expect(alert?.html).toContain('This wasn’t me');
  });

  it('revokes every session once; the link cannot be reused', async () => {
    const app = await start();
    const first = await signIn(app, asha);
    const second = await signIn(app, asha);
    await vi.waitFor(() => expect(alertToken(app, asha)).toBeTruthy(), { timeout: 15_000 });
    const token = alertToken(app, asha);

    const revoked = await notMe(app, token);
    expect(revoked.statusCode).toBe(200);
    expect(revoked.headers['referrer-policy']).toBe('no-referrer');
    expect(notMeResponseSchema.parse(revoked.json())).toEqual({
      status: 'revoked',
      revokedSessions: 2,
    });
    expect((await me(app, first.cookie)).statusCode).toBe(401);
    expect((await me(app, second.cookie)).statusCode).toBe(401);

    const reused = await notMe(app, token);
    expect(reused.statusCode).toBe(400);
    expect(reused.json().code).toBe('SECURITY_TOKEN_INVALID');
  });

  it('rejects expired and unknown tokens with friendly codes', async () => {
    const app = await start();
    const { response } = await signIn(app, asha);
    const userId = response.json().user.id as string;
    const old = await createRevokeToken(app, userId, new Date(Date.now() - 8 * 86_400_000));
    const expired = await notMe(app, old);
    expect(expired.json().code).toBe('SECURITY_TOKEN_EXPIRED');
    const unknown = await notMe(app, 'x'.repeat(43));
    expect(unknown.json().code).toBe('SECURITY_TOKEN_INVALID');
    expect((await notMe(app, 'short')).statusCode).toBe(400);
  });
});
