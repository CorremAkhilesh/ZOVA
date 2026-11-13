import {
  apiErrorSchema,
  chatListResponseSchema,
  chatResponseSchema,
  markReadResponseSchema,
  messageHistoryResponseSchema,
  syncResponseSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { signedIn, uuidv7 } from '../../../test/realtime-helpers.ts';
import { sendMessage } from '../../chats/messages.service.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => ctx.app;
type Person = Awaited<ReturnType<typeof signedIn>>;
let alice: Person;
let bob: Person;
let carol: Person;
let chatId: string;

const call = (method: 'GET' | 'POST', url: string, person?: Person, payload?: object) =>
  app().inject({
    method,
    url,
    headers: headers(person?.cookie),
    ...(payload ? { payload } : {}),
  });

beforeAll(async () => {
  ctx = await buildTestApp();
  alice = await signedIn(app(), 'alice@corremadvisory.com');
  bob = await signedIn(app(), 'bob@corremadvisory.com');
  carol = await signedIn(app(), 'carol@corremadvisory.com');
  const opened = await call('POST', '/v1/chats/direct', alice, { userId: bob.id });
  chatId = chatResponseSchema.parse(opened.json()).chat.id;
  await sendMessage(app(), { userId: alice.id, chatId, clientMsgId: uuidv7(), text: 'one' });
  await sendMessage(app(), { userId: alice.id, chatId, clientMsgId: uuidv7(), text: 'two' });
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('success, in contract shape', () => {
  it('POST /chats/direct is idempotent, with the other profile', async () => {
    const response = await call('POST', '/v1/chats/direct', bob, { userId: alice.id });
    expect(response.statusCode).toBe(200);
    expect(chatResponseSchema.parse(response.json()).chat).toMatchObject({
      id: chatId,
      type: 'direct',
      otherUser: { id: alice.id },
      unreadCount: 2,
    });
  });

  it('GET /chats/self', async () => {
    const first = chatResponseSchema.parse((await call('GET', '/v1/chats/self', alice)).json());
    const second = chatResponseSchema.parse((await call('GET', '/v1/chats/self', alice)).json());
    expect(first.chat).toMatchObject({ type: 'self', otherUser: null, id: second.chat.id });
  });

  it('GET /chats', async () => {
    const response = await call('GET', '/v1/chats?limit=1', bob);
    const page = chatListResponseSchema.parse(response.json());
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: chatId, lastMessage: { preview: 'two' } });
  });

  it('GET /chats/:id and its messages', async () => {
    const chat = await call('GET', `/v1/chats/${chatId}`, bob);
    expect(chatResponseSchema.parse(chat.json()).chat.seq).toBe(2);
    const history = await call('GET', `/v1/chats/${chatId}/messages?limit=1&before=2`, bob);
    const page = messageHistoryResponseSchema.parse(history.json());
    expect(page.items.map((message) => message.text)).toEqual(['one']);
    expect(page.hasMore).toBe(false);
  });

  it('POST /chats/:id/read', async () => {
    const response = await call('POST', `/v1/chats/${chatId}/read`, bob, { seq: 1 });
    expect(markReadResponseSchema.parse(response.json())).toEqual({
      chatId,
      lastReadSeq: 1,
      unreadCount: 1,
    });
  });

  it('GET /sync', async () => {
    const start = syncResponseSchema.parse((await call('GET', '/v1/sync', carol)).json());
    expect(start.reset).toBe(true);
    const response = await call('GET', '/v1/sync?since=0&limit=100', bob);
    const sync = syncResponseSchema.parse(response.json());
    expect(sync.messages.map((message) => message.text)).toEqual(['one', 'two']);
    expect(sync.chats.map((chat) => chat.id)).toEqual([chatId]);
  });
});

describe('errors', () => {
  it('401 without a session on every route', async () => {
    for (const [method, url, payload] of [
      ['POST', '/v1/chats/direct', { userId: bob.id }],
      ['GET', '/v1/chats/self'],
      ['GET', '/v1/chats'],
      ['GET', `/v1/chats/${chatId}`],
      ['GET', `/v1/chats/${chatId}/messages`],
      ['POST', `/v1/chats/${chatId}/read`, { seq: 1 }],
      ['GET', '/v1/sync'],
    ] as const) {
      const response = await call(method, url, undefined, payload);
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('400 on invalid input', async () => {
    for (const [method, url, payload] of [
      ['POST', '/v1/chats/direct', { userId: 'nope' }],
      ['POST', '/v1/chats/direct', { userId: alice?.id }],
      ['GET', '/v1/chats/not-an-id'],
      ['GET', `/v1/chats/${chatId}/messages?limit=101`],
      ['GET', `/v1/chats/${chatId}/messages?before=0`],
      ['POST', `/v1/chats/${chatId}/read`, { seq: -1 }],
      ['GET', '/v1/chats?cursor=nonsense'],
      ['GET', '/v1/sync?since=abc'],
    ] as const) {
      const response = await call(method, url, alice, payload);
      expect(response.statusCode, url).toBe(400);
      apiErrorSchema.parse(response.json());
    }
  });

  it('non-members see the chat as missing, and cannot touch it', async () => {
    for (const [method, url, payload] of [
      ['GET', `/v1/chats/${chatId}`],
      ['GET', `/v1/chats/${chatId}/messages`],
      ['POST', `/v1/chats/${chatId}/read`, { seq: 1 }],
    ] as const) {
      const response = await call(method, url, carol, payload);
      expect(response.statusCode, url).toBe(404);
      expect(response.body).not.toContain('one');
    }
    const list = chatListResponseSchema.parse((await call('GET', '/v1/chats', carol)).json());
    expect(list.items).toEqual([]);
    const sync = syncResponseSchema.parse((await call('GET', '/v1/sync?since=0', carol)).json());
    expect(sync).toMatchObject({ messages: [], chats: [] });
  });

  it('404 for an unknown person', async () => {
    const unknown = await call('POST', '/v1/chats/direct', alice, {
      userId: '000000000000000000000000',
    });
    expect(unknown.statusCode).toBe(404);
  });
});
