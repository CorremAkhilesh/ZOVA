import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expirySweepPlugin, type SweepResult } from './expiry-sweep.ts';

const NOTHING: SweepResult = { messages: 0, viewOnce: 0, files: 0 };

afterEach(() => {
  vi.useRealTimers();
});

describe('expiry sweep plugin', () => {
  it('runs once at startup, then every interval, and stops on close', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const sweep = vi.fn(async () => NOTHING);
    const app = Fastify();
    await app.register(expirySweepPlugin, { every: 30_000, sweep });
    await app.ready();
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(2));
    await app.close();
    vi.advanceTimersByTime(90_000);
    await Promise.resolve();
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('never starts on its own when `every` is null; run() still works, one pass at a time', async () => {
    let active = 0;
    let most = 0;
    const sweep = vi.fn(async () => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { ...NOTHING, messages: 1 };
    });
    const app = Fastify();
    await app.register(expirySweepPlugin, { every: null, sweep });
    await app.ready();
    expect(sweep).not.toHaveBeenCalled();
    const results = await Promise.all([app.expirySweep.run(), app.expirySweep.run()]);
    expect(results.map((result) => result.messages)).toEqual([1, 1]);
    expect(most).toBe(1);
    await app.close();
  });

  it('a failed pass is logged and the next one still runs', async () => {
    const sweep = vi
      .fn<() => Promise<SweepResult>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(NOTHING);
    const app = Fastify();
    await app.register(expirySweepPlugin, { every: null, sweep });
    await expect(app.expirySweep.run()).rejects.toThrow('boom');
    await expect(app.expirySweep.run()).resolves.toEqual(NOTHING);
    await app.close();
  });
});
