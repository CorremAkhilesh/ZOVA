import { chatResponseSchema, lockStatusResponseSchema } from '@zuvo/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { lockClock, lockModels, userOid } from '../../lock/lock-store.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const lockOf = async (who: Person) =>
  lockStatusResponseSchema.parse((await call(who, 'GET', '/v1/me/lock')).json()).lock;
const setPin = (who: Person | null, pin: string, currentPin?: string) =>
  call(who, 'PUT', '/v1/me/lock/pin', { pin, ...(currentPin ? { currentPin } : {}) });
const verify = (who: Person | null, pin: string) =>
  call(who, 'POST', '/v1/me/lock/verify', { pin });
const withPin = async (pin = '1234') => {
  const who = await person();
  expect((await setPin(who, pin)).statusCode).toBe(200);
  return who;
};
/** Moves the lock's clock to `at` (lockouts and expiries without waiting). */
const clockAt = (at: number) => vi.spyOn(lockClock, 'now').mockReturnValue(new Date(at));

describe('PIN', () => {
  it('is stored only as an argon2id hash and never returned', async () => {
    const asha = await person();
    expect(await lockOf(asha)).toMatchObject({ pinSet: false, biometricCount: 0 });
    const response = await setPin(asha, '482915');
    expect(response.statusCode).toBe(200);
    expect(lockStatusResponseSchema.parse(response.json()).lock.pinSet).toBe(true);
    expect(response.body).not.toContain('482915');
    expect(response.body).not.toContain('argon2');
    const stored = await lockModels(app()).Lock.findById(userOid(asha.id)).lean();
    expect(stored?.pinHash).toMatch(/^\$argon2id\$/);
  });

  it('changing needs the current PIN, and a wrong one counts as a try', async () => {
    const asha = await withPin('1234');
    expect((await setPin(asha, '5678')).statusCode).toBe(400);
    const wrong = await setPin(asha, '5678', '0000');
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ code: 'PIN_INVALID', details: { attemptsLeft: 4 } });
    expect((await setPin(asha, '5678', '1234')).statusCode).toBe(200);
    expect((await verify(asha, '1234')).statusCode).toBe(403);
    expect((await verify(asha, '5678')).statusCode).toBe(200);
  });

  it('removing needs the PIN, turns app lock off and keeps locked chats flagged', async () => {
    const asha = await withPin('1234');
    const chatId = await group(asha);
    await call(asha, 'PUT', `/v1/chats/${chatId}/lock`, { locked: true });
    await call(asha, 'PATCH', '/v1/me/lock/settings', {
      appLock: { enabled: true, idleMinutes: 1 },
    });
    expect((await call(asha, 'DELETE', '/v1/me/lock/pin', { pin: '9999' })).statusCode).toBe(403);
    const removed = await call(asha, 'DELETE', '/v1/me/lock/pin', { pin: '1234' });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().lock).toMatchObject({ pinSet: false, appLock: { enabled: false } });
    const chat = chatResponseSchema.parse((await call(asha, 'GET', `/v1/chats/${chatId}`)).json());
    expect(chat.chat.locked).toBe(true);
    expect((await verify(asha, '1234')).json().code).toBe('PIN_NOT_SET');
  });

  it('refuses bad input', async () => {
    const asha = await person();
    for (const pin of ['123', '1234567', 'abcd', '12 34']) {
      expect((await setPin(asha, pin)).statusCode).toBe(400);
    }
    expect((await call(asha, 'POST', '/v1/me/lock/verify', {})).statusCode).toBe(400);
  });
});

