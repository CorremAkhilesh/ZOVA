import { chatSummarySchema, DEFAULT_PRIVACY, receiptEventSchema } from '@zuvo/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../test/auth-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  send,
  signedIn,
  waitUntil,
} from '../../test/realtime-helpers.ts';
import { chatModels, getChat, getOrCreateDirectChat, oid } from '../chats/chats.service.ts';
import { markDelivered, markRead } from '../chats/receipts.service.ts';
import { syncSince } from '../chats/sync.service.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => ctx.app;
type Person = Awaited<ReturnType<typeof signedIn>>;
let seed = 0;

const pair = async () => {
  seed += 1;
  const alice = await signedIn(app(), `r${seed}a@corremadvisory.com`);
  const bob = await signedIn(app(), `r${seed}b@corremadvisory.com`);
  const { id: chatId } = await getOrCreateDirectChat(app(), alice.id, bob.id);
  return { alice, bob, chatId };
};

const memberOf = (chatId: string, userId: string) =>
  chatModels(app())
    .ChatMember.findOne({ chatId: oid(chatId), userId: oid(userId) })
    .lean();

const setReadReceipts = (person: Person, readReceipts: boolean) =>
  app().inject({
    method: 'PUT',
    url: '/v1/me/privacy',
    headers: headers(person.cookie),
    payload: { ...DEFAULT_PRIVACY, readReceipts },
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

beforeAll(async () => {
  ctx = await buildTestApp();
  url = await listen(app());
});
afterEach(() => closeAllSockets());
afterAll(async () => {
  await ctx.cleanup();
});

describe('delivered', () => {
  it('moves forward, tells the sender, and never moves back', async () => {
    const { alice, bob, chatId } = await pair();
    const aliceSocket = await connect(url, alice.cookie);
    const bobSocket = await connect(url, bob.cookie);
    const receipts = record(aliceSocket, 'receipt:update');
    for (const text of ['one', 'two', 'three']) await send(aliceSocket, chatId, text);

    const ack = await bobSocket.timeout(10_000).emitWithAck('delivered:update', { chatId, seq: 3 });
    expect(ack).toEqual({ ok: true, data: { chatId, lastDeliveredSeq: 3 } });
    await waitUntil(() => expect(receipts).toHaveLength(1));
    const receipt = receiptEventSchema.parse(receipts[0]);
    expect(receipt).toMatchObject({ chatId, userId: bob.id, lastDeliveredSeq: 3, lastReadSeq: 0 });

    const back = await bobSocket
      .timeout(10_000)
      .emitWithAck('delivered:update', { chatId, seq: 1 });
    expect(back).toEqual({ ok: true, data: { chatId, lastDeliveredSeq: 3 } });
    expect((await memberOf(chatId, bob.id))?.lastDeliveredSeq).toBe(3);
    await settle();
    expect(receipts).toHaveLength(1);
  });

  it('cannot go past the end of the chat', async () => {
    const { alice, bob, chatId } = await pair();
    await send(await connect(url, alice.cookie), chatId, 'one');
    expect((await markDelivered(app(), bob.id, chatId, 999)).lastDeliveredSeq).toBe(1);
  });

  it('counts when the first of two devices receives; the second changes nothing', async () => {
    const { alice, bob, chatId } = await pair();
    const aliceSocket = await connect(url, alice.cookie);
    const phone = await connect(url, bob.cookie);
    const laptop = await connect(url, bob.cookie);
    const receipts = record(aliceSocket, 'receipt:update');
    await send(aliceSocket, chatId, 'hello');

    await phone.timeout(10_000).emitWithAck('delivered:update', { chatId, seq: 1 });
    await waitUntil(() => expect(receipts).toHaveLength(1));
    await laptop.timeout(10_000).emitWithAck('delivered:update', { chatId, seq: 1 });
    await settle();
    expect(receipts).toHaveLength(1);
  });

  it('reaches all of the sender’s devices', async () => {
    const { alice, bob, chatId } = await pair();
    const senderPhone = await connect(url, alice.cookie);
    const senderLaptop = await connect(url, alice.cookie);
    const laptopReceipts = record(senderLaptop, 'receipt:update');
    await send(senderPhone, chatId, 'hello');
    await markDelivered(app(), bob.id, chatId, 1);
    await waitUntil(() => expect(laptopReceipts).toHaveLength(1));
  });

  it('is refused for a chat I am not in', async () => {
    const { alice, chatId } = await pair();
    const stranger = await signedIn(app(), `stranger${seed}@corremadvisory.com`);
    await send(await connect(url, alice.cookie), chatId, 'private');
    const socket = await connect(url, stranger.cookie);
    const ack = await socket.timeout(10_000).emitWithAck('delivered:update', { chatId, seq: 1 });
    expect(ack.ok).toBe(false);
    expect(ack.ok ? null : ack.error.code).toBe('NOT_FOUND');
  });

  it('reaches a sender who was offline, through sync', async () => {
    const { alice, bob, chatId } = await pair();
    const aliceSocket = await connect(url, alice.cookie);
    await send(aliceSocket, chatId, 'hello');
    aliceSocket.disconnect();
    const before = await syncSince(app(), alice.id, '0', 200);
    await markDelivered(app(), bob.id, chatId, 1);
    const after = await syncSince(app(), alice.id, before.cursor, 200);
    expect(after.reset).toBe(false);
    expect(after.chats[0]).toMatchObject({ id: chatId, peerDeliveredSeq: 1 });
    expect(chatSummarySchema.safeParse(after.chats[0]).success).toBe(true);
  });
});

describe('read', () => {
  it('never moves back, and also counts as delivered', async () => {
    const { alice, bob, chatId } = await pair();
    const aliceSocket = await connect(url, alice.cookie);
    const receipts = record(aliceSocket, 'receipt:update');
    for (const text of ['one', 'two']) await send(aliceSocket, chatId, text);

    await markRead(app(), bob.id, chatId, 2);
    await waitUntil(() => expect(receipts).toHaveLength(1));
    expect(receipts[0]).toMatchObject({ lastDeliveredSeq: 2, lastReadSeq: 2 });

    await markRead(app(), bob.id, chatId, 1);
    const member = await memberOf(chatId, bob.id);
    expect(member).toMatchObject({ lastReadSeq: 2, lastDeliveredSeq: 2 });
    await settle();
    expect(receipts).toHaveLength(1);
  });

  it('replying tells the other person I received and read', async () => {
    const { alice, bob, chatId } = await pair();
    const aliceSocket = await connect(url, alice.cookie);
    const updates = record(aliceSocket, 'chat:updated');
    await send(aliceSocket, chatId, 'question');
    await send(await connect(url, bob.cookie), chatId, 'answer');
    await waitUntil(() => {
      expect(updates.at(-1)).toMatchObject({ seq: 2, peerDeliveredSeq: 2, peerReadSeq: 2 });
    });
  });
});

describe('read receipts privacy is reciprocal', () => {
  it.each([
    ['the reader', 'bob'],
    ['the sender', 'alice'],
  ] as const)('with %s switched off, no read position is ever sent', async (_who, off) => {
    const { alice, bob, chatId } = await pair();
    const response = await setReadReceipts(off === 'bob' ? bob : alice, false);
    expect(response.statusCode).toBe(200);
    const aliceSocket = await connect(url, alice.cookie);
    const bobSocket = await connect(url, bob.cookie);
    const receipts = record(aliceSocket, 'receipt:update');
    const updates = record(aliceSocket, 'chat:updated');
    await send(aliceSocket, chatId, 'one');
    await send(aliceSocket, chatId, 'two');

    await markDelivered(app(), bob.id, chatId, 1);
    await markRead(app(), bob.id, chatId, 2);
    await waitUntil(() => expect(receipts).toHaveLength(2));
    for (const receipt of receipts) expect(receipt.lastReadSeq).toBeNull();
    expect(receipts.at(-1)?.lastDeliveredSeq).toBe(2);
    for (const update of updates) expect(update.peerReadSeq ?? null).toBeNull();

    // Nor in what the REST API or sync say.
    expect((await getChat(app(), chatId, alice.id)).peerReadSeq).toBeNull();
    expect((await getChat(app(), chatId, bob.id)).peerReadSeq).toBeNull();
    const synced = await syncSince(app(), alice.id, '0', 200);
    for (const chat of synced.chats) expect(chat.peerReadSeq).toBeNull();

    // A reply would otherwise reveal it too.
    const replies = record(aliceSocket, 'chat:updated');
    await send(bobSocket, chatId, 'reply');
    await waitUntil(() => expect(replies).toHaveLength(1));
    expect(replies[0]).toMatchObject({ peerDeliveredSeq: 3, peerReadSeq: null });
  });

  it('reading further sends nothing at all when nothing new may be known', async () => {
    const { alice, bob, chatId } = await pair();
    await setReadReceipts(bob, false);
    const aliceSocket = await connect(url, alice.cookie);
    const receipts = record(aliceSocket, 'receipt:update');
    await send(aliceSocket, chatId, 'one');
    await markDelivered(app(), bob.id, chatId, 1);
    await waitUntil(() => expect(receipts).toHaveLength(1));
    await markRead(app(), bob.id, chatId, 1);
    await settle();
    expect(receipts).toHaveLength(1);
    expect((await memberOf(chatId, bob.id))?.lastReadSeq).toBe(1);
  });

  it('shows reads again once both have it on', async () => {
    const { alice, bob, chatId } = await pair();
    await setReadReceipts(bob, false);
    await send(await connect(url, alice.cookie), chatId, 'one');
    await markRead(app(), bob.id, chatId, 1);
    expect((await getChat(app(), chatId, alice.id)).peerReadSeq).toBeNull();
    await setReadReceipts(bob, true);
    expect((await getChat(app(), chatId, alice.id)).peerReadSeq).toBe(1);
  });
});
