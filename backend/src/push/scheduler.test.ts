import { PUSH_COALESCE_SECONDS, PUSH_USER_PER_MINUTE } from '@zuvo/protocol';
import type { Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCounterStore } from '../auth/counter-store.ts';
import { memoryAttendanceStore } from './attendance-store.ts';
import type { PushJob } from './notify.ts';
import { coalesceKey, memoryScheduler, PUSH_COALESCE_MS, queueScheduler } from './scheduler.ts';

const log = { warn: vi.fn() };
const job = (chatId = 'c1', userId = 'u1'): PushJob => ({ userId, chatId });

afterEach(() => {
  vi.useRealTimers();
});

describe('memoryScheduler (no Redis)', () => {
  it(`turns a burst into one run after ${PUSH_COALESCE_SECONDS} s, per person and chat`, async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const scheduler = memoryScheduler(run, log);
    await scheduler.schedule(job());
    vi.advanceTimersByTime(1000);
    await scheduler.schedule(job());
    await scheduler.schedule(job());
    await scheduler.schedule(job('c2'));
    await scheduler.schedule(job('c1', 'u2'));
    expect(scheduler.pending()).toBe(3);
    vi.advanceTimersByTime(PUSH_COALESCE_MS - 1001);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(job());
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(3);
    await scheduler.close();
  });

  it('starts a new window after a run: at most one push per chat per window', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const scheduler = memoryScheduler(run, log, 500);
    await scheduler.schedule(job());
    vi.advanceTimersByTime(500);
    await scheduler.schedule(job());
    vi.advanceTimersByTime(499);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    await scheduler.close();
  });

  it('logs a failed run and keeps going; close drops what is pending', async () => {
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    const scheduler = memoryScheduler(run, log, 10_000);
    await scheduler.schedule(job());
    await scheduler.flush();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', chatId: 'c1' }),
      'push job failed',
    );
    await scheduler.schedule(job());
    await scheduler.close();
    expect(scheduler.pending()).toBe(0);
  });
});

describe('queueScheduler (BullMQ)', () => {
  it('adds one delayed job, deduplicated per person and chat for the window', async () => {
    const add = vi.fn(async () => undefined);
    const queue = { add } as unknown as Queue<PushJob>;
    const scheduler = queueScheduler(() => queue, 4000);
    await scheduler.schedule(job());
    expect(add).toHaveBeenCalledWith('notify', job(), {
      delay: 4000,
      deduplication: { id: coalesceKey(job()), ttl: 4000 },
    });
    // BullMQ refuses ":" in ids.
    expect(coalesceKey(job())).not.toContain(':');
  });
});

describe('per-person push rate', () => {
  it(`allows ${PUSH_USER_PER_MINUTE} a minute, then waits for the next minute`, async () => {
    let time = 0;
    const counter = new MemoryCounterStore(() => time);
    const key = 'zuvo:push:rate:u1';
    for (let n = 1; n <= PUSH_USER_PER_MINUTE; n++) {
      expect(await counter.increment(key, 60)).toBeLessThanOrEqual(PUSH_USER_PER_MINUTE);
    }
    expect(await counter.increment(key, 60)).toBeGreaterThan(PUSH_USER_PER_MINUTE);
    time += 60_000;
    expect(await counter.increment(key, 60)).toBe(1);
  });
});

describe('memoryAttendanceStore', () => {
  it('is attended while any socket of the device is, until it expires without heartbeats', async () => {
    let time = 0;
    const store = memoryAttendanceStore(1000, () => time);
    await store.set('s1', 'a', true);
    await store.set('s1', 'b', true);
    await store.set('s2', 'c', false);
    expect(await store.attended(['s1', 's2'])).toEqual(new Set(['s1']));
    await store.set('s1', 'a', false);
    expect(await store.attended(['s1'])).toEqual(new Set(['s1']));
    time = 900;
    await store.heartbeat([['s1', 'b']]);
    time = 1500;
    expect(await store.attended(['s1'])).toEqual(new Set(['s1']));
    time = 2000;
    expect(await store.attended(['s1'])).toEqual(new Set());
    await store.set('s1', 'b', false);
    expect(await store.attended(['s1'])).toEqual(new Set());
  });
});
