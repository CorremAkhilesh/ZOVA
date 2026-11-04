import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withStartLock } from '../../scripts/start-lock.ts';

let dir: string;
let lock: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zuvo-lock-'));
  lock = join(dir, 'start.lock');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('withStartLock', () => {
  it('lets parallel callers in one at a time', async () => {
    let inside = 0;
    let most = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        withStartLock(
          lock,
          async () => {
            inside += 1;
            most = Math.max(most, inside);
            await sleep(20);
            inside -= 1;
          },
          { pollMs: 5 },
        ),
      ),
    );
    expect(most).toBe(1);
  });

  it('releases the lock when the action throws', async () => {
    await expect(
      withStartLock(lock, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('takes over a lock whose process is gone', async () => {
    // Far above any real pid on Linux or Windows.
    writeFileSync(lock, '2147483646');
    await expect(withStartLock(lock, async () => 'ran', { timeoutMs: 1000 })).resolves.toBe('ran');
  });

  it('takes over a lock older than the stale limit even if the pid is alive', async () => {
    writeFileSync(lock, String(process.pid));
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    await expect(withStartLock(lock, async () => 'ran', { timeoutMs: 1000 })).resolves.toBe('ran');
  });

  it('gives up when a live holder keeps the lock', async () => {
    writeFileSync(lock, String(process.pid));
    await expect(
      withStartLock(lock, async () => 'ran', { timeoutMs: 50, pollMs: 5 }),
    ).rejects.toThrow('timed out');
    expect(existsSync(lock)).toBe(true);
  });
});
