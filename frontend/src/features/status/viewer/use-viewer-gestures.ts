import { type PointerEvent, useEffect, useRef, useState } from 'react';

const TAP_MS = 300;
const SLOP_PX = 20;
const SWIPE_PX = 80;

/** Whether the page is hidden (another tab, the phone locked): the status waits. */
export function usePageHidden() {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return hidden;
}

/**
 * The picture's touch and mouse gestures: a quick tap on the left third goes back, elsewhere
 * forward; holding pauses (`holding`); a swipe down closes, a swipe up opens the reply (or, on my
 * own status, who viewed it).
 */
export function useViewerGestures(actions: {
  tap: (side: 'left' | 'right') => void;
  close: () => void;
  swipeUp: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const press = useRef<{ x: number; y: number; at: number } | null>(null);
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    press.current = { x: event.clientX, y: event.clientY, at: Date.now() };
    setHolding(true);
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = press.current;
    press.current = null;
    setHolding(false);
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) > SWIPE_PX && Math.abs(dy) > Math.abs(dx)) {
      if (dy > 0) actions.close();
      else actions.swipeUp();
      return;
    }
    if (Date.now() - start.at > TAP_MS || Math.abs(dx) > SLOP_PX || Math.abs(dy) > SLOP_PX) return;
    const box = event.currentTarget.getBoundingClientRect();
    actions.tap(event.clientX - box.left < box.width / 3 ? 'left' : 'right');
  };
  const onPointerCancel = () => {
    press.current = null;
    setHolding(false);
  };
  return { holding, handlers: { onPointerDown, onPointerUp, onPointerCancel } };
}
