import type { Redis } from 'ioredis';

/** Minimal expiring-counter storage used by the OTP throttle. */
export interface CounterStore {
  /** Increments `key`, setting its TTL on first use. Returns the new value. */
  increment(key: string, ttlSeconds: number): Promise<number>;
  /** Sets `key` only if absent. Returns true when it was set. */
  setIfAbsent(key: string, ttlSeconds: number): Promise<boolean>;
  /** Seconds until `key` expires; 0 when it does not exist. */
  ttl(key: string): Promise<number>;
  remove(key: string): Promise<void>;
}

/** Redis-backed: shared across API instances (production, staging, local Memurai). */
export class RedisCounterStore implements CounterStore {
  private readonly redis: Pick<Redis, 'multi' | 'set' | 'ttl' | 'del'>;

  constructor(redis: Pick<Redis, 'multi' | 'set' | 'ttl' | 'del'>) {
    this.redis = redis;
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    // NX: only the first increment in a window sets the expiry.
    const results = await this.redis.multi().incr(key).expire(key, ttlSeconds, 'NX').exec();
    const value = results?.[0]?.[1];
    return typeof value === 'number' ? value : Number(value);
  }

  async setIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
  }

  async ttl(key: string): Promise<number> {
    return Math.max(0, await this.redis.ttl(key));
  }

  async remove(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

/** In-process fallback for development without Redis and for tests. Not shared across processes. */
export class MemoryCounterStore implements CounterStore {
  private readonly entries = new Map<string, { value: number; expiresAt: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private live(key: string) {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.live(key);
    if (entry) {
      entry.value += 1;
      return entry.value;
    }
    this.entries.set(key, { value: 1, expiresAt: this.now() + ttlSeconds * 1000 });
    return 1;
  }

  async setIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.live(key)) return false;
    this.entries.set(key, { value: 1, expiresAt: this.now() + ttlSeconds * 1000 });
    return true;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key);
    return entry ? Math.ceil((entry.expiresAt - this.now()) / 1000) : 0;
  }

  async remove(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
