import { DEFAULT_QUIET_HOURS, type QuietHours, quietHoursResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import {
  isKnownTimezone,
  quietHoursFor,
  toQuietHours,
} from '../../settings/quiet-hours.service.ts';
import { usersModel } from '../../users/user-record.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const put = (who: Person | null, body: object) => call(who, 'PUT', '/v1/me/quiet-hours', body);
const scheduled = (changes: Partial<QuietHours> = {}): QuietHours => ({
  ...DEFAULT_QUIET_HOURS,
  mode: 'scheduled',
  start: '23:00',
  end: '07:00',
  timezone: 'Europe/London',
  ...changes,
});

describe('quiet hours helpers', () => {
  it('know real time zones', () => {
    expect(isKnownTimezone('Asia/Kolkata')).toBe(true);
    expect(isKnownTimezone('UTC')).toBe(true);
    expect(isKnownTimezone('Mars/Olympus_Mons')).toBe(false);
  });

  it('fall back to the defaults for missing or unreadable settings', () => {
    expect(toQuietHours(null)).toEqual(DEFAULT_QUIET_HOURS);
    expect(toQuietHours({ mode: 'on' })).toEqual({ ...DEFAULT_QUIET_HOURS, mode: 'on' });
    expect(toQuietHours({ start: '25:99' } as Partial<QuietHours>)).toEqual(DEFAULT_QUIET_HOURS);
  });
});

describe('GET/PUT /v1/me/quiet-hours', () => {
  it('starts with the defaults, then keeps mine', async () => {
    const asha = await person();
    const first = await call(asha, 'GET', '/v1/me/quiet-hours');
    expect(quietHoursResponseSchema.parse(first.json()).quietHours).toEqual(DEFAULT_QUIET_HOURS);
    const chatId = await group(asha);
    const body = scheduled({ days: [5, 1, 1], allowChatIds: [chatId, chatId] });
    const saved = await put(asha, body);
    expect(saved.statusCode).toBe(200);
    const expected = { ...body, days: [1, 5], allowChatIds: [chatId] };
    expect(quietHoursResponseSchema.parse(saved.json()).quietHours).toEqual(expected);
    expect(await quietHoursFor(app(), asha.id)).toEqual(expected);
  });

  it('refuses an unknown time zone and bad input', async () => {
    const asha = await person();
    const zone = await put(asha, scheduled({ timezone: 'Mars/Olympus_Mons' }));
    expect(zone.statusCode).toBe(400);
    expect(zone.json().details).toMatchObject({ field: 'timezone' });
    expect((await put(asha, { ...scheduled(), start: '24:00' })).statusCode).toBe(400);
    expect((await put(asha, { ...scheduled(), mode: 'sometimes' })).statusCode).toBe(400);
    expect((await put(asha, { ...scheduled(), days: [7] })).statusCode).toBe(400);
    expect((await put(asha, { mode: 'on' })).statusCode).toBe(400);
  });

  it("refuses exceptions for chats that aren't mine (400, nothing saved)", async () => {
    const [asha, bharat] = [await person(), await person()];
    const bharatsChat = await group(bharat);
    const refused = await put(asha, scheduled({ allowChatIds: [bharatsChat] }));
    expect(refused.statusCode).toBe(400);
    expect((await quietHoursFor(app(), asha.id)).allowChatIds).toEqual([]);
    const unknown = await put(asha, scheduled({ allowChatIds: ['0123456789abcdef01234567'] }));
    expect(unknown.statusCode).toBe(400);
  });

  it("is mine alone: one person's settings never change another's", async () => {
    const [asha, bharat] = [await person(), await person()];
    await put(asha, scheduled({ mode: 'on' }));
    expect((await quietHoursFor(app(), bharat.id)).mode).toBe('off');
  });

  it('tells my other devices', async () => {
    const asha = await person();
    const socket = await connect(await listen(app()), asha.cookie);
    const events = record(socket, 'quiet-hours:updated');
    await put(asha, scheduled());
    await waitUntil(() => expect(events.at(-1)?.quietHours).toEqual(scheduled()));
  });

  it('needs a session', async () => {
    expect((await call(null, 'GET', '/v1/me/quiet-hours')).statusCode).toBe(401);
    expect((await put(null, scheduled())).statusCode).toBe(401);
  });

  it('reads by user id through an index', async () => {
    const asha = await person();
    await expectIndexedQuery(usersModel(app()).find({ _id: asha.id }).select({ quietHours: 1 }));
  });
});
