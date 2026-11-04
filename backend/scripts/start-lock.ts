/**
 * A lock file shared between processes: creating it is atomic, so only one caller wins. A lock left
 * behind by a crashed process is taken over (its holder is gone, or it is older than `staleMs`).
 */
import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

interface LockOptions {
  timeoutMs?: number;
  staleMs?: number;
  pollMs?: number;
}

function holderIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isStale(path: string, staleMs: number): boolean {
  try {
    const pid = Number(readFileSync(path, 'utf8'));
    if (Number.isInteger(pid) && pid > 0 && !holderIsAlive(pid)) return true;
    return Date.now() - statSync(path).mtimeMs > staleMs;
  } catch {
    // Released between our failed create and this read: not stale, just retry.
    return false;
  }
}

function tryCreate(path: string): boolean {
  try {
    const fd = openSync(path, 'wx');
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/** Runs `action` while holding the lock at `path`, waiting for any current holder to finish. */
export async function withStartLock<T>(
  path: string,
  action: () => Promise<T>,
  { timeoutMs = 30_000, staleMs = 60_000, pollMs = 100 }: LockOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (!tryCreate(path)) {
    if (isStale(path, staleMs)) {
      rmSync(path, { force: true });
      continue;
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for the lock at ${path}`);
    await sleep(pollMs);
  }
  try {
    return await action();
  } finally {
    rmSync(path, { force: true });
  }
}
