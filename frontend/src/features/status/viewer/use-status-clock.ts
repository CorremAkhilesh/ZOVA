import { useEffect, useRef, useState } from 'react';

/**
 * How far through the current status the viewer is, from 0 to 1. Starts again when `key` changes,
 * holds while `paused` (finger down, video buffering, typing a reply, page hidden), and calls
 * `onDone` once at the end.
 */
export function useStatusClock(options: {
  key: string;
  durationMs: number;
  paused: boolean;
  onDone: () => void;
}): number {
  const { key, durationMs, paused } = options;
  const [progress, setProgress] = useState(0);
  const elapsed = useRef(0);
  const shownKey = useRef(key);
  const done = useRef(options.onDone);
  done.current = options.onDone;

  useEffect(() => {
    // A new status: from the start.
    if (shownKey.current !== key) {
      shownKey.current = key;
      elapsed.current = 0;
      setProgress(0);
    }
    if (paused) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      const next = Math.min(1, elapsed.current / Math.max(durationMs, 1));
      setProgress(next);
      if (next >= 1) {
        done.current();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key, paused, durationMs]);

  return key === shownKey.current ? progress : 0;
}
