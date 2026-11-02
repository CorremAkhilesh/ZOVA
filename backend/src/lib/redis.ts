import { Redis, type RedisOptions } from 'ioredis';

type WarnLogger = { warn: (object: object, message: string) => void };

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

/**
 * BullMQ loses jobs if Redis evicts keys under memory pressure, so the policy must be `noeviction`.
 * Logs a warning (never throws) when it is not, or when it cannot be read.
 * Returns the policy, or null if unknown.
 */
export async function checkEvictionPolicy(
  redis: Pick<Redis, 'config'>,
  logger: WarnLogger,
): Promise<string | null> {
  try {
    const reply = (await redis.config('GET', 'maxmemory-policy')) as unknown;
    const policy = Array.isArray(reply) && typeof reply[1] === 'string' ? reply[1] : null;
    if (policy !== 'noeviction') {
      logger.warn(
        { maxmemoryPolicy: policy },
        'redis maxmemory-policy is not "noeviction": background jobs can be lost under memory pressure',
      );
    }
    return policy;
  } catch (error) {
    logger.warn({ err: error }, 'could not read redis maxmemory-policy (CONFIG GET not allowed?)');
    return null;
  }
}
