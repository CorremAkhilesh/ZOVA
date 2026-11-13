import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { memoryPresenceStore, type PresenceStore, redisPresenceStore } from './presence-store.ts';

describe.each([
  ['in memory', (): Redis | null => null],
  [
    'in Redis',
    (): Redis | null => (process.env.REDIS_TEST_URL ? new Redis(process.env.REDIS_TEST_URL) : null),
  ],
] as const)('presence store %s', (name, createRedis) => {
  const redis = createRedis();
  const skip = name === 'in Redis' && !redis;
  let time = 1_000_000;
  const clock = () => time;
  const newStore = (): PresenceStore =>
    redis
      ? redisPresenceStore(redis, `zuvo:test:${randomBytes(6).toString('hex')}`, 1000, clock)
      : memoryPresenceStore(1000, clock);

  afterAll(async () => {
    await redis?.quit();
  });

  it.skipIf(skip)('tracks the first and the last socket of a user', async () => {
    const store = newStore();
    expect(await store.add('u', 's1')).toBe(true);
    expect(await store.add('u', 's2')).toBe(false);
    expect(await store.online(['u', 'v'])).toEqual(new Set(['u']));
    expect(await store.remove('u', 's1')).toBe(false);
    expect(await store.remove('u', 's2')).toBe(true);
    expect(await store.remove('u', 's2')).toBe(false);
    expect(await store.online(['u'])).toEqual(new Set());
  });

  it.skipIf(skip)('a crashed socket goes offline; a heartbeat keeps a live one', async () => {
    const store = newStore();
    await store.add('crashed', 's1');
    await store.add('alive', 's2');
    time += 800;
    await store.heartbeat([['alive', 's2']]);
    expect(await store.sweep()).toEqual([]);
    time += 300;
    expect(await store.online(['crashed', 'alive'])).toEqual(new Set(['alive']));
    expect(await store.sweep()).toEqual(['crashed']);
    // Reported once only.
    expect(await store.sweep()).toEqual([]);
  });
});
