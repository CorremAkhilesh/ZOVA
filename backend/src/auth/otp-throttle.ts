import { createHash } from 'node:crypto';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS } from '@zuvo/protocol';
import type { CounterStore } from './counter-store.ts';

const HOUR = 3600;
const DAY = 24 * HOUR;
export const OTP_REQUESTS_PER_EMAIL_PER_HOUR = 5;
/**
 * Wrong codes allowed per email per day, across every code requested in that day. Without it a new
 * code reset the count, so one account could take about 600 guesses a day (ASVS 2.2.1).
 */
export const OTP_FAILURES_PER_EMAIL_PER_DAY = 15;

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
  private readonly ipLimit: () => number;
  private readonly failuresPerDay: () => number;
  private readonly prefix: string;

  /** Limits may be functions: Admin → Settings can change them while the server runs. */
  constructor(
    store: CounterStore,
    options: {
      ipLimitPerHour: number | (() => number);
      failuresPerDay?: number | (() => number);
      prefix?: string;
    },
  ) {
    const read = (value: number | (() => number)) =>
      typeof value === 'function' ? value : () => value;
    this.store = store;
    this.ipLimit = read(options.ipLimitPerHour);
    this.failuresPerDay = read(options.failuresPerDay ?? OTP_FAILURES_PER_EMAIL_PER_DAY);
    this.prefix = options.prefix ?? 'zuvo:auth:';
  }

  private key(kind: string, id: string) {
    return `${this.prefix}${kind}:${id}`;
  }

  /** Counts every OTP request from an IP, including rejected ones. */
  async checkIp(ip: string): Promise<void> {
    const key = this.key('otp-ip', ip);
    if ((await this.store.increment(key, HOUR)) > this.ipLimit()) {
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

  /** Clears the cooldown and hourly cap for one email (test support: repeated sign-ins). */
  async resetEmail(email: string): Promise<void> {
    const id = hashed(email);
    await this.store.remove(this.key('otp-cooldown', id));
    await this.store.remove(this.key('otp-email', id));
  }

  /** A new code starts a fresh attempt count. */
  async resetAttempts(email: string): Promise<void> {
    await this.store.remove(this.key('otp-fail', hashed(email)));
  }

  /** Refuses codes and sign-ins for an email that used up its wrong guesses for the day. */
  async checkLocked(email: string): Promise<void> {
    const left = await this.store.ttl(this.key('otp-locked', hashed(email)));
    if (left > 0) {
      throw new ThrottledError('Too many wrong codes for this email. Try again later.', left);
    }
  }

  /**
   * Records a wrong code and returns how many attempts remain for the current code. The daily
   * count is never reset by a new code or a sign-in; reaching it locks the email until it ends.
   */
  async recordFailure(email: string): Promise<number> {
    const id = hashed(email);
    const daily = this.key('otp-fail-day', id);
    if ((await this.store.increment(daily, DAY)) >= this.failuresPerDay()) {
      await this.store.setIfAbsent(this.key('otp-locked', id), await this.store.ttl(daily));
    }
    const failures = await this.store.increment(this.key('otp-fail', id), OTP_TTL_SECONDS);
    return Math.max(0, OTP_MAX_ATTEMPTS - failures);
  }
}
