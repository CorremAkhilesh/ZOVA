import {
  activeCallResponseSchema,
  callAccessResponseSchema,
  iceResponseSchema,
  pushPayloadSchema,
} from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { callClient, type Person } from '../../../test/call-helpers.ts';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { pushesTo, subscribeDevice } from '../../../test/push-helpers.ts';
import { closeAllSockets, listen, signedIn, waitUntil } from '../../../test/realtime-helpers.ts';
import { callModels } from '../../calls/call-finish.ts';
import { CALL_START_LIMIT } from '../../calls/calls.service.ts';
import { usersModel } from '../../users/user-record.ts';

// Who may call whom. The flag (admins and test accounts only, by default), blocks, hidden admins,
// deactivated accounts and groups; the REST side (access, ICE, the ringing call, the history); the
// notifications; and the indexes behind every call query.

const TESTER = `tester-${Date.now()}@corremadvisory.com`;
const TESTER2 = `tester2-${Date.now()}@corremadvisory.com`;
let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, device, request, direct, emit, next, connectedCall } = callClient(app, () => url);

beforeAll(async () => {
  // The default flag: admins (ADMIN_EMAILS = admin@…) and CALLS_TEST_EMAILS only.
  built = await buildTestApp(
    {},
    { OTP_IP_LIMIT_PER_HOUR: '1000', CALLS_TEST_EMAILS: `${TESTER},${TESTER2}` },
  );
  url = await listen(app());
});
afterEach(() => closeAllSockets());
afterAll(async () => {
  await built.cleanup();
});

const signedInAs = (email: string): Promise<Person> => signedIn(app(), email);
/** The hidden admin (ADMIN_EMAILS). */
const hiddenAdmin = () => signedInAs('admin@corremadvisory.com');
/** A fresh admin (the role, not an ADMIN_EMAILS account): calls are on, nothing hidden. */
async function admin(): Promise<Person> {
  const who = await person('boss');
  await usersModel(app()).updateOne({ _id: who.id }, { $set: { role: 'admin' } });
  return who;
}
const tester = () => signedInAs(TESTER);
const tester2 = () => signedInAs(TESTER2);
const codeOf = (ack: { ok: boolean; error?: { code: string } }) =>
  ack.ok ? 'ok' : ack.error?.code;
const start = async (who: Person, chatId: string) =>
  codeOf(await emit(await device(who), 'call:start', { chatId, kind: 'voice' }));
const access = async (who: Person | null) => {
  const response = await request(who, 'GET', '/v1/calls/access');
  return response.statusCode === 200
    ? callAccessResponseSchema.parse(response.json()).enabled
    : response.statusCode;
};

describe('the feature flag', () => {
  it('admins and test accounts may call; everyone else sees no call button and is refused', async () => {
    const [boss, test, normal] = [await admin(), await tester(), await person('normal')];
    expect(await access(boss)).toBe(true);
    expect(await access(test)).toBe(true);
    expect(await access(normal)).toBe(false);
    expect(await access(null)).toBe(401);
    expect((await request(normal, 'GET', '/v1/calls/ice')).statusCode).toBe(403);

    expect(await start(normal, await direct(normal, test))).toBe('CALLS_UNAVAILABLE');
    // Nor can they be rung while calls are being tested.
    expect(await start(test, await direct(test, normal))).toBe('CALLS_UNAVAILABLE');
    const chat = await direct(test, boss);
    const callee = await device(boss);
    const ringing = next(callee, 'call:incoming');
    const caller = await device(test);
    const started = await emit(caller, 'call:start', { chatId: chat, kind: 'voice' });
    expect(codeOf(started)).toBe('ok');
    await ringing;
    if (started.ok) await emit(caller, 'call:end', { callId: started.data.call.id });
  });
});

describe('who may be called', () => {
  it('nobody across a block, either way', async () => {
    const [one, two] = [await tester(), await tester2()];
    const chat = await direct(one, two);
    expect((await request(two, 'PUT', `/v1/me/blocks/${one.id}`)).statusCode).toBe(200);
    expect(await start(one, chat)).toBe('CANNOT_MESSAGE');
    expect(await start(two, chat)).toBe('BLOCKED');
    await request(two, 'DELETE', `/v1/me/blocks/${one.id}`);
  });

  it('a hidden admin cannot be called by someone who is not an admin; the admin can call them', async () => {
    const boss = await hiddenAdmin();
    const test = await tester();
    // ADMIN_EMAILS accounts are hidden admins; the chat is the admin's (a normal user cannot start one).
    const chat = await direct(boss, test);
    expect(await start(test, chat)).toBe('CANNOT_MESSAGE');
    const caller = await device(boss);
    const started = await emit(caller, 'call:start', { chatId: chat, kind: 'voice' });
    expect(codeOf(started)).toBe('ok');
    if (started.ok) await emit(caller, 'call:end', { callId: started.data.call.id });
  });

  it('not in a group, not a chat I am not in, and nothing invalid', async () => {
    const boss = await admin();
    const test = await tester();
    const group = await request(boss, 'POST', '/v1/groups', { name: 'G', memberIds: [test.id] });
    expect(await start(boss, group.json().chat.id)).toBe('BAD_REQUEST');
    const stranger = await person('stranger');
    const theirs = await direct(stranger, await person('other'));
    expect(await start(boss, theirs)).toBe('NOT_FOUND');
    expect(
      codeOf(await emit(await device(boss), 'call:start', { chatId: 'x', kind: 'voice' } as never)),
    ).toBe('VALIDATION_FAILED');
    expect(
      codeOf(
        await emit(await device(boss), 'call:accept', { callId: new Types.ObjectId().toString() }),
      ),
    ).toBe('NOT_FOUND');
  });

  it('is rate limited per person', async () => {
    const boss = await admin();
    const chat = await direct(boss, await tester());
    const phone = await device(boss);
    const codes: string[] = [];
    for (let n = 0; n <= CALL_START_LIMIT.max; n++) {
      const started = await emit(phone, 'call:start', { chatId: chat, kind: 'voice' });
      codes.push(codeOf(started) ?? '');
      if (started.ok) await emit(phone, 'call:end', { callId: started.data.call.id });
    }
    expect(codes.at(-1)).toBe('RATE_LIMITED');
  });
});

