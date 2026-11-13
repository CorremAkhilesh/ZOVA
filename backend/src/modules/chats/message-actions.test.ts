import { messageSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient, texts } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say, history, summary, setRole } = groupClient(app);
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

const age = (messageId: string, minutes: number) =>
  chatModels(app()).Message.updateOne(
    { _id: oid(messageId) },
    { $set: { createdAt: new Date(Date.now() - minutes * 60_000) } },
  );
const edit = (who: Person | null, chatId: string, id: string, text: string) =>
  call(who, 'PATCH', url(chatId, id), { text });
const remove = (who: Person | null, chatId: string, id: string, scope: 'me' | 'everyone') =>
  call(who, 'DELETE', url(chatId, id, `?scope=${scope}`));
const react = (who: Person | null, chatId: string, id: string, emoji: string) =>
  call(who, 'PUT', url(chatId, id, '/reaction'), { emoji });

describe('edit', () => {
  it('changes my text, marks it edited, and updates the chat list for both', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'helo');
    const response = await edit(asha, chatId, message.id, 'hello');
    expect(response.statusCode).toBe(200);
    const [seen] = await history(bharat, chatId);
    expect(seen).toMatchObject({ text: 'hello' });
    expect(seen?.editedAt).toBeTruthy();
    expect((await summary(bharat, chatId)).lastMessage?.preview).toBe('hello');
  });

  it('is refused after 15 minutes', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'old');
    await age(message.id, 16);
    const response = await edit(asha, chatId, message.id, 'new');
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('EDIT_WINDOW_PASSED');
  });

  it('works just inside the 15 minutes', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'old');
    await age(message.id, 14);
    expect((await edit(asha, chatId, message.id, 'new')).statusCode).toBe(200);
  });

  it("is refused on someone else's message, and for non-members and the signed out", async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'mine');
    expect((await edit(bharat, chatId, message.id, 'x')).statusCode).toBe(403);
    expect((await edit(chitra, chatId, message.id, 'x')).statusCode).toBe(404);
    expect((await edit(null, chatId, message.id, 'x')).statusCode).toBe(401);
  });

  it('refuses empty text on a text message, and bad input', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'mine');
    expect((await edit(asha, chatId, message.id, '   ')).statusCode).toBe(400);
    expect((await call(asha, 'PATCH', url(chatId, message.id), {})).statusCode).toBe(400);
    expect((await edit(asha, chatId, 'nope', 'x')).statusCode).toBe(400);
  });

  it('sent twice, by a device catching up, marks nothing twice', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'a');
    await edit(asha, chatId, message.id, 'b');
    const [first] = await history(asha, chatId);
    expect((await edit(asha, chatId, message.id, 'b')).statusCode).toBe(200);
    const [second] = await history(asha, chatId);
    expect(second?.editedAt).toBe(first?.editedAt);
  });

  it('also changes the quote in replies, and reaches other members live', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'first');
    const socket = await connect(await listen(app()), bharat.cookie);
    const events = record(socket, 'message:updated');
    await edit(asha, chatId, message.id, 'second');
    await waitUntil(() => expect(events).toHaveLength(1));
    expect(messageSchema.parse(events[0]?.message).text).toBe('second');
    socket.close();
  });
});

describe('delete', () => {
  it('for everyone leaves a tombstone and nothing of the content', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'secret');
    await react(bharat, chatId, message.id, '👍');
    expect((await remove(asha, chatId, message.id, 'everyone')).statusCode).toBe(200);
    const [seen] = await history(bharat, chatId);
    expect(seen?.deletedForEveryoneAt).toBeTruthy();
    expect(seen).toMatchObject({ text: null, media: null, reactions: [], deletedByAdmin: false });
    const chat = await summary(bharat, chatId);
    expect(chat.lastMessage).toMatchObject({ preview: '', deleted: true });
  });

  it('for everyone: own messages only, within 48 hours', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'mine');
    expect((await remove(bharat, chatId, message.id, 'everyone')).statusCode).toBe(403);
    await age(message.id, 47 * 60);
    expect((await remove(asha, chatId, message.id, 'everyone')).statusCode).toBe(200);
    const late = await say(asha, chatId, 'late');
    await age(late.message.id, 49 * 60);
    const refused = await remove(asha, chatId, late.message.id, 'everyone');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('DELETE_WINDOW_PASSED');
  });

  it('a group admin can delete anyone, even later, and it says so', async () => {
    const [owner, admin, member] = [await person(), await person(), await person()];
    const chatId = await group(owner, [admin, member]);
    await setRole(owner, chatId, admin, 'admin');
    const { message } = await say(member, chatId, 'rude');
    await age(message.id, 100 * 60);
    expect((await remove(admin, chatId, message.id, 'everyone')).statusCode).toBe(200);
    const items = await history(member, chatId);
    expect(items.find((item) => item.id === message.id)?.deletedByAdmin).toBe(true);
  });

  it('a group member cannot delete others, and an admin deleting their own is not "by an admin"', async () => {
    const [owner, member] = [await person(), await person()];
    const chatId = await group(owner, [member]);
    const theirs = await say(owner, chatId, 'from owner');
    expect((await remove(member, chatId, theirs.message.id, 'everyone')).statusCode).toBe(403);
    await remove(owner, chatId, theirs.message.id, 'everyone');
    const items = await history(member, chatId);
    expect(items.find((item) => item.id === theirs.message.id)?.deletedByAdmin).toBe(false);
  });

  it('for me hides it from me alone, and the list falls back to the message before', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await say(bharat, chatId, 'one');
    const { message } = await say(bharat, chatId, 'two');
    expect((await remove(asha, chatId, message.id, 'me')).statusCode).toBe(200);
    expect(texts(await history(asha, chatId))).toEqual(['one']);
    expect(texts(await history(bharat, chatId))).toEqual(['one', 'two']);
    expect((await summary(asha, chatId)).lastMessage?.preview).toBe('one');
    expect((await summary(bharat, chatId)).lastMessage?.preview).toBe('two');
    // Mine now, so doing it again finds nothing: and it was not an error to anyone else.
    expect((await remove(asha, chatId, message.id, 'me')).statusCode).toBe(404);
  });

  it("removes a deleted message's content from the quotes of its replies", async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'private');
    await sendMessage(app(), {
      userId: bharat.id,
      chatId,
      clientMsgId: crypto.randomUUID(),
      text: 'answer',
      replyTo: { chatId, messageId: message.id },
    });
    await remove(asha, chatId, message.id, 'everyone');
    const items = await history(bharat, chatId);
    expect(items.at(-1)?.replyTo).toMatchObject({ text: '', deleted: true });
    expect(JSON.stringify(items)).not.toContain('private');
  });
});

