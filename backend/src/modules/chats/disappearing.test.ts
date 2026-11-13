import {
  chatResponseSchema,
  chatUpdatedEventSchema,
  disappearingResponseSchema,
  messageNewEventSchema,
  privacyResponseSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient, systemKinds } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, call, group, say, history, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const setTimer = (who: Person | null, chatId: string, timer: unknown) =>
  call(who, 'PUT', `/v1/chats/${chatId}/disappearing`, { timer });
const setDefault = (who: Person, defaultDisappearing: string) =>
  call(who, 'PUT', '/v1/me/privacy', {
    lastSeen: 'everyone',
    profilePhoto: 'everyone',
    about: 'everyone',
    readReceipts: true,
    defaultDisappearing,
  });

describe('PUT /v1/chats/:id/disappearing', () => {
  it('in a 1:1 chat either person sets it; both devices hear, with a notice', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const [mine, theirs] = [await connect(url, asha.cookie), await connect(url, bharat.cookie)];
    const updates = [record(mine, 'chat:updated'), record(theirs, 'chat:updated')];
    const notices = [record(mine, 'message:new'), record(theirs, 'message:new')];

    const response = await setTimer(bharat, chatId, '24h');
    expect(response.statusCode).toBe(200);
    expect(disappearingResponseSchema.parse(response.json())).toEqual({ timer: '24h' });
    for (const [n, list] of updates.entries()) {
      await waitUntil(() => expect(list.length).toBeGreaterThan(0));
      expect(chatUpdatedEventSchema.parse(list.at(-1)).disappearing).toBe('24h');
      const notice = messageNewEventSchema.parse(notices[n]?.at(-1)).message.system;
      expect(notice).toMatchObject({ kind: 'disappearing_changed', value: '24h' });
      expect(notice?.actor?.id).toBe(bharat.id);
    }
    expect((await summary(asha, chatId)).disappearing).toBe('24h');
    expect((await setTimer(asha, chatId, 'off')).statusCode).toBe(200);
    expect((await summary(bharat, chatId)).disappearing ?? 'off').toBe('off');
  });

  it('the same timer again changes nothing and adds no notice', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await setTimer(asha, chatId, '7d');
    expect((await setTimer(bharat, chatId, '7d')).statusCode).toBe(200);
    expect((await setTimer(asha, chatId, 'off')).statusCode).toBe(200);
    expect((await setTimer(asha, chatId, 'off')).statusCode).toBe(200);
    const kinds = systemKinds(await history(asha, chatId));
    expect(kinds.filter((kind) => kind === 'disappearing_changed')).toHaveLength(2);
  });

  it('works in Saved Messages', async () => {
    const asha = await person();
    const saved = (await call(asha, 'GET', '/v1/chats/self')).json().chat.id as string;
    expect((await setTimer(asha, saved, '90d')).statusCode).toBe(200);
    expect((await summary(asha, saved)).disappearing).toBe('90d');
  });

  it('in a group, follows the "disappearing" setting: admins by default', async () => {
    const [owner, member] = [await person(), await person()];
    const chatId = await group(owner, [member]);
    expect((await setTimer(member, chatId, '24h')).statusCode).toBe(403);
    expect((await setTimer(owner, chatId, '24h')).statusCode).toBe(200);
    const settings = await call(owner, 'PUT', `/v1/chats/${chatId}/group/settings`, {
      disappearing: 'all',
    });
    expect(settings.statusCode).toBe(200);
    expect(chatResponseSchema.parse(settings.json()).chat.group?.settings.disappearing).toBe('all');
    expect((await setTimer(member, chatId, '7d')).statusCode).toBe(200);
    expect((await summary(owner, chatId)).disappearing).toBe('7d');
  });

  it('refuses bad input, signed-out callers and non-members', async () => {
    const [asha, bharat, stranger] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    expect((await setTimer(asha, chatId, '1h')).statusCode).toBe(400);
    expect((await call(asha, 'PUT', `/v1/chats/${chatId}/disappearing`, {})).statusCode).toBe(400);
    expect((await setTimer(asha, 'not-an-id', '24h')).statusCode).toBe(400);
    expect((await setTimer(null, chatId, '24h')).statusCode).toBe(401);
    expect((await setTimer(stranger, chatId, '24h')).statusCode).toBe(404);
    expect((await summary(asha, chatId)).disappearing ?? 'off').toBe('off');
  });
});

describe('expiry of new messages', () => {
  it('new messages get expiresAt; earlier ones keep none', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const before = (await say(asha, chatId, 'before')).message;
    await setTimer(asha, chatId, '24h');
    const after = (await say(bharat, chatId, 'after')).message;
    expect(before.expiresAt).toBeUndefined();
    const hours = (Date.parse(after.expiresAt ?? '') - Date.parse(after.createdAt)) / 3_600_000;
    expect(hours).toBe(24);
    const stored = await chatModels(app()).Message.findById(oid(before.id)).lean();
    expect(stored?.expiresAt ?? null).toBeNull();
    const listed = await history(asha, chatId);
    expect(listed.find((item) => item.id === before.id)?.expiresAt).toBeUndefined();
    expect(listed.find((item) => item.id === after.id)?.expiresAt).toBe(after.expiresAt);
  });
});

describe('default timer (privacy)', () => {
  it('is saved and returned with the other privacy settings', async () => {
    const asha = await person();
    expect((await setDefault(asha, '7d')).statusCode).toBe(200);
    const response = await call(asha, 'GET', '/v1/me/privacy');
    expect(privacyResponseSchema.parse(response.json()).privacy.defaultDisappearing).toBe('7d');
    expect((await setDefault(asha, 'forever')).statusCode).toBe(400);
  });

  it('starts a new 1:1 chat with it, quietly; an existing chat keeps its own', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const old = await direct(asha, chitra);
    await setDefault(asha, '90d');
    const chatId = await direct(asha, bharat);
    expect((await summary(asha, chatId)).disappearing).toBe('90d');
    expect(systemKinds(await history(asha, chatId))).toEqual([]);
    expect((await summary(asha, old)).disappearing ?? 'off').toBe('off');
    expect((await say(bharat, chatId, 'hi')).message.expiresAt).toBeDefined();
  });

  it('starts a new group with it, and the group is told', async () => {
    const [asha, bharat] = [await person(), await person()];
    await setDefault(asha, '24h');
    const chatId = await group(asha, [bharat]);
    expect((await summary(bharat, chatId)).disappearing).toBe('24h');
    expect(systemKinds(await history(bharat, chatId))).toEqual(['created', 'disappearing_changed']);
  });

  it('off by default', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    expect((await summary(asha, chatId)).disappearing ?? 'off').toBe('off');
    expect(systemKinds(await history(asha, chatId))).toEqual(['created']);
  });
});

describe('security', () => {
  it('a member of one chat cannot change another chat’s timer', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const theirs = await direct(bharat, chitra);
    await direct(asha, bharat);
    expect((await setTimer(asha, theirs, '24h')).statusCode).toBe(404);
    const groupId = await group(bharat, [chitra]);
    expect((await setTimer(asha, groupId, '24h')).statusCode).toBe(404);
  });
});
