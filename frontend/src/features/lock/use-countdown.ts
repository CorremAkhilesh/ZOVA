import { useEffect, useRef, useState } from 'react';

const secondsUntil = (until: string | null) =>
  until ? Math.max(0, Math.ceil((Date.parse(until) - Date.now()) / 1000)) : 0;

/** "4:59", "0:07", "59:00". */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Seconds left until `until`, ticking each second; `onEnd` runs once when it reaches 0. */
export function useCountdown(until: string | null, onEnd?: () => void): number {
  const [left, setLeft] = useState(() => secondsUntil(until));
  const end = useRef(onEnd);
  end.current = onEnd;

  useEffect(() => {
    setLeft(secondsUntil(until));
    if (secondsUntil(until) === 0) return;
    const timer = setInterval(() => {
      const next = secondsUntil(until);
      setLeft(next);
      if (next === 0) {
        clearInterval(timer);
        end.current?.();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);

  return left;
}

/** Seconds left of a cooldown that starts again with each `start()`. */
export function useCooldown(seconds: number) {
  const [until, setUntil] = useState<string | null>(null);
  const left = useCountdown(until);
  return {
    left,
    start: () => setUntil(new Date(Date.now() + seconds * 1000).toISOString()),
  };
}
