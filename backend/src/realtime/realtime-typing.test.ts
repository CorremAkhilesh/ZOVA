import { typingEventSchema } from '@zuvo/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  signedIn,
  waitUntil,
} from '../../test/realtime-helpers.ts';
import { getOrCreateDirectChat } from '../chats/chats.service.ts';
import { windowLimit } from './socket-limit.ts';
import { TYPING_TTL_MS } from './typing.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => ctx.app;
let seed = 0;

const pair = async () => {
  seed += 1;
  const alice = await signedIn(app(), `t${seed}a@corremadvisory.com`);
  const bob = await signedIn(app(), `t${seed}b@corremadvisory.com`);
  const { id: chatId } = await getOrCreateDirectChat(app(), alice.id, bob.id);
  return { alice, bob, chatId };
};

beforeAll(async () => {
  ctx = await buildTestApp();
  url = await listen(app());
});
afterEach(() => closeAllSockets());
afterAll(async () => {
  await ctx.cleanup();
});

const start = (socket: Awaited<ReturnType<typeof connect>>, chatId: string) =>
  socket.timeout(10_000).emitWithAck('typing:start', { chatId });
const stop = (socket: Awaited<ReturnType<typeof connect>>, chatId: string) =>
  socket.timeout(10_000).emitWithAck('typing:stop', { chatId });

describe('typing', () => {
  it('reaches the other member, not me, and stops when told', async () => {
    const { alice, bob, chatId } = await pair();
    const aliceSocket = await connect(url, alice.cookie);
    const aliceOther = await connect(url, alice.cookie);
    const bobSocket = await connect(url, bob.cookie);
    const toBob = record(bobSocket, 'typing:update');
    const toMyOtherDevice = record(aliceOther, 'typing:update');

    expect(await start(aliceSocket, chatId)).toEqual({ ok: true, data: {} });
    await waitUntil(() => expect(toBob).toHaveLength(1));
    expect(typingEventSchema.parse(toBob[0])).toEqual({ chatId, userId: alice.id, typing: true });

    await stop(aliceSocket, chatId);
    await waitUntil(() => expect(toBob).toHaveLength(2));
    expect(toBob[1]?.typing).toBe(false);
    expect(toMyOtherDevice).toEqual([]);
  });

  it('expires by itself without a refresh, and a refresh keeps it going', async () => {
    const { alice, bob, chatId } = await pair();
    const aliceSocket = await connect(url, alice.cookie);
    const toBob = record(await connect(url, bob.cookie), 'typing:update');
    await start(aliceSocket, chatId);
    await new Promise((resolve) => setTimeout(resolve, TYPING_TTL_MS - 2000));
    await start(aliceSocket, chatId);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    // Past the first expiry, but refreshed.
    expect(toBob.every((event) => event.typing)).toBe(true);
    await waitUntil(() => expect(toBob.at(-1)?.typing).toBe(false), TYPING_TTL_MS);
  }, 30_000);

  it('stops when the typing device disappears', async () => {
    const { alice, bob, chatId } = await pair();
    const aliceSocket = await connect(url, alice.cookie);
    const toBob = record(await connect(url, bob.cookie), 'typing:update');
    await start(aliceSocket, chatId);
    await waitUntil(() => expect(toBob).toHaveLength(1));
    aliceSocket.disconnect();
    await waitUntil(() => expect(toBob.at(-1)?.typing).toBe(false));
  });

  it('non-members get nothing, and are refused', async () => {
    const { alice, bob, chatId } = await pair();
    const stranger = await signedIn(app(), `stranger${seed}@corremadvisory.com`);
    const strangerSocket = await connect(url, stranger.cookie);
    const toStranger = record(strangerSocket, 'typing:update');
    const toBob = record(await connect(url, bob.cookie), 'typing:update');

    const refused = await start(strangerSocket, chatId);
    expect(refused.ok ? null : refused.error.code).toBe('NOT_FOUND');

    await start(await connect(url, alice.cookie), chatId);
    await waitUntil(() => expect(toBob).toHaveLength(1));
    expect(toBob[0]?.userId).toBe(alice.id);
    expect(toStranger).toEqual([]);
  });

  it('is rate limited per socket', async () => {
    const { alice, bob, chatId } = await pair();
    const socket = await connect(url, alice.cookie);
    record(await connect(url, bob.cookie), 'typing:update');
    const acks = await Promise.all(Array.from({ length: 25 }, () => start(socket, chatId)));
    const limited = acks.filter((ack) => !ack.ok && ack.error.code === 'RATE_LIMITED');
    expect(limited.length).toBe(5);
  });
});

describe('windowLimit', () => {
  it('allows up to the maximum per window, then starts again', () => {
    let time = 0;
    const allowed = windowLimit(2, 1000, () => time);
    expect([allowed(), allowed(), allowed()]).toEqual([true, true, false]);
    time = 1000;
    expect(allowed()).toBe(true);
  });
});