describe('when the app is closed, and quiet hours', () => {
  it('pushes "incoming" to the callee, then "missed" with the same tag', async () => {
    const callee = await admin();
    await subscribeDevice(app(), callee.cookie);
    const caller = await admin();
    const chat = await direct(caller, callee);
    const phone = await device(caller);
    const started = await emit(phone, 'call:start', { chatId: chat, kind: 'voice' });
    if (!started.ok) throw new Error(started.error.code);
    const callId = started.data.call.id;
    await waitUntil(() => expect(pushesTo(app(), callee.id)).toHaveLength(1));
    await app().callTimers.fire(callId);
    await waitUntil(() => expect(pushesTo(app(), callee.id)).toHaveLength(2));
    const [incoming, missed] = pushesTo(app(), callee.id).map((push) =>
      pushPayloadSchema.parse(push.payload),
    );
    expect(incoming).toMatchObject({ kind: 'call', state: 'incoming', tag: `call:${callId}` });
    expect(missed).toMatchObject({ kind: 'call', state: 'missed', tag: `call:${callId}` });
  });

  it('rings silently during quiet hours', async () => {
    const boss = await admin();
    const test = await tester();
    const chat = await direct(boss, test);
    const quiet = await request(test, 'GET', '/v1/me/quiet-hours');
    await request(test, 'PUT', '/v1/me/quiet-hours', { ...quiet.json().quietHours, mode: 'on' });
    const callee = await device(test);
    const incoming = next(callee, 'call:incoming');
    const caller = await device(boss);
    const started = await emit(caller, 'call:start', { chatId: chat, kind: 'voice' });
    expect((await incoming).silent).toBe(true);
    await request(test, 'PUT', '/v1/me/quiet-hours', { ...quiet.json().quietHours, mode: 'off' });
    if (started.ok) await emit(caller, 'call:end', { callId: started.data.call.id });
  });
});

describe('the REST side', () => {
  it('ICE servers: STUN only without TURN, never cached', async () => {
    const response = await request(await admin(), 'GET', '/v1/calls/ice');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const ice = iceResponseSchema.parse(response.json());
    expect(ice.ttlSeconds).toBe(0);
    expect(ice.iceServers.every((server) => server.credential === undefined)).toBe(true);
  });

  it('the ringing call, for a device that opens from the notification; nobody else sees it', async () => {
    const boss = await admin();
    const test = await tester();
    const chat = await direct(boss, test);
    const phone = await device(boss);
    const started = await emit(phone, 'call:start', { chatId: chat, kind: 'voice' });
    if (!started.ok) throw new Error(started.error.code);
    const active = activeCallResponseSchema.parse(
      (await request(test, 'GET', '/v1/calls/active')).json(),
    );
    expect(active.call?.id).toBe(started.data.call.id);
    const other = activeCallResponseSchema.parse(
      (await request(await person('nosy'), 'GET', '/v1/calls/active')).json(),
    );
    expect(other.call).toBeNull();
    expect((await request(null, 'GET', '/v1/calls')).statusCode).toBe(401);
    await emit(phone, 'call:end', { callId: started.data.call.id });
  });

  it('history pages by cursor and shows only my calls', async () => {
    const boss = await admin();
    const test = await tester();
    const chat = await direct(boss, test);
    const [a, b] = [await device(boss), await device(test)];
    for (let n = 0; n < 3; n++)
      await emit(a, 'call:end', { callId: await connectedCall(a, b, chat) });
    const first = (await request(test, 'GET', '/v1/calls?limit=2')).json();
    expect(first.items).toHaveLength(2);
    const second = (
      await request(test, 'GET', `/v1/calls?limit=2&before=${first.nextCursor}`)
    ).json();
    expect(second.items.length).toBeGreaterThan(0);
    const stranger = (await request(await person('stranger'), 'GET', '/v1/calls')).json();
    expect(stranger.items).toEqual([]);
  });
});

describe('indexes', () => {
  it('every call query is served by an index', async () => {
    const { Call } = callModels(app());
    const me = new Types.ObjectId();
    await expectIndexedQuery(
      Call.find({ userIds: me, status: 'ended', _id: { $lt: new Types.ObjectId() } })
        .sort({ _id: -1 })
        .limit(51),
    );
    await expectIndexedQuery(Call.find({ userIds: me, status: { $in: ['ringing', 'active'] } }));
    await expectIndexedQuery(
      Call.find({ _id: new Types.ObjectId(), calleeId: me, status: 'ringing' }),
    );
    await expectIndexedQuery(
      Call.find({ _id: new Types.ObjectId(), userIds: me, status: 'active' }),
    );
  });
});
