import {
  apiErrorSchema,
  chatUpdatedEventSchema,
  messageNewEventSchema,
  readUpdateEventSchema,
  sendMessageAckSchema,
  syncResponseSchema,
} from '@zuvo/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../test/auth-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  nextDisconnect,
  record,
  send,
  signedIn,
  uuidv7,
  waitUntil,
} from '../../test/realtime-helpers.ts';
import { getOrCreateDirectChat } from '../chats/chats.service.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => ctx.app;
type Person = Awaited<ReturnType<typeof signedIn>>;
let alice: Person;
let bob: Person;
let carol: Person;
let chatId: string;

beforeAll(async () => {
  ctx = await buildTestApp();
  url = await listen(app());
  alice = await signedIn(app(), 'alice@corremadvisory.com');
  bob = await signedIn(app(), 'bob@corremadvisory.com');
  carol = await signedIn(app(), 'carol@corremadvisory.com');
  chatId = (await getOrCreateDirectChat(app(), alice.id, bob.id)).id;
});
afterEach(() => closeAllSockets());
afterAll(async () => {
  await ctx.cleanup();
});

const syncOf = async (person: Person, since: string) =>
  syncResponseSchema.parse(
    (
      await app().inject({
        method: 'GET',
        url: `/v1/sync?since=${since}`,
        headers: headers(person.cookie),
      })
    ).json(),
  );

describe('sending and delivery', () => {
  it('reaches all the recipient’s devices and the sender’s other devices, in contract shape', async () => {
    const aliceLaptop = await connect(url, alice.cookie);
    const alicePhone = await connect(url, alice.cookie);
    const bobLaptop = await connect(url, bob.cookie);
    const bobPhone = await connect(url, bob.cookie);
    const carolLaptop = await connect(url, carol.cookie);
    const received = [aliceLaptop, alicePhone, bobLaptop, bobPhone].map((socket) =>
      record(socket, 'message:new'),
    );
    const updates = record(bobLaptop, 'chat:updated');
    const snooped = record(carolLaptop, 'message:new');
    const snoopedUpdates = record(carolLaptop, 'chat:updated');

    const ack = await send(aliceLaptop, chatId, 'hello');
    expect(ack.ok).toBe(true);
    const data = ack.ok ? sendMessageAckSchema.parse(ack.data) : null;
    expect(data?.duplicate).toBe(false);

    await waitUntil(() => {
      for (const list of received) expect(list).toHaveLength(1);
      expect(updates).toHaveLength(1);
    });
    for (const list of received) {
      const event = messageNewEventSchema.parse(list[0]);
      expect(event.message).toMatchObject({ text: 'hello', seq: data?.seq, senderId: alice.id });
    }
    const update = chatUpdatedEventSchema.parse(updates[0]);
    expect(update).toMatchObject({ chatId, lastMessage: { preview: 'hello' } });
    expect(update.unreadCount).toBeGreaterThan(0);
    expect(snooped).toEqual([]);
    expect(snoopedUpdates).toEqual([]);
  });

  it('delivers one message for a repeated clientMsgId', async () => {
    const sender = await connect(url, alice.cookie);
    const receiver = await connect(url, bob.cookie);
    const received = record(receiver, 'message:new');
    const id = uuidv7();
    const first = await send(sender, chatId, 'once', id);
    const second = await send(sender, chatId, 'once', id);
    expect(first.ok && second.ok && first.data.messageId === second.data.messageId).toBe(true);
    expect(second.ok && second.data.duplicate).toBe(true);
    await waitUntil(() => expect(received).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toHaveLength(1);
  });

  it('refuses non-members, invalid payloads and oversized text', async () => {
    const outsider = await connect(url, carol.cookie);
    const denied = await send(outsider, chatId, 'let me in');
    expect(!denied.ok && apiErrorSchema.parse(denied.error).code).toBe('NOT_FOUND');

    const sender = await connect(url, alice.cookie);
    const badId = await sender
      .timeout(30_000)
      .emitWithAck('message:send', { chatId, clientMsgId: 'not-a-uuid', text: 'x' });
    expect(!badId.ok && badId.error.code).toBe('VALIDATION_FAILED');
    const blank = await send(sender, chatId, '   ');
    expect(!blank.ok && blank.error.code).toBe('VALIDATION_FAILED');
    const long = await send(sender, chatId, 'x'.repeat(4097));
    expect(!long.ok && long.error.code).toBe('VALIDATION_FAILED');
  });

  it('closes a connection that sends more than the payload limit', async () => {
    const sender = await connect(url, alice.cookie);
    const closed = nextDisconnect(sender);
    sender.emit(
      'message:send',
      { chatId, clientMsgId: uuidv7(), text: 'x'.repeat(70 * 1024) },
      () => undefined,
    );
    expect(await closed).toMatch(/transport (close|error)/);
  });

  it('survives an event sent without an ack', async () => {
    const socket = await connect(url, alice.cookie);
    (socket.emit as (event: string, payload: object) => void)('read:update', { chatId, seq: 1 });
    (socket.emit as (event: string, payload: object) => void)('typing:start', { chatId });
    expect((await send(socket, chatId, 'still alive')).ok).toBe(true);
  });

  it('limits one user to 20 messages per 5 seconds', async () => {
    const eve = await signedIn(app(), 'eve@corremadvisory.com');
    const room = await getOrCreateDirectChat(app(), eve.id, bob.id);
    const socket = await connect(url, eve.cookie);
    // One id, so only the first send does real work: the limit is checked before storing anything.
    const clientMsgId = uuidv7();
    const acks = await Promise.all(
      Array.from({ length: 25 }, () => send(socket, room.id, 'same', clientMsgId)),
    );
    expect(acks.filter((ack) => ack.ok)).toHaveLength(20);
    const refused = acks.find((ack) => !ack.ok);
    expect(!refused?.ok && refused?.error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: expect.any(Number) },
    });
  });
});

