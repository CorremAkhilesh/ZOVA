import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyedQueue } from '../lib/keyed-queue.ts';
import { armSessionExpiry, closeSocket } from './session-guard.ts';

function fakeSocket() {
  const calls: string[] = [];
  let onDisconnect = () => {};
  return {
    calls,
    disconnectNow: () => onDisconnect(),
    emit: (_event: 'session:revoked', payload: { reason: string }) => {
      calls.push(`emit:${payload.reason}`);
    },
    disconnect: () => {
      calls.push('disconnect');
    },
    once: (_event: 'disconnect', listener: () => void) => {
      onDisconnect = listener;
    },
  };
}

describe('session expiry on a socket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says why and disconnects exactly at expiry, not a moment before', () => {
    const socket = fakeSocket();
    armSessionExpiry(socket, new Date('2026-11-04T10:00:05Z'));
    vi.advanceTimersByTime(4999);
    expect(socket.calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(socket.calls).toEqual(['emit:expired', 'disconnect']);
  });

  it('handles a session longer than the largest timer', () => {
    const socket = fakeSocket();
    const days = 30;
    armSessionExpiry(socket, new Date(Date.now() + days * 86_400_000));
    vi.advanceTimersByTime(25 * 86_400_000);
    expect(socket.calls).toEqual([]);
    vi.advanceTimersByTime(5 * 86_400_000);
    expect(socket.calls).toEqual(['emit:expired', 'disconnect']);
  });

  it('closes at once when already expired, and stops the timer after a disconnect', () => {
    const late = fakeSocket();
    armSessionExpiry(late, new Date(Date.now() - 1));
    expect(late.calls).toEqual(['emit:expired', 'disconnect']);

    const gone = fakeSocket();
    armSessionExpiry(gone, new Date(Date.now() + 1000));
    gone.disconnectNow();
    vi.advanceTimersByTime(2000);
    expect(gone.calls).toEqual([]);
  });

  it('emits before it closes', () => {
    const socket = fakeSocket();
    closeSocket(socket, 'revoked');
    expect(socket.calls).toEqual(['emit:revoked', 'disconnect']);
  });
});

describe('KeyedQueue', () => {
  it('runs one key in order, other keys freely, and survives failures', async () => {
    const queue = new KeyedQueue();
    const order: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.run('a', async () => {
      await gate;
      order.push('a1');
    });
    const failing = queue.run('a', async () => {
      order.push('a2');
      throw new Error('boom');
    });
    const third = queue.run('a', async () => {
      order.push('a3');
      return 3;
    });
    await queue.run('b', async () => {
      order.push('b1');
    });
    expect(order).toEqual(['b1']);
    release();
    await first;
    await expect(failing).rejects.toThrow('boom');
    await expect(third).resolves.toBe(3);
    expect(order).toEqual(['b1', 'a1', 'a2', 'a3']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.size).toBe(0);
  });
});
