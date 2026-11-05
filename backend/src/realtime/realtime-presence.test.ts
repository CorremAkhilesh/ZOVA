import { randomBytes } from 'node:crypto';
import { DEFAULT_PRIVACY, presenceEventSchema } from '@zuvo/protocol';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../test/auth-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  nextDisconnect,
  record,
  signedIn,
  type TestSocket,
  waitUntil,
} from '../../test/realtime-helpers.ts';
import { getOrCreateDirectChat } from '../chats/chats.service.ts';
import { usersModel } from '../users/user-record.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => ctx.app;
type Person = Awaited<ReturnType<typeof signedIn>>;
let seed = 0;

const pair = async () => {
  seed += 1;
  const alice = await signedIn(app(), `p${seed}a@corremadvisory.com`);
  const bob = await signedIn(app(), `p${seed}b@corremadvisory.com`);
  await getOrCreateDirectChat(app(), alice.id, bob.id);
  return { alice, bob };
};

const subscribe = async (socket: TestSocket, userIds: string[]) => {
  const ack = await socket.timeout(10_000).emitWithAck('presence:subscribe', { userIds });
  if (!ack.ok) throw new Error(ack.error.code);
  return presenceEventSchema.array().parse(ack.data.users);
};

const hideLastSeen = (person: Person, hidden: boolean) =>
  app().inject({
    method: 'PUT',
    url: '/v1/me/privacy',
    headers: headers(person.cookie),
    payload: { ...DEFAULT_PRIVACY, lastSeen: hidden ? 'nobody' : 'everyone' },
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

describe('online and last seen', () => {
  it('is online while any socket is connected, and saves last seen on the final one', async () => {
    const { alice, bob } = await pair();
    const watcher = await connect(url, alice.cookie);
    const phone = await connect(url, bob.cookie);
    const laptop = await connect(url, bob.cookie);
    const events = record(watcher, 'presence:update');
    expect(await subscribe(watcher, [bob.id])).toEqual([
      { userId: bob.id, online: true, lastSeenAt: null },
    ]);

    phone.disconnect();
    await settle();
    expect(events).toEqual([]);
    expect((await subscribe(watcher, [bob.id]))[0]?.online).toBe(true);

    laptop.disconnect();
    await waitUntil(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ userId: bob.id, online: false });
    expect(events[0]?.lastSeenAt).not.toBeNull();
    await waitUntil(async () => {
      const stored = await usersModel(app()).findById(bob.id).lean();
      expect(stored?.lastSeenAt).toBeInstanceOf(Date);
    });
    const [after] = await subscribe(watcher, [bob.id]);
    expect(after).toMatchObject({ online: false });
    expect(after?.lastSeenAt).not.toBeNull();
  });

  it('announces coming online to those watching', async () => {
    const { alice, bob } = await pair();
    const watcher = await connect(url, alice.cookie);
    const events = record(watcher, 'presence:update');
    expect((await subscribe(watcher, [bob.id]))[0]?.online).toBe(false);
    await connect(url, bob.cookie);
    await waitUntil(() => expect(events.at(-1)).toMatchObject({ userId: bob.id, online: true }));
  });

  it('treats an away tab as offline, and back again', async () => {
    const { alice, bob } = await pair();
    const watcher = await connect(url, alice.cookie);
    const bobSocket = await connect(url, bob.cookie);
    const events = record(watcher, 'presence:update');
    await subscribe(watcher, [bob.id]);

    await bobSocket.timeout(10_000).emitWithAck('presence:active', { active: false });
    await waitUntil(() => expect(events.at(-1)).toMatchObject({ online: false }));
    await bobSocket.timeout(10_000).emitWithAck('presence:active', { active: true });
    await waitUntil(() => expect(events.at(-1)).toMatchObject({ online: true }));
  });

  it('only sends to those subscribed, and stops after unsubscribing', async () => {
    const { alice, bob } = await pair();
    const watcher = await connect(url, alice.cookie);
    const bystander = await connect(url, alice.cookie);
    const events = record(watcher, 'presence:update');
    const others = record(bystander, 'presence:update');
    await subscribe(watcher, [bob.id]);
    await subscribe(watcher, []);
    const bobSocket = await connect(url, bob.cookie);
    bobSocket.disconnect();
    await settle();
    expect(events).toEqual([]);
    expect(others).toEqual([]);
  });

  it('tells nothing about someone I share no chat with', async () => {
    const { alice } = await pair();
    const stranger = await signedIn(app(), `stranger${seed}@corremadvisory.com`);
    const strangerSocket = await connect(url, stranger.cookie);
    const watcher = await connect(url, alice.cookie);
    const events = record(watcher, 'presence:update');
    expect(await subscribe(watcher, [stranger.id])).toEqual([
      { userId: stranger.id, online: false, lastSeenAt: null },
    ]);
    strangerSocket.disconnect();
    await settle();
    expect(events).toEqual([]);
  });

  it('refuses more than 100 people', async () => {
    const { alice } = await pair();
    const socket = await connect(url, alice.cookie);
    const ack = await socket.timeout(10_000).emitWithAck('presence:subscribe', {
      userIds: Array.from({ length: 101 }, (_, n) => n.toString(16).padStart(24, '0')),
    });
    expect(ack.ok).toBe(false);
  });
});

describe('privacy is reciprocal', () => {
  it('someone hiding is hidden from me: no state, no events', async () => {
    const { alice, bob } = await pair();
    await hideLastSeen(bob, true);
    const watcher = await connect(url, alice.cookie);
    const events = record(watcher, 'presence:update');
    const bobSocket = await connect(url, bob.cookie);
    expect(await subscribe(watcher, [bob.id])).toEqual([
      { userId: bob.id, online: false, lastSeenAt: null },
    ]);
    bobSocket.disconnect();
    await settle();
    expect(events).toEqual([]);
  });

  it('if I hide mine, I cannot see theirs', async () => {
    const { alice, bob } = await pair();
    await hideLastSeen(alice, true);
    const watcher = await connect(url, alice.cookie);
    const events = record(watcher, 'presence:update');
    const bobSocket = await connect(url, bob.cookie);
    expect(await subscribe(watcher, [bob.id])).toEqual([
      { userId: bob.id, online: false, lastSeenAt: null },
    ]);
    bobSocket.disconnect();
    await settle();
    expect(events).toEqual([]);
  });

  it('hiding mine takes effect at once, even for a client that does not ask again', async () => {
    const { alice, bob } = await pair();
    const watcher = await connect(url, alice.cookie);
    const events = record(watcher, 'presence:update');
    const told = record(watcher, 'presence:resubscribe');
    await subscribe(watcher, [bob.id]);
    await hideLastSeen(alice, true);
    await waitUntil(() => expect(told).toHaveLength(1));

    const bobSocket = await connect(url, bob.cookie);
    bobSocket.disconnect();
    await settle();
    expect(events).toEqual([]);
  });

  it('those watching me are told to ask again when I hide, and then see nothing', async () => {
    const { alice, bob } = await pair();
    const watcher = await connect(url, alice.cookie);
    const told = record(watcher, 'presence:resubscribe');
    await connect(url, bob.cookie);
    expect((await subscribe(watcher, [bob.id]))[0]?.online).toBe(true);
    await hideLastSeen(bob, true);
    await waitUntil(() => expect(told).toHaveLength(1));
    expect(await subscribe(watcher, [bob.id])).toEqual([
      { userId: bob.id, online: false, lastSeenAt: null },
    ]);
  });
});

describe.skipIf(!process.env.REDIS_TEST_URL)('presence across two API instances', () => {
  let redis: Redis;
  let one: Awaited<ReturnType<typeof buildTestApp>>;
  let two: Awaited<ReturnType<typeof buildTestApp>>;
  let urlOne: string;
  let urlTwo: string;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_TEST_URL ?? '');
    const deps = {
      realtimeRedis: redis,
      realtimeKey: `zuvo:test:${randomBytes(6).toString('hex')}`,
    };
    const database = `zuvo_test_${randomBytes(6).toString('hex')}`;
    one = await buildTestApp(deps, { MONGODB_DB: database });
    two = await buildTestApp(deps, { MONGODB_DB: database });
    urlOne = await listen(one.app);
    urlTwo = await listen(two.app);
  });
  afterAll(async () => {
    await two.app.close();
    await one.cleanup();
    await redis.quit();
  });

  it('is online while a socket lives on either instance, and watchers hear from both', async () => {
    const alice = await signedIn(one.app, 'twoa@corremadvisory.com');
    const bob = await signedIn(one.app, 'twob@corremadvisory.com');
    await getOrCreateDirectChat(one.app, alice.id, bob.id);
    const watcher = await connect(urlOne, alice.cookie);
    const events = record(watcher, 'presence:update');
    await subscribe(watcher, [bob.id]);

    const onTwo = await connect(urlTwo, bob.cookie);
    await waitUntil(() => expect(events.at(-1)).toMatchObject({ userId: bob.id, online: true }));
    const onOne = await connect(urlOne, bob.cookie);
    expect((await subscribe(watcher, [bob.id]))[0]?.online).toBe(true);

    const gone = nextDisconnect(onOne);
    onOne.disconnect();
    await gone;
    await settle();
    expect((await subscribe(watcher, [bob.id]))[0]?.online).toBe(true);

    onTwo.disconnect();
    await waitUntil(() => expect(events.at(-1)).toMatchObject({ userId: bob.id, online: false }));
  });
});
