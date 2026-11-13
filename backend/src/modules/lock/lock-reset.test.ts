import { lockStatusResponseSchema, resetPinRequestResponseSchema } from '@zuvo/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { outbox } from '../../../test/auth-helpers.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { lockClock, lockModels, userOid } from '../../lock/lock-store.ts';
import { lockResetEmail } from '../../mail/templates/lock-reset-email.tsx';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await built.cleanup();
});

const request = (who: Person | null) => call(who, 'POST', '/v1/me/lock/reset/request');
const confirm = (who: Person | null, code: string) =>
  call(who, 'POST', '/v1/me/lock/reset/verify', { code });
const clearCooldown = (who: Person) =>
  app().counterStore.remove(`zuvo:pin-reset:cooldown:${who.id}`);

/** Waits for the reset email (sent in the background) and returns its code. */
async function readCode(who: Person, previous?: string) {
  let code = '';
  await vi.waitFor(
    () => {
      const subject = outbox(app()).lastTo(who.email)?.subject ?? '';
      const match = /^(\d{6}) is your .+ PIN reset code$/.exec(subject);
      if (!match?.[1] || match[1] === previous) throw new Error('no code yet');
      code = match[1];
    },
    { timeout: 15_000, interval: 50 },
  );
  return code;
}

async function withPin() {
  const who = await person();
  expect((await call(who, 'PUT', '/v1/me/lock/pin', { pin: '1234' })).statusCode).toBe(200);
  return who;
}

const wrongCodeFor = (code: string) => (code === '000000' ? '111111' : '000000');

describe('forgot PIN', () => {
  it('emails a code to my own address; the code clears PIN, lockout and app lock', async () => {
    const asha = await withPin();
    const chatId = await group(asha);
    await call(asha, 'PUT', `/v1/chats/${chatId}/lock`, { locked: true });
    await call(asha, 'PATCH', '/v1/me/lock/settings', {
      appLock: { enabled: true, idleMinutes: 5 },
    });
    for (let i = 0; i < 5; i++) await call(asha, 'POST', '/v1/me/lock/verify', { pin: '0000' });

    const sent = await request(asha);
    expect(resetPinRequestResponseSchema.parse(sent.json())).toEqual({ sent: true });
    const code = await readCode(asha);
    const stored = await lockModels(app()).Lock.findById(userOid(asha.id)).lean();
    expect(JSON.stringify(stored?.reset)).not.toContain(code);

    const done = await confirm(asha, code);
    expect(done.statusCode).toBe(200);
    expect(lockStatusResponseSchema.parse(done.json()).lock).toMatchObject({
      pinSet: false,
      appLock: { enabled: false },
      lockedUntil: null,
      attemptsLeft: 5,
    });
    expect((await call(asha, 'GET', `/v1/chats/${chatId}`)).json().chat.locked).toBe(true);
    // Used once only.
    expect((await confirm(asha, code)).json().code).toBe('OTP_EXPIRED');
  });

  it('counts wrong codes: 5 tries, then a new code is needed', async () => {
    const asha = await withPin();
    await request(asha);
    const code = await readCode(asha);
    const wrong = wrongCodeFor(code);
    const first = await confirm(asha, wrong);
    expect(first.statusCode).toBe(400);
    expect(first.json()).toMatchObject({ code: 'OTP_INVALID', details: { attemptsLeft: 4 } });
    for (let i = 0; i < 4; i++) await confirm(asha, wrong);
    const exceeded = await confirm(asha, code);
    expect(exceeded.statusCode).toBe(429);
    expect(exceeded.json().code).toBe('OTP_ATTEMPTS_EXCEEDED');
  });

  it('expires after 10 minutes', async () => {
    const asha = await withPin();
    const start = Date.now();
    vi.spyOn(lockClock, 'now').mockReturnValue(new Date(start));
    await request(asha);
    const code = await readCode(asha);
    vi.spyOn(lockClock, 'now').mockReturnValue(new Date(start + 10 * 60_000 + 1000));
    const late = await confirm(asha, code);
    expect(late.statusCode).toBe(400);
    expect(late.json().code).toBe('OTP_EXPIRED');
  });

  it('has a 60 s cooldown and at most 5 codes an hour; only the newest code works', async () => {
    const asha = await withPin();
    await request(asha);
    const first = await readCode(asha);
    const again = await request(asha);
    expect(again.statusCode).toBe(429);
    expect(again.json().code).toBe('RATE_LIMITED');
    await clearCooldown(asha);
    await request(asha);
    const second = await readCode(asha, first);
    for (let i = 0; i < 3; i++) {
      await clearCooldown(asha);
      expect((await request(asha)).statusCode).toBe(200);
    }
    await clearCooldown(asha);
    expect((await request(asha)).json().code).toBe('RATE_LIMITED');
    const latest = await readCode(asha, second);
    if (first !== latest) expect((await confirm(asha, first)).json().code).toBe('OTP_INVALID');
  });

  it('needs a PIN to reset, a session, and a 6-digit code', async () => {
    const asha = await person();
    expect((await request(asha)).json().code).toBe('PIN_NOT_SET');
    expect((await confirm(asha, '123456')).json().code).toBe('OTP_EXPIRED');
    expect((await confirm(asha, '12345')).statusCode).toBe(400);
    expect((await confirm(asha, 'abcdef')).statusCode).toBe(400);
    expect((await request(null)).statusCode).toBe(401);
    expect((await confirm(null, '123456')).statusCode).toBe(401);
  });

  it("my code never resets someone else's PIN", async () => {
    const [asha, bharat] = [await withPin(), await withPin()];
    await request(asha);
    const code = await readCode(asha);
    expect((await confirm(bharat, code)).json().code).toBe('OTP_EXPIRED');
    expect((await call(bharat, 'GET', '/v1/me/lock')).json().lock.pinSet).toBe(true);
    expect((await call(asha, 'GET', '/v1/me/lock')).json().lock.pinSet).toBe(true);
  });
});

describe('reset email', () => {
  it('names the brand from config and says how long the code lasts', async () => {
    const message = await lockResetEmail('a@corremadvisory.com', {
      code: '123456',
      expiresAt: new Date('2026-11-12T10:10:00.000Z'),
      minutes: 10,
    });
    expect(message.subject).toMatch(/^123456 is your .+ PIN reset code$/);
    expect(message.text).toContain('expires in 10 minutes');
    expect(message.html).toContain('123456');
  });
});