describe('read state', () => {
  it('syncs my other devices, never the other person or outsiders', async () => {
    const frank = await signedIn(app(), 'frank@corremadvisory.com');
    const room = await getOrCreateDirectChat(app(), frank.id, alice.id);
    const sender = await connect(url, frank.cookie);
    await send(sender, room.id, 'one');
    await send(sender, room.id, 'two');

    const phone = await connect(url, alice.cookie);
    const laptop = await connect(url, alice.cookie);
    const synced = record(laptop, 'read:update');
    const seenBySender = record(sender, 'read:update');
    const ack = await phone.timeout(30_000).emitWithAck('read:update', { chatId: room.id, seq: 1 });
    expect(ack).toMatchObject({ ok: true, data: { lastReadSeq: 1, unreadCount: 1 } });
    await waitUntil(() => expect(synced).toHaveLength(1));
    expect(readUpdateEventSchema.parse(synced[0])).toMatchObject({
      chatId: room.id,
      lastReadSeq: 1,
    });
    expect(seenBySender).toEqual([]);

    const outsider = await connect(url, carol.cookie);
    const denied = await outsider
      .timeout(30_000)
      .emitWithAck('read:update', { chatId: room.id, seq: 1 });
    expect(!denied.ok && denied.error.code).toBe('NOT_FOUND');
  });
});

describe('reconnect and catch-up', () => {
  it('a device that was offline gets exactly what it missed through /v1/sync', async () => {
    const receiver = await connect(url, bob.cookie);
    const live = record(receiver, 'message:new');
    const sender = await connect(url, alice.cookie);
    const before = await send(sender, chatId, 'seen live');
    await waitUntil(() => expect(live).toHaveLength(1));
    const { cursor } = messageNewEventSchema.parse(live[0]);
    receiver.disconnect();

    const missed = await Promise.all(['a', 'b', 'c'].map((text) => send(sender, chatId, text)));
    const back = await connect(url, bob.cookie);
    const afterReturn = record(back, 'message:new');
    const caught = await syncOf(bob, cursor);
    expect(caught.reset).toBe(false);
    expect(caught.messages.map((m) => m.seq).sort((x, y) => x - y)).toEqual(
      missed.map((ack) => (ack.ok ? ack.data.seq : 0)).sort((x, y) => x - y),
    );
    expect(caught.messages.map((m) => m.seq)).not.toContain(before.ok ? before.data.seq : 0);
    expect(afterReturn).toEqual([]);
    expect((await syncOf(bob, caught.cursor)).messages).toEqual([]);

    // The cursor on live events lines up with sync: no overlap with the next delivery.
    await send(sender, chatId, 'after');
    await waitUntil(() => expect(afterReturn).toHaveLength(1));
    const next = messageNewEventSchema.parse(afterReturn[0]);
    expect(Number(next.cursor)).toBe(Number(caught.cursor) + 1);
  });
});
