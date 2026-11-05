/** A small per-socket rate limit, for events too frequent and too unimportant for a shared counter. */
export function windowLimit(max: number, windowMs: number, now: () => number = Date.now) {
  let started = 0;
  let count = 0;
  return () => {
    const time = now();
    if (time - started >= windowMs) {
      started = time;
      count = 0;
    }
    count += 1;
    return count <= max;
  };
}
