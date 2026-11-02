import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { maskCredentials } from './logger.ts';
import { parseRange } from './range.ts';
import { checkEvictionPolicy } from './redis.ts';
import { withTimeout } from './timeout.ts';

describe('parseRange', () => {
  const size = 1000;

  it.each([
    [undefined, { kind: 'none' }],
    ['items=0-1', { kind: 'none' }],
    ['bytes=0-99,200-299', { kind: 'none' }],
    ['bytes=0-99', { kind: 'range', range: { start: 0, end: 99 } }],
    ['bytes=500-', { kind: 'range', range: { start: 500, end: 999 } }],
    ['bytes=-100', { kind: 'range', range: { start: 900, end: 999 } }],
    ['bytes=-5000', { kind: 'range', range: { start: 0, end: 999 } }],
    ['bytes=900-5000', { kind: 'range', range: { start: 900, end: 999 } }],
    ['bytes=1000-', { kind: 'unsatisfiable' }],
    ['bytes=50-10', { kind: 'unsatisfiable' }],
    ['bytes=-0', { kind: 'unsatisfiable' }],
    ['bytes=-', { kind: 'unsatisfiable' }],
  ])('%s → %j', (header, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });

  it('treats any range on an empty file as unsatisfiable', () => {
    expect(parseRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' });
  });
});

describe('maskCredentials', () => {
  it.each([
    [
      'failed: mongodb+srv://user:p%40ss@cluster0.example.net/?x=1',
      'failed: mongodb+srv://[redacted]@cluster0.example.net/?x=1',
    ],
    [
      'rediss://default:secret@redis.example.com:6380',
      'rediss://[redacted]@redis.example.com:6380',
    ],
    ['no url here', 'no url here'],
    ['https://example.com/path', 'https://example.com/path'],
  ])('%s', (input, expected) => {
    expect(maskCredentials(input)).toBe(expected);
  });
});

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 100, 'fast')).resolves.toBe(42);
  });

  it('rejects with a labelled error when it takes too long', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(slow, 10, 'slow op')).rejects.toThrow('slow op timed out after 10 ms');
  });
});

describe('checkEvictionPolicy', () => {
  const collect = () => {
    const warnings: string[] = [];
    return {
      warnings,
      logger: { warn: (_object: object, message: string) => warnings.push(message) },
    };
  };
  const stub = (config: () => Promise<unknown>) => ({ config }) as unknown as Pick<Redis, 'config'>;

  it('accepts noeviction silently', async () => {
    const { warnings, logger } = collect();
    const policy = await checkEvictionPolicy(
      stub(async () => ['maxmemory-policy', 'noeviction']),
      logger,
    );
    expect(policy).toBe('noeviction');
    expect(warnings).toEqual([]);
  });

  it('warns about any other policy', async () => {
    const { warnings, logger } = collect();
    const policy = await checkEvictionPolicy(
      stub(async () => ['maxmemory-policy', 'allkeys-lru']),
      logger,
    );
    expect(policy).toBe('allkeys-lru');
    expect(warnings[0]).toMatch(/not "noeviction"/);
  });

  it('warns instead of throwing when CONFIG GET is not allowed', async () => {
    const { warnings, logger } = collect();
    const policy = await checkEvictionPolicy(
      stub(async () => {
        throw new Error('NOPERM');
      }),
      logger,
    );
    expect(policy).toBeNull();
    expect(warnings[0]).toMatch(/could not read/);
  });
});
