import { Redis, type RedisOptions } from 'ioredis';

function tlsFor(url: string): RedisOptions['tls'] {
  return url.startsWith('rediss://') ? {} : undefined;
}

/** Connection for app use (rate limiting, caching): fails requests fast when Redis is down. */
export function createRedis(url: string): Redis {
  const tls = tlsFor(url);
  return new Redis(url, {
    ...(tls ? { tls } : {}),
    connectionName: 'zuvo-api',
    maxRetriesPerRequest: 2,
    connectTimeout: 10_000,
    enableOfflineQueue: true,
  });
}

/** Connection for BullMQ, which requires `maxRetriesPerRequest: null`. */
export function createBullConnection(url: string, name: string): Redis {
  const tls = tlsFor(url);
  return new Redis(url, {
    ...(tls ? { tls } : {}),
    connectionName: name,
    maxRetriesPerRequest: null,
    connectTimeout: 10_000,
  });
}
