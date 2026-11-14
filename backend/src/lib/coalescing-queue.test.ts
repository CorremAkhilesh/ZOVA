import { describe, expect, it } from 'vitest';
import { CoalescingQueue } from './coalescing-queue.ts';

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe('CoalescingQueue', () => {
  it('runs at once when idle, and folds calls during a run into one more run', async () => {
    const queue = new CoalescingQueue();
    const first = gate();
    const starts: number[] = [];
    let runs = 0;
    const task = async () => {
      runs += 1;
      starts.push(runs);
      if (runs === 1) await first.opened;
    };
    const a = queue.run('chat', task);
    const followers = [queue.run('chat', task), queue.run('chat', task), queue.run('chat', task)];
    expect(runs).toBe(1);
    // Every caller during the first run shares the same follow-up.
    expect(followers[1]).toBe(followers[0]);
    first.open();
    await Promise.all([a, ...followers]);
    expect(runs).toBe(2);
    expect(queue.size).toBe(0);
  });

  it('a call made while the follow-up runs gets a run of its own, after it', async () => {
    const queue = new CoalescingQueue();
    const order: string[] = [];
    const second = gate();
    const task = (name: string, wait?: Promise<void>) => async () => {
      order.push(`start ${name}`);
      if (wait) await wait;
      order.push(`end ${name}`);
    };
    const one = queue.run('k', task('one'));
    const two = queue.run('k', task('two', second.opened));
    await one;
    while (!order.includes('start two')) await Promise.resolve();
    const three = queue.run('k', task('three'));
    second.open();
    await Promise.all([two, three]);
    expect(order).toEqual([
      'start one',
      'end one',
      'start two',
      'end two',
      'start three',
      'end three',
    ]);
  });

  it('keeps keys apart and passes failures to the callers of that run only', async () => {
    const queue = new CoalescingQueue();
    const failing = queue.run('a', async () => {
      throw new Error('boom');
    });
    const other = queue.run('b', async () => {});
    await expect(failing).rejects.toThrow('boom');
    await expect(other).resolves.toBeUndefined();
    // After a failure the key runs again normally.
    await expect(queue.run('a', async () => {})).resolves.toBeUndefined();
    expect(queue.size).toBe(0);
  });
});
