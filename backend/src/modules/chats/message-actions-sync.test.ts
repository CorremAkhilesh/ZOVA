import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { closeAllSockets } from '../../../test/realtime-helpers.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const add = (who: Person, chatId: string, target: Person) =>
  call(who, 'POST', `/v1/chats/${chatId}/members`, { userIds: [target.id] });
const direct = async (who: Person, other: Person) =>
  (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json().chat.id as string;
const url = (chatId: string, messageId: string, tail = '') =>
  `/v1/chats/${chatId}/messages/${messageId}${tail}`;

const cursorOf = async (who: Person) =>
  (await call(who, 'GET', '/v1/sync')).json().cursor as string;
const syncFrom = async (who: Person, cursor: string) => {
  const response = await call(who, 'GET', `/v1/sync?since=${cursor}`);
  expect(response.statusCode).toBe(200);
  return response.json();
};

describe('a device that was offline catches up on', () => {
  it('an edit, a reaction and a delete for everyone, each message once, as it is now', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const edited = await say(asha, chatId, 'one');
    const deleted = await say(asha, chatId, 'two');
    const cursor = await cursorOf(bharat);
    await call(asha, 'PATCH', url(chatId, edited.message.id), { text: 'one!' });
    await call(asha, 'PUT', url(chatId, edited.message.id, '/reaction'), { emoji: '👍' });
    await call(asha, 'DELETE', url(chatId, deleted.message.id, '?scope=everyone'));
    const sync = await syncFrom(bharat, cursor);
    expect(sync.reset).toBe(false);
    const byId = new Map(sync.updated.map((item: { id: string }) => [item.id, item]));
    expect(sync.updated).toHaveLength(2);
    expect(byId.get(edited.message.id)).toMatchObject({ text: 'one!' });
    expect(byId.get(deleted.message.id)).toMatchObject({ text: null });
  });

  it('what I deleted for me on another device, and stays deleted', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(bharat, chatId, 'hide me');
    const cursor = await cursorOf(asha);
    await call(asha, 'DELETE', url(chatId, message.id, '?scope=me'));
    await call(bharat, 'PATCH', url(chatId, message.id), { text: 'changed' });
    const sync = await syncFrom(asha, cursor);
    expect(sync.removed).toEqual([{ chatId, seq: message.seq }]);
    expect(sync.updated).toEqual([]);
  });

  it('a star, for me and not for others', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(bharat, chatId, 'keep');
    const mine = await cursorOf(asha);
    const theirs = await cursorOf(bharat);
    await call(asha, 'PUT', url(chatId, message.id, '/star'));
    expect((await syncFrom(asha, mine)).updated[0]).toMatchObject({ starred: true });
    expect((await syncFrom(bharat, theirs)).updated).toEqual([]);
  });

  it('a pin and a clear and a deleted chat', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await say(bharat, chatId, 'hello');
    const cursor = await cursorOf(asha);
    await call(asha, 'PATCH', `/v1/chats/${chatId}/prefs`, { pinned: true });
    const pinned = await syncFrom(asha, cursor);
    expect(pinned.chats[0]).toMatchObject({ id: chatId, pinned: true });
    await call(asha, 'POST', `/v1/chats/${chatId}/clear`);
    const cleared = await syncFrom(asha, pinned.cursor);
    expect(cleared.cleared).toEqual([{ chatId, seq: 1, removeChat: false }]);
    await call(asha, 'DELETE', `/v1/chats/${chatId}`);
    const removed = await syncFrom(asha, cleared.cursor);
    expect(removed.cleared).toEqual([{ chatId, seq: 1, removeChat: true }]);
    expect(removed.chats).toEqual([]);
  });

  it('only what they could see: a late joiner hears nothing of older messages', async () => {
    const [owner, late] = [await person(), await person()];
    const room = await group(owner);
    const { message } = await say(owner, room, 'before');
    await add(owner, room, late);
    const cursor = await cursorOf(late);
    await call(owner, 'PATCH', url(room, message.id), { text: 'edited' });
    const sync = await syncFrom(late, cursor);
    expect(JSON.stringify(sync.updated)).not.toContain('edited');
  });

  it('someone who left still loses a deleted message from their copy', async () => {
    const [owner, leaver] = [await person(), await person()];
    const room = await group(owner, [leaver]);
    const { message } = await say(owner, room, 'secret');
    await call(leaver, 'POST', `/v1/chats/${room}/leave`);
    const cursor = await cursorOf(leaver);
    await call(owner, 'DELETE', url(room, message.id, '?scope=everyone'));
    const sync = await syncFrom(leaver, cursor);
    expect(sync.updated[0]).toMatchObject({ id: message.id, text: null });
    expect((await summary(leaver, room)).seq).toBeLessThanOrEqual(message.seq + 1);
  });
});