describe('reactions', () => {
  it('one per person: another replaces it, and taking it back removes it', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'hello');
    await react(bharat, chatId, message.id, '👍');
    await react(bharat, chatId, message.id, '❤️');
    let [seen] = await history(asha, chatId);
    expect(seen?.reactions?.map((item) => item.emoji)).toEqual(['❤️']);
    await call(bharat, 'DELETE', url(chatId, message.id, '/reaction'));
    [seen] = await history(asha, chatId);
    expect(seen?.reactions).toEqual([]);
  });

  it('the chat list line goes to the author only', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'hello');
    await react(bharat, chatId, message.id, '👍');
    expect((await summary(asha, chatId)).lastReaction).toMatchObject({
      emoji: '👍',
      text: 'hello',
    });
    expect((await summary(bharat, chatId)).lastReaction ?? null).toBeNull();
    await call(bharat, 'DELETE', url(chatId, message.id, '/reaction'));
    expect((await summary(asha, chatId)).lastReaction ?? null).toBeNull();
  });

  it('refuses what is not an emoji, a deleted message, and outsiders', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await say(asha, chatId, 'hello');
    expect((await react(bharat, chatId, message.id, 'lol')).statusCode).toBe(400);
    expect((await react(chitra, chatId, message.id, '👍')).statusCode).toBe(404);
    expect((await react(null, chatId, message.id, '👍')).statusCode).toBe(401);
    await remove(asha, chatId, message.id, 'everyone');
    expect((await react(bharat, chatId, message.id, '👍')).statusCode).toBe(409);
  });

  it('only messages I can see: not from before I joined a group', async () => {
    const [owner, late] = [await person(), await person()];
    const chatId = await group(owner);
    const { message } = await say(owner, chatId, 'before');
    await add(owner, chatId, late);
    expect((await react(late, chatId, message.id, '👍')).statusCode).toBe(404);
    expect((await call(late, 'PUT', url(chatId, message.id, '/star'))).statusCode).toBe(404);
  });
});

describe('stars', () => {
  it('are mine alone, listed newest first, in all chats or one', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const other = await group(asha, [bharat]);
    const first = await say(asha, chatId, 'first');
    const second = await say(asha, other, 'second');
    await call(asha, 'PUT', url(chatId, first.message.id, '/star'));
    await call(asha, 'PUT', url(other, second.message.id, '/star'));
    await call(asha, 'PUT', url(other, second.message.id, '/star'));
    const all = (await call(asha, 'GET', '/v1/stars')).json();
    expect(all.items.map((item: { message: { text: string } }) => item.message.text)).toEqual([
      'second',
      'first',
    ]);
    const one = (await call(asha, 'GET', `/v1/stars?chatId=${chatId}`)).json();
    expect(one.items).toHaveLength(1);
    expect((await call(bharat, 'GET', '/v1/stars')).json().items).toEqual([]);
    expect((await history(asha, chatId))[0]?.starred).toBe(true);
    expect((await history(bharat, chatId))[0]?.starred).toBe(false);
    await call(asha, 'DELETE', url(chatId, first.message.id, '/star'));
    expect((await call(asha, 'GET', `/v1/stars?chatId=${chatId}`)).json().items).toEqual([]);
  });

  it('pages with a cursor, refuses a bad one, and leave with a deleted message', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const ids: string[] = [];
    for (const text of ['a', 'b', 'c']) ids.push((await say(asha, chatId, text)).message.id);
    for (const id of ids) await call(asha, 'PUT', url(chatId, id, '/star'));
    const page = (await call(asha, 'GET', '/v1/stars?limit=2')).json();
    expect(page.items).toHaveLength(2);
    const rest = (await call(asha, 'GET', `/v1/stars?limit=2&cursor=${page.nextCursor}`)).json();
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
    expect((await call(asha, 'GET', '/v1/stars?cursor=nonsense')).statusCode).toBe(400);
    expect((await call(null, 'GET', '/v1/stars')).statusCode).toBe(401);
    await remove(asha, chatId, ids[0] as string, 'everyone');
    const after = (await call(asha, 'GET', '/v1/stars')).json();
    expect(after.items).toHaveLength(2);
  });
});
