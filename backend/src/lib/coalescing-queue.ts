/**
 * Runs a task per key at most once at a time, and folds calls that arrive meanwhile into a single
 * follow-up run. Every caller's promise settles with a run that started after the call, so a task
 * that recomputes state from the database always sees the change that triggered it.
 *
 * For "recompute and publish" work that many events trigger at once (group receipt marks: every
 * member's delivered/read report), where running it per event only makes transactions collide.
 */
export class CoalescingQueue {
  private readonly running = new Map<string, Promise<void>>();
  private readonly waiting = new Map<string, Promise<void>>();

  run(key: string, task: () => Promise<void>): Promise<void> {
    const queued = this.waiting.get(key);
    if (queued) return queued;
    const current = this.running.get(key);
    const start = () => {
      this.waiting.delete(key);
      const run = task();
      this.running.set(key, run);
      const done = () => {
        if (this.running.get(key) === run) this.running.delete(key);
      };
      run.then(done, done);
      return run;
    };
    if (!current) return start();
    const next = current.then(start, start);
    this.waiting.set(key, next);
    return next;
  }

  /** Keys with a run in progress or waiting (for tests). */
  get size(): number {
    return new Set([...this.running.keys(), ...this.waiting.keys()]).size;
  }
}
