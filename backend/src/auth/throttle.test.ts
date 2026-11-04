import { describe, expect, it } from 'vitest';
import { MemoryCounterStore } from './counter-store.ts';
import { OtpThrottle, ThrottledError } from './otp-throttle.ts';

function setup(ipLimitPerHour = 3) {
  let now = 1_000_000;
  const store = new MemoryCounterStore(() => now);
  const throttle = new OtpThrottle(store, { ipLimitPerHour });
  return { store, throttle, advance: (seconds: number) => (now += seconds * 1000) };
}

describe('MemoryCounterStore', () => {
  it('counts within the TTL and resets after it', async () => {
    const { store, advance } = setup();
    expect(await store.increment('k', 10)).toBe(1);
    expect(await store.increment('k', 10)).toBe(2);
    expect(await store.ttl('k')).toBe(10);
    advance(11);
    expect(await store.ttl('k')).toBe(0);
    expect(await store.increment('k', 10)).toBe(1);
  });

  it('sets a key only when absent', async () => {
    const { store, advance } = setup();
    expect(await store.setIfAbsent('lock', 5)).toBe(true);
    expect(await store.setIfAbsent('lock', 5)).toBe(false);
    advance(6);
    expect(await store.setIfAbsent('lock', 5)).toBe(true);
    await store.remove('lock');
    expect(await store.setIfAbsent('lock', 5)).toBe(true);
  });
});

describe('OtpThrottle', () => {
  it('limits requests per IP per hour with a retry hint', async () => {
    const { throttle } = setup(2);
    await throttle.checkIp('1.2.3.4');
    await throttle.checkIp('1.2.3.4');
    const error = await throttle.checkIp('1.2.3.4').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ThrottledError);
    expect((error as ThrottledError).retryAfterSeconds).toBe(3600);
    await expect(throttle.checkIp('5.6.7.8')).resolves.toBeUndefined();
  });

  it('enforces the resend cooldown, then the hourly cap per email', async () => {
    const { throttle, advance } = setup();
    await throttle.checkEmail('a@x.com');
    await expect(throttle.checkEmail('a@x.com')).rejects.toMatchObject({ retryAfterSeconds: 60 });
    for (let i = 0; i < 4; i++) {
      advance(61);
      await throttle.checkEmail('a@x.com');
    }
    advance(61);
    await expect(throttle.checkEmail('a@x.com')).rejects.toThrow(/Too many codes/);
  });

  it('counts failed attempts down from 5 and resets on a new code', async () => {
    const { throttle } = setup();
    expect(await throttle.recordFailure('a@x.com')).toBe(4);
    expect(await throttle.recordFailure('a@x.com')).toBe(3);
    await throttle.resetAttempts('a@x.com');
    expect(await throttle.recordFailure('a@x.com')).toBe(4);
  });

  it('never reports negative attempts', async () => {
    const { throttle } = setup();
    for (let i = 0; i < 7; i++) await throttle.recordFailure('a@x.com');
    expect(await throttle.recordFailure('a@x.com')).toBe(0);
  });
});
