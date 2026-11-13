/**
 * Two API instances sharing Redis. Runs only when REDIS_TEST_URL is set (CI service container, or
 * database 15 of the local Memurai). The adapter only uses pub/sub channels under a random prefix.
 */
import { randomBytes } from 'node:crypto';
import { messageNewEventSchema } from '@zuvo/protocol';
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
  send,
  signedIn,
  waitUntil,
} from '../../test/realtime-helpers.ts';
import { getOrCreateDirectChat } from '../chats/chats.service.ts';

const redisUrl = process.env.REDIS_TEST_URL;

describe.skipIf(!redisUrl)('two API instances sharing Redis', () => {
  let redis: Redis;
  let one: Awaited<ReturnType<typeof buildTestApp>>;
  let two: Awaited<ReturnType<typeof buildTestApp>>;
  let urlOne: string;
  let urlTwo: string;

  beforeAll(async () => {
    redis = new Redis(redisUrl ?? '');
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
  afterEach(() => closeAllSockets());
  afterAll(async () => {
    await two.app.close();
    await one.cleanup();
    await redis.quit();
  });

  it('delivers across instances, and a revocation on one closes sockets on the other', async () => {
    const alice = await signedIn(one.app, 'alice@corremadvisory.com');
    const bob = await signedIn(one.app, 'bob@corremadvisory.com');
    const { id: chatId } = await getOrCreateDirectChat(one.app, alice.id, bob.id);

    const sender = await connect(urlOne, alice.cookie);
    const senderElsewhere = await connect(urlTwo, alice.cookie);
    const receiverHere = await connect(urlOne, bob.cookie);
    const receiverThere = await connect(urlTwo, bob.cookie);
    const lists = [senderElsewhere, receiverHere, receiverThere].map((socket) =>
      record(socket, 'message:new'),
    );

    const ack = await send(sender, chatId, 'across');
    expect(ack.ok).toBe(true);
    await waitUntil(() => {
      for (const list of lists) expect(list).toHaveLength(1);
    });
    for (const list of lists) {
      expect(messageNewEventSchema.parse(list[0]).message.text).toBe('across');
    }

    const revoked = record(receiverThere, 'session:revoked');
    const closed = nextDisconnect(receiverThere);
    // Sent to instance one; the socket is on instance two.
    await one.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: headers(bob.cookie),
      payload: {},
    });
    expect(await closed).toBe('io server disconnect');
    expect(revoked).toEqual([{ reason: 'revoked' }]);
  });
});