describe('wrong PINs', () => {
  it('lock out after 5 tries, doubling from 1 minute; a lockout ignores even the right PIN', async () => {
    const asha = await withPin('1234');
    const start = Date.now();
    clockAt(start);
    for (let left = 4; left >= 1; left--) {
      const wrong = await verify(asha, '0000');
      expect(wrong.json()).toMatchObject({ code: 'PIN_INVALID', details: { attemptsLeft: left } });
    }
    const fifth = await verify(asha, '0000');
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json().code).toBe('PIN_LOCKED_OUT');
    expect(new Date(fifth.json().details.lockedUntil).getTime()).toBe(start + 60_000);
    const right = await verify(asha, '1234');
    expect(right.json().code).toBe('PIN_LOCKED_OUT');
    expect(await lockOf(asha)).toMatchObject({ attemptsLeft: 0 });

    clockAt(start + 61_000);
    for (let i = 0; i < 4; i++) await verify(asha, '0000');
    const second = await verify(asha, '0000');
    expect(new Date(second.json().details.lockedUntil).getTime()).toBe(start + 61_000 + 120_000);
  });

  it('a correct PIN starts the count again but keeps the lockout history', async () => {
    const asha = await withPin('1234');
    const start = Date.now();
    clockAt(start);
    for (let i = 0; i < 5; i++) await verify(asha, '0000');
    clockAt(start + 61_000);
    await verify(asha, '0000');
    expect((await verify(asha, '1234')).json().lock.attemptsLeft).toBe(5);
    for (let i = 0; i < 4; i++) await verify(asha, '0000');
    const again = await verify(asha, '0000');
    // The second lockout in a row lasts 2 minutes, not 1.
    expect(new Date(again.json().details.lockedUntil).getTime()).toBe(start + 61_000 + 120_000);
  });

  it('wrong PINs sent together are all counted', async () => {
    const asha = await withPin('1234');
    const results = await Promise.all(Array.from({ length: 7 }, () => verify(asha, '0000')));
    expect(results.filter((r) => r.json().code === 'PIN_LOCKED_OUT').length).toBeGreaterThan(0);
    expect(results.filter((r) => r.json().code === 'PIN_INVALID').length).toBe(4);
  });

  it('are rate limited per person', async () => {
    const asha = await withPin('1234');
    for (let i = 0; i < 20; i++) expect((await verify(asha, '1234')).statusCode).toBe(200);
    const limited = await verify(asha, '1234');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe('RATE_LIMITED');
  });
});

describe('app lock', () => {
  it('needs a PIN, and keeps the idle time', async () => {
    const asha = await person();
    const body = { appLock: { enabled: true, idleMinutes: 15 } };
    const refused = await call(asha, 'PATCH', '/v1/me/lock/settings', body);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('PIN_NOT_SET');
    await setPin(asha, '1234');
    const on = await call(asha, 'PATCH', '/v1/me/lock/settings', body);
    expect(lockStatusResponseSchema.parse(on.json()).lock.appLock).toEqual(body.appLock);
    const bad = { appLock: { enabled: true, idleMinutes: 7 } };
    expect((await call(asha, 'PATCH', '/v1/me/lock/settings', bad)).statusCode).toBe(400);
  });
});

describe('chat lock', () => {
  it('needs a PIN, is mine alone, and refuses outsiders', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const lock = (who: Person | null, locked: unknown) =>
      call(who, 'PUT', `/v1/chats/${chatId}/lock`, { locked });
    expect((await lock(asha, true)).json().code).toBe('PIN_NOT_SET');
    await setPin(asha, '1234');
    const locked = await lock(asha, true);
    expect(chatResponseSchema.parse(locked.json()).chat.locked).toBe(true);
    const bharatView = await call(bharat, 'GET', `/v1/chats/${chatId}`);
    expect(bharatView.json().chat.locked).toBe(false);
    expect((await lock(chitra, true)).statusCode).toBe(404);
    expect((await lock(asha, 'yes')).statusCode).toBe(400);
    expect((await call(asha, 'PUT', '/v1/chats/nope/lock', { locked: true })).statusCode).toBe(400);
    expect((await lock(asha, false)).json().chat.locked).toBe(false);
  });

  it('tells my devices', async () => {
    const asha = await withPin('1234');
    const chatId = await group(asha);
    const socket = await connect(await listen(app()), asha.cookie);
    const lockEvents = record(socket, 'lock:updated');
    const chatEvents = record(socket, 'chat:updated');
    await call(asha, 'PUT', `/v1/chats/${chatId}/lock`, { locked: true });
    await waitUntil(() => {
      expect(lockEvents.length).toBe(1);
      expect(chatEvents.at(-1)).toMatchObject({ chatId, locked: true });
    });
  });
});

describe('every lock route', () => {
  it('needs a session', async () => {
    const chatId = '0123456789abcdef01234567';
    const routes: Array<['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string]> = [
      ['GET', '/v1/me/lock'],
      ['PUT', '/v1/me/lock/pin'],
      ['DELETE', '/v1/me/lock/pin'],
      ['POST', '/v1/me/lock/verify'],
      ['PATCH', '/v1/me/lock/settings'],
      ['PUT', `/v1/chats/${chatId}/lock`],
      ['POST', '/v1/me/lock/reset/request'],
      ['POST', '/v1/me/lock/reset/verify'],
      ['POST', '/v1/me/lock/biometric/register/options'],
      ['POST', '/v1/me/lock/biometric/register/verify'],
      ['POST', '/v1/me/lock/biometric/unlock/options'],
      ['POST', '/v1/me/lock/biometric/unlock/verify'],
      ['DELETE', '/v1/me/lock/biometric'],
    ];
    for (const [method, url] of routes) {
      expect((await call(null, method, url, {})).statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
