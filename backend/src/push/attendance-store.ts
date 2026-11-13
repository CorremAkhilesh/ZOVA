import type { Redis } from 'ioredis';

/**
 * Which devices (sessions) someone is looking at right now: a tab that is visible and focused.
 * Per socket, so one device with two tabs is attended while either one is. Entries nobody refreshes
 * expire, so a crashed API instance cannot leave a device "attended" and silence its pushes.
 */
export interface AttendanceStore {
  set(sessionId: string, socketId: string, attended: boolean): Promise<void>;
  /** Refreshes sockets that are still attended. */
  heartbeat(entries: Array<[sessionId: string, socketId: string]>): Promise<void>;
  /** Of these sessions, the ones with an attended socket. */
  attended(sessionIds: string[]): Promise<Set<string>>;
}

export const ATTENDANCE_TTL_MS = 45_000;
export const ATTENDANCE_HEARTBEAT_MS = 15_000;
/** Shared by the API (writes) and the worker (reads at send time). */
export const ATTENDANCE_PREFIX = 'zuvo:push:attended';

type Clock = () => number;

/** One process only: development without Redis, tests and the E2E server. */
export function memoryAttendanceStore(
  ttlMs = ATTENDANCE_TTL_MS,
  now: Clock = Date.now,
): AttendanceStore {
  const sessions = new Map<string, Map<string, number>>();
  return {
    async set(sessionId, socketId, attended) {
      const sockets = sessions.get(sessionId) ?? new Map<string, number>();
      if (attended) sockets.set(socketId, now() + ttlMs);
      else sockets.delete(socketId);
      if (sockets.size > 0) sessions.set(sessionId, sockets);
      else sessions.delete(sessionId);
    },
    async heartbeat(entries) {
      for (const [sessionId, socketId] of entries) {
        sessions.get(sessionId)?.set(socketId, now() + ttlMs);
      }
    },
    async attended(sessionIds) {
      const live = (sessionId: string) =>
        [...(sessions.get(sessionId)?.values() ?? [])].some((expiry) => expiry > now());
      return new Set(sessionIds.filter(live));
    },
  };
}

/** Every API instance and the worker: one sorted set per session (socket → expiry). */
export function redisAttendanceStore(
  redis: Pick<Redis, 'multi' | 'pipeline' | 'zrem'>,
  prefix = ATTENDANCE_PREFIX,
  ttlMs = ATTENDANCE_TTL_MS,
  now: Clock = Date.now,
): AttendanceStore {
  const key = (sessionId: string) => `${prefix}:${sessionId}`;
  const keyTtlSeconds = Math.ceil((ttlMs * 3) / 1000);
  return {
    async set(sessionId, socketId, attended) {
      if (!attended) {
        await redis.zrem(key(sessionId), socketId);
        return;
      }
      await redis
        .multi()
        .zadd(key(sessionId), now() + ttlMs, socketId)
        .expire(key(sessionId), keyTtlSeconds)
        .exec();
    },
    async heartbeat(entries) {
      if (entries.length === 0) return;
      const batch = redis.pipeline();
      for (const [sessionId, socketId] of entries) {
        // XX: only sockets still in the set; one that just left stays out.
        batch.zadd(key(sessionId), 'XX', now() + ttlMs, socketId);
        batch.expire(key(sessionId), keyTtlSeconds);
      }
      await batch.exec();
    },
    async attended(sessionIds) {
      if (sessionIds.length === 0) return new Set();
      const batch = redis.pipeline();
      for (const sessionId of sessionIds) batch.zcount(key(sessionId), now(), '+inf');
      const counts = (await batch.exec()) ?? [];
      return new Set(sessionIds.filter((_, index) => Number(counts[index]?.[1] ?? 0) > 0));
    },
  };
}
