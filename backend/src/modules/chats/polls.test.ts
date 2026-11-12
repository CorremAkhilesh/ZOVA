import { chatResponseSchema, type Message, pollMessageResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  type TestSocket,
  uuidv7,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { sendMessage } from '../../chats/messages.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, call, group, history, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const lunch = { question: 'Lunch?', options: ['Pizza', 'Dosa', 'Salad'], multiple: false };
const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const emitPoll = (socket: TestSocket, chatId: string, poll: object, extra: object = {}) =>
  socket
    .timeout(30_000)
    .emitWithAck('message:send', { chatId, clientMsgId: uuidv7(), poll, ...extra } as never);
const poll = async (who: Person, chatId: string, input = lunch) =>
  (await sendMessage(app(), { userId: who.id, chatId, clientMsgId: uuidv7(), poll: input }))
    .message;
const vote = (who: Person | null, chatId: string, messageId: string, optionIds: unknown) =>
  call(who, 'PUT', `/v1/chats/${chatId}/messages/${messageId}/vote`, { optionIds });
const close = (who: Person | null, chatId: string, messageId: string) =>
  call(who, 'POST', `/v1/chats/${chatId}/messages/${messageId}/close-poll`);
const votesOf = (message: Message) =>
  Object.fromEntries((message.poll?.options ?? []).map((o) => [o.id, o.voterIds]));
async function voted(who: Person, chatId: string, messageId: string, optionIds: string[]) {
  const response = await vote(who, chatId, messageId, optionIds);
  expect(response.statusCode).toBe(200);
  return pollMessageResponseSchema.parse(response.json()).message;
}

describe('creating a poll over the socket', () => {
  it('works in a 1:1 chat and a group, and the chat list shows the question', async () => {
    const [asha, bharat] = [await person(), await person()];
    const socket = await connect(url, asha.cookie);
    for (const chatId of [await direct(asha, bharat), await group(asha, [bharat])]) {
      const ack = await emitPoll(socket, chatId, lunch);
      expect(ack.ok).toBe(true);
      const [message] = (await history(bharat, chatId)).filter((m) => !m.system);
      expect(message).toMatchObject({ type: 'poll', text: null });
      expect(message?.poll).toEqual({
        question: 'Lunch?',
        options: lunch.options.map((text, id) => ({ id: String(id), text, voterIds: [] })),
        multiple: false,
        closedAt: null,
      });
      expect((await summary(bharat, chatId)).lastMessage?.preview).toBe('Lunch?');
    }
  });

  it('checks the question and options, and refuses Saved Messages', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const socket = await connect(url, asha.cookie);
    const bad = [
      { ...lunch, options: ['Only one'] },
      { ...lunch, options: Array.from({ length: 13 }, (_, n) => `Option ${n}`) },
      { ...lunch, options: ['Tea', 'tea'] },
      { ...lunch, question: '  ' },
    ];
    for (const input of bad) expect((await emitPoll(socket, chatId, input)).ok).toBe(false);
    const twelve = { ...lunch, options: Array.from({ length: 12 }, (_, n) => `Option ${n}`) };
    expect((await emitPoll(socket, chatId, twelve)).ok).toBe(true);
    const self = await call(asha, 'GET', '/v1/chats/self');
    const selfId = chatResponseSchema.parse(self.json()).chat.id;
    const refused = await emitPoll(socket, selfId, lunch);
    expect(refused.ok ? null : refused.error.code).toBe('BAD_REQUEST');
  });

  it('a reply quotes the question; editing a poll is refused', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const message = await poll(asha, chatId);
    const reply = await sendMessage(app(), {
      userId: bharat.id,
      chatId,
      clientMsgId: uuidv7(),
      text: 'Dosa!',
      replyTo: { chatId, messageId: message.id },
    });
    expect(reply.message.replyTo).toMatchObject({ type: 'poll', text: 'Lunch?' });
    const edit = await call(asha, 'PATCH', `/v1/chats/${chatId}/messages/${message.id}`, {
      text: 'Dinner?',
    });
    expect(edit.statusCode).toBe(400);
  });
});

