import { createHash } from 'node:crypto';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS } from '@zuvo/protocol';
import type { CounterStore } from './counter-store.ts';

const HOUR = 3600;
export const OTP_REQUESTS_PER_EMAIL_PER_HOUR = 5;

/** Thrown when a limit is hit; `retryAfterSeconds` tells the client when to try again. */
export class ThrottledError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'ThrottledError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Emails are hashed in keys: no personal data in Redis key names. */
const hashed = (email: string) => createHash('sha256').update(email).digest('hex').slice(0, 32);

/**
 * OTP abuse limits (CLAUDE.md §4): per-IP requests per hour, a 60 s resend cooldown and
 * at most 5 requests per email per hour, plus failed-attempt counting for "attempts remaining".
 */
export class OtpThrottle {
  private readonly store: CounterStore;
  private readonly ipLimitPerHour: number;
  private readonly prefix: string;

  constructor(store: CounterStore, options: { ipLimitPerHour: number; prefix?: string }) {
    this.store = store;
    this.ipLimitPerHour = options.ipLimitPerHour;
    this.prefix = options.prefix ?? 'zuvo:auth:';
  }

  private key(kind: string, id: string) {
    return `${this.prefix}${kind}:${id}`;
  }

  /** Counts every OTP request from an IP, including rejected ones. */
  async checkIp(ip: string): Promise<void> {
    const key = this.key('otp-ip', ip);
    if ((await this.store.increment(key, HOUR)) > this.ipLimitPerHour) {
      throw new ThrottledError(
        'Too many code requests from this network.',
        await this.store.ttl(key),
      );
    }
  }

  /** Resend cooldown, then the hourly per-email cap. Call only for allowed emails. */
  async checkEmail(email: string): Promise<void> {
    const id = hashed(email);
    const cooldown = this.key('otp-cooldown', id);
    if (!(await this.store.setIfAbsent(cooldown, OTP_RESEND_COOLDOWN_SECONDS))) {
      throw new ThrottledError(
        'Please wait before requesting a new code.',
        await this.store.ttl(cooldown),
      );
    }
    const hourly = this.key('otp-email', id);
    if ((await this.store.increment(hourly, HOUR)) > OTP_REQUESTS_PER_EMAIL_PER_HOUR) {
      throw new ThrottledError(
        'Too many codes requested for this email.',
        await this.store.ttl(hourly),
      );
    }
  }

  /** A new code starts a fresh attempt count. */
  async resetAttempts(email: string): Promise<void> {
    await this.store.remove(this.key('otp-fail', hashed(email)));
  }

  /** Records a wrong code and returns how many attempts remain for the current code. */
  async recordFailure(email: string): Promise<number> {
    const failures = await this.store.increment(
      this.key('otp-fail', hashed(email)),
      OTP_TTL_SECONDS,
    );
    return Math.max(0, OTP_MAX_ATTEMPTS - failures);
  }
}
