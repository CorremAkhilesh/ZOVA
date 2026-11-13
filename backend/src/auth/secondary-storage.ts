import type { SecondaryStorage } from 'better-auth';
import type { Redis } from 'ioredis';

const PREFIX = 'zuvo:ba:';

/** Better Auth secondary storage on Redis: rate limits, verification data and a session cache. */
export function redisSecondaryStorage(redis: Redis): SecondaryStorage {
  return {
    get: (key) => redis.get(PREFIX + key),
    getAndDelete: (key) => redis.getdel(PREFIX + key),
    increment: async (key, ttl) => {
      const results = await redis
        .multi()
        .incr(PREFIX + key)
        .expire(PREFIX + key, ttl, 'NX')
        .exec();
      return Number(results?.[0]?.[1] ?? 0);
    },
    set: async (key, value, ttl) => {
      if (ttl && ttl > 0) await redis.set(PREFIX + key, value, 'EX', Math.ceil(ttl));
      else await redis.set(PREFIX + key, value);
    },
    delete: async (key) => {
      await redis.del(PREFIX + key);
    },
  };
}