describe('voting', () => {
  it('votes, changes the vote and takes it back; everyone sees who voted', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat, chitra]);
    const message = await poll(asha, chatId);
    expect(votesOf(await voted(bharat, chatId, message.id, ['1']))['1']).toEqual([bharat.id]);
    await voted(chitra, chatId, message.id, ['1']);
    const changed = await voted(bharat, chatId, message.id, ['0']);
    expect(votesOf(changed)).toEqual({ 0: [bharat.id], 1: [chitra.id], 2: [] });
    const removed = await voted(bharat, chatId, message.id, []);
    expect(votesOf(removed)).toEqual({ 0: [], 1: [chitra.id], 2: [] });
    const [seen] = (await history(asha, chatId)).filter((m) => m.type === 'poll');
    expect(votesOf(seen as Message)).toEqual(votesOf(removed));
  });

  it('allows several only when the poll does, never counts twice, and checks the ids', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const single = await poll(asha, chatId);
    expect((await vote(bharat, chatId, single.id, ['0', '1'])).statusCode).toBe(400);
    expect((await vote(bharat, chatId, single.id, ['7'])).statusCode).toBe(400);
    expect((await vote(bharat, chatId, single.id, 'nope')).statusCode).toBe(400);
    const several = await poll(asha, chatId, { ...lunch, multiple: true });
    const both = await voted(bharat, chatId, several.id, ['0', '2', '2']);
    expect(votesOf(both)).toEqual({ 0: [bharat.id], 1: [], 2: [bharat.id] });
    // Two quick votes at once: whichever lands last, I am counted once per option.
    await Promise.all([
      vote(bharat, chatId, several.id, ['1']),
      vote(bharat, chatId, several.id, ['1']),
    ]);
    const [stored] = (await history(asha, chatId)).filter((m) => m.id === several.id);
    expect(votesOf(stored as Message)).toEqual({ 0: [], 1: [bharat.id], 2: [] });
  });

  it('refuses outsiders, the signed out, later joiners, deleted polls and non-polls', async () => {
    const [asha, bharat, outsider, late] = [
      await person(),
      await person(),
      await person(),
      await person(),
    ];
    const chatId = await group(asha, [bharat]);
    const message = await poll(asha, chatId);
    expect((await vote(outsider, chatId, message.id, ['0'])).statusCode).toBe(404);
    expect((await vote(null, chatId, message.id, ['0'])).statusCode).toBe(401);
    await call(asha, 'POST', `/v1/chats/${chatId}/members`, { userIds: [late.id] });
    expect((await vote(late, chatId, message.id, ['0'])).statusCode).toBe(404);
    expect((await close(outsider, chatId, message.id)).statusCode).toBe(404);
    const text = await sendMessage(app(), {
      userId: asha.id,
      chatId,
      clientMsgId: uuidv7(),
      text: 'not a poll',
    });
    expect((await vote(bharat, chatId, text.message.id, ['0'])).statusCode).toBe(400);
    await call(asha, 'DELETE', `/v1/chats/${chatId}/messages/${message.id}?scope=everyone`);
    expect((await vote(bharat, chatId, message.id, ['0'])).statusCode).toBe(409);
  });
});

describe('closing', () => {
  it('only its sender closes it, once; then no more votes', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const message = await poll(asha, chatId);
    await voted(bharat, chatId, message.id, ['2']);
    expect((await close(bharat, chatId, message.id)).statusCode).toBe(403);
    expect((await close(null, chatId, message.id)).statusCode).toBe(401);
    const closed = await close(asha, chatId, message.id);
    expect(closed.statusCode).toBe(200);
    const closedAt = pollMessageResponseSchema.parse(closed.json()).message.poll?.closedAt;
    expect(closedAt).toBeTruthy();
    const again = pollMessageResponseSchema.parse((await close(asha, chatId, message.id)).json());
    expect(again.message.poll?.closedAt).toBe(closedAt);
    const refused = await vote(bharat, chatId, message.id, ['0']);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('POLL_CLOSED');
    expect(votesOf(again.message)['2']).toEqual([bharat.id]);
  });
});

describe('live', () => {
  it('every member’s devices get the updated poll', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const message = await poll(asha, chatId);
    const [mine, theirs] = [await connect(url, asha.cookie), await connect(url, bharat.cookie)];
    const [toAsha, toBharat] = [record(mine, 'message:updated'), record(theirs, 'message:updated')];
    await voted(bharat, chatId, message.id, ['1']);
    await waitUntil(() => expect(toAsha).toHaveLength(1));
    await waitUntil(() => expect(toBharat).toHaveLength(1));
    expect(votesOf(toAsha[0]?.message as Message)['1']).toEqual([bharat.id]);
    await close(asha, chatId, message.id);
    await waitUntil(() => expect(toBharat).toHaveLength(2));
    expect(toBharat[1]?.message.poll?.closedAt).toBeTruthy();
  });
});
