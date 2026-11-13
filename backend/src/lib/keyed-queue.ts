/**
 * Runs tasks with the same key one at a time, in order; other keys run freely. Keeps concurrent
 * work on one record from colliding and retrying within this process (other instances can still
 * collide; the database stays the source of truth).
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Keys with work queued or running (for tests). */
  get size(): number {
    return this.tails.size;
  }
}
