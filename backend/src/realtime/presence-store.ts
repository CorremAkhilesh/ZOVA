import type { Redis } from 'ioredis';

/** Who has a live, active socket. Entries nobody refreshes expire, so a crash cannot leave anyone online. */
export interface PresenceStore {
  /** True if this made the user online. */
  add(userId: string, socketId: string): Promise<boolean>;
  /** True if this was the user's last socket. */
  remove(userId: string, socketId: string): Promise<boolean>;
  /** Refreshes sockets that are still connected. */
  heartbeat(entries: Array<[userId: string, socketId: string]>): Promise<void>;
  online(userIds: string[]): Promise<Set<string>>;
  /** Users whose every socket has expired, each reported once across all instances. */
  sweep(): Promise<string[]>;
}

type Clock = () => number;

/** One API instance only: development without Redis, and tests. */
export function memoryPresenceStore(ttlMs: number, now: Clock = Date.now): PresenceStore {
  const users = new Map<string, Map<string, number>>();
  const live = (userId: string) => {
    const sockets = users.get(userId);
    return sockets ? [...sockets.values()].some((expiry) => expiry > now()) : false;
  };
  return {
    async add(userId, socketId) {
      const before = live(userId);
      const sockets = users.get(userId) ?? new Map<string, number>();
      sockets.set(socketId, now() + ttlMs);
      users.set(userId, sockets);
      return !before;
    },
    async remove(userId, socketId) {
      const removed = users.get(userId)?.delete(socketId) ?? false;
      const gone = removed && !live(userId);
      if (gone) users.delete(userId);
      return gone;
    },
    async heartbeat(entries) {
      for (const [userId, socketId] of entries) {
        users.get(userId)?.set(socketId, now() + ttlMs);
      }
    },
    async online(userIds) {
      return new Set(userIds.filter(live));
    },
    async sweep() {
      const expired = [...users.keys()].filter((userId) => !live(userId));
      for (const userId of expired) users.delete(userId);
      return expired;
    },
  };
}

/**
 * Shared by every API instance. One sorted set per user (socket → expiry), and one of all online
 * users (user → latest expiry), so a sweep finds crashed sockets without scanning keys.
 */
export function redisPresenceStore(
  redis: Redis,
  prefix: string,
  ttlMs: number,
  now: Clock = Date.now,
): PresenceStore {
  const socketsKey = (userId: string) => `${prefix}:sockets:${userId}`;
  const allKey = `${prefix}:users`;
  const liveCount = (userId: string) => redis.zcount(socketsKey(userId), now(), '+inf');
  const keyTtlSeconds = Math.ceil((ttlMs * 3) / 1000);

  return {
    async add(userId, socketId) {
      const before = await liveCount(userId);
      const expiry = now() + ttlMs;
      await redis
        .multi()
        .zadd(socketsKey(userId), expiry, socketId)
        .expire(socketsKey(userId), keyTtlSeconds)
        .zadd(allKey, expiry, userId)
        .exec();
      return before === 0;
    },
    async remove(userId, socketId) {
      const removed = await redis.zrem(socketsKey(userId), socketId);
      if (removed === 0 || (await liveCount(userId)) > 0) return false;
      await redis.zrem(allKey, userId);
      return true;
    },
    async heartbeat(entries) {
      if (entries.length === 0) return;
      const expiry = now() + ttlMs;
      const batch = redis.pipeline();
      for (const [userId, socketId] of entries) {
        batch.zadd(socketsKey(userId), expiry, socketId);
        batch.expire(socketsKey(userId), keyTtlSeconds);
        batch.zadd(allKey, expiry, userId);
      }
      await batch.exec();
    },
    async online(userIds) {
      if (userIds.length === 0) return new Set();
      const batch = redis.pipeline();
      for (const userId of userIds) batch.zcount(socketsKey(userId), now(), '+inf');
      const counts = (await batch.exec()) ?? [];
      return new Set(userIds.filter((_, index) => Number(counts[index]?.[1] ?? 0) > 0));
    },
    async sweep() {
      const candidates = await redis.zrangebyscore(allKey, '-inf', now(), 'LIMIT', 0, 200);
      const expired: string[] = [];
      for (const userId of candidates) {
        if ((await liveCount(userId)) > 0) continue;
        // Only the instance that removes the entry reports it.
        if ((await redis.zrem(allKey, userId)) === 1) expired.push(userId);
      }
      return expired;
    },
  };
}
