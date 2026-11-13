import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient, texts } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { closeAllSockets } from '../../../test/realtime-helpers.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say, history, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const direct = async (who: Person, other: Person) =>
  (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json().chat.id as string;
const url = (chatId: string, messageId: string, tail = '') =>
  `/v1/chats/${chatId}/messages/${messageId}${tail}`;

const prefs = (who: Person | null, chatId: string, body: object) =>
  call(who, 'PATCH', `/v1/chats/${chatId}/prefs`, body);
const listIds = async (who: Person) =>
  (await call(who, 'GET', '/v1/chats')).json().items.map((chat: { id: string }) => chat.id);

describe('chat preferences', () => {
  it('pinning stops at 3, and repinning or unpinning is fine', async () => {
    const asha = await person();
    const chats = [await group(asha), await group(asha), await group(asha), await group(asha)];
    for (const chatId of chats.slice(0, 3)) {
      expect((await prefs(asha, chatId, { pinned: true })).statusCode).toBe(200);
    }
    const refused = await prefs(asha, chats[3] as string, { pinned: true });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('PIN_LIMIT_REACHED');
    expect((await prefs(asha, chats[0] as string, { pinned: true })).statusCode).toBe(200);
    await prefs(asha, chats[0] as string, { pinned: false });
    const pinned = await prefs(asha, chats[3] as string, { pinned: true });
    expect(pinned.json().chat.pinned).toBe(true);
  });

  it('mute has the three lengths and off', async () => {
    const asha = await person();
    const chatId = await group(asha);
    const eight = (await prefs(asha, chatId, { mute: '8h' })).json().chat.mutedUntil;
    expect(new Date(eight).getTime() - Date.now()).toBeGreaterThan(7.9 * 3_600_000);
    expect(new Date(eight).getTime() - Date.now()).toBeLessThan(8.1 * 3_600_000);
    const week = (await prefs(asha, chatId, { mute: '1w' })).json().chat.mutedUntil;
    expect(new Date(week).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    const always = (await prefs(asha, chatId, { mute: 'always' })).json().chat.mutedUntil;
    expect(new Date(always).getFullYear()).toBeGreaterThan(9000);
    expect((await prefs(asha, chatId, { mute: 'off' })).json().chat.mutedUntil).toBeNull();
  });

  it('are mine alone, and refuse bad input, outsiders and the signed out', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    await say(asha, chatId, 'hello');
    await prefs(asha, chatId, { archived: true, unread: true });
    expect(await summary(asha, chatId)).toMatchObject({ archived: true, markedUnread: true });
    expect(await summary(bharat, chatId)).toMatchObject({ archived: false, markedUnread: false });
    expect((await prefs(asha, chatId, { mute: 'forever' })).statusCode).toBe(400);
    expect((await prefs(chitra, chatId, { archived: true })).statusCode).toBe(404);
    expect((await prefs(null, chatId, { archived: true })).statusCode).toBe(401);
  });

  it('an archived chat stays archived when new messages arrive', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await say(bharat, chatId, 'one');
    await prefs(asha, chatId, { archived: true });
    await say(bharat, chatId, 'two');
    const chat = await summary(asha, chatId);
    expect(chat).toMatchObject({ archived: true, unreadCount: 2 });
    expect(chat.lastMessage?.preview).toBe('two');
    await prefs(asha, chatId, { archived: false });
    expect((await summary(asha, chatId)).archived).toBe(false);
  });
});

describe('clear and delete', () => {
  it('clear hides everything so far for me only; what comes next shows', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(bharat, chatId, 'old');
    await call(asha, 'PUT', url(chatId, message.id, '/star'));
    expect((await call(asha, 'POST', `/v1/chats/${chatId}/clear`)).statusCode).toBe(200);
    expect(await history(asha, chatId)).toEqual([]);
    expect(texts(await history(bharat, chatId))).toEqual(['old']);
    expect((await summary(asha, chatId)).lastMessage).toBeNull();
    expect((await call(asha, 'GET', '/v1/stars')).json().items).toEqual([]);
    expect((await call(asha, 'PUT', url(chatId, message.id, '/star'))).statusCode).toBe(404);
    await say(bharat, chatId, 'new');
    expect(texts(await history(asha, chatId))).toEqual(['new']);
    expect((await summary(asha, chatId)).unreadCount).toBe(1);
  });

  it('delete takes a 1:1 chat out of my list, until someone writes again', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await say(bharat, chatId, 'old');
    expect((await call(asha, 'DELETE', `/v1/chats/${chatId}`)).statusCode).toBe(200);
    expect(await listIds(asha)).not.toContain(chatId);
    expect(await listIds(bharat)).toContain(chatId);
    await say(bharat, chatId, 'new');
    expect(await listIds(asha)).toContain(chatId);
    expect(texts(await history(asha, chatId))).toEqual(['new']);
  });

  it('a group cannot be deleted this way; outsiders and the signed out get nothing', async () => {
    const [asha, chitra] = [await person(), await person()];
    const chatId = await group(asha);
    expect((await call(asha, 'DELETE', `/v1/chats/${chatId}`)).statusCode).toBe(400);
    expect((await call(chitra, 'POST', `/v1/chats/${chatId}/clear`)).statusCode).toBe(404);
    expect((await call(null, 'POST', `/v1/chats/${chatId}/clear`)).statusCode).toBe(401);
  });
});
