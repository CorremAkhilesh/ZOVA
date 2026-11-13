import { chatResponseSchema, chatSettingsResponseSchema, syncResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../../test/realtime-helpers.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => built.app;
const { person, call, group, say, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const settingsOf = async (who: Person) => {
  const response = await call(who, 'GET', '/v1/me/chat-settings');
  expect(response.statusCode).toBe(200);
  return chatSettingsResponseSchema.parse(response.json()).settings;
};
const keepArchived = (who: Person, keepChatsArchived: boolean) =>
  call(who, 'PATCH', '/v1/me/chat-settings', { keepChatsArchived });
const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const archive = (who: Person, chatId: string) =>
  call(who, 'PATCH', `/v1/chats/${chatId}/prefs`, { archived: true });

describe('chat settings', () => {
  it('keep chats archived is on by default, and can be turned off and on', async () => {
    const asha = await person();
    expect(await settingsOf(asha)).toEqual({ keepChatsArchived: true });
    const off = await keepArchived(asha, false);
    expect(off.statusCode).toBe(200);
    expect(chatSettingsResponseSchema.parse(off.json()).settings.keepChatsArchived).toBe(false);
    expect(await settingsOf(asha)).toEqual({ keepChatsArchived: false });
    await keepArchived(asha, true);
    expect(await settingsOf(asha)).toEqual({ keepChatsArchived: true });
  });

  it('refuses bad input and the signed out', async () => {
    const asha = await person();
    expect((await call(asha, 'PATCH', '/v1/me/chat-settings', {})).statusCode).toBe(400);
    expect(
      (await call(asha, 'PATCH', '/v1/me/chat-settings', { keepChatsArchived: 'no' })).statusCode,
    ).toBe(400);
    expect((await call(null, 'GET', '/v1/me/chat-settings')).statusCode).toBe(401);
    expect((await keepArchived(null as never, false)).statusCode).toBe(401);
  });

  it('are mine alone: changing mine leaves everyone else as they were', async () => {
    const [asha, bharat] = [await person(), await person()];
    await keepArchived(asha, false);
    expect(await settingsOf(bharat)).toEqual({ keepChatsArchived: true });
  });

  it('reach my other devices at once', async () => {
    const asha = await person();
    const other = await connect(url, asha.cookie);
    const heard = record(other, 'settings:updated');
    await keepArchived(asha, false);
    await waitUntil(() => expect(heard).toEqual([{ settings: { keepChatsArchived: false } }]));
  });
});

describe('an archived chat and a new message', () => {
  it('stays archived while keep chats archived is on (the default)', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await say(asha, chatId, 'hello');
    await archive(bharat, chatId);
    await say(asha, chatId, 'are you there?');
    expect((await summary(bharat, chatId)).archived).toBe(true);
  });

  it('comes back for the person who turned it off, live and through sync', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await say(asha, chatId, 'hello');
    await archive(bharat, chatId);
    await keepArchived(bharat, false);
    const since = syncResponseSchema.parse((await call(bharat, 'GET', '/v1/sync')).json()).cursor;
    const socket = await connect(url, bharat.cookie);
    const updates = record(socket, 'chat:updated');

    await say(asha, chatId, 'are you there?');
    expect((await summary(bharat, chatId)).archived).toBe(false);
    await waitUntil(() =>
      expect(updates.some((update) => update.chatId === chatId && update.archived === false)).toBe(
        true,
      ),
    );
    const sync = syncResponseSchema.parse(
      (await call(bharat, 'GET', `/v1/sync?since=${since}`)).json(),
    );
    expect(sync.chats.find((chat) => chat.id === chatId)?.archived).toBe(false);
  });

  it('never for the sender, and only for members who turned it off', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat, chitra]);
    for (const who of [asha, bharat, chitra]) await archive(who, chatId);
    await keepArchived(asha, false);
    await keepArchived(bharat, false);
    await say(asha, chatId, 'my own message');
    expect((await summary(asha, chatId)).archived).toBe(true);
    expect((await summary(bharat, chatId)).archived).toBe(false);
    expect((await summary(chitra, chatId)).archived).toBe(true);
  });
});
