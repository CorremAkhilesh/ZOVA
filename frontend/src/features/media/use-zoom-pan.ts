import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';

const MAX_ZOOM = 5;
const SWIPE_PX = 60;

function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(1, zoom));
}

/** Zoom with the wheel, buttons, a double click or two fingers; drag to pan once zoomed. */
export function useZoomPan(onSwipe: (direction: 1 | -1) => void) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const swipeFrom = useRef<number | null>(null);

  const apply = (next: number) => {
    const clamped = clampZoom(next);
    setZoom(clamped);
    if (clamped === 1) setPan({ x: 0, y: 0 });
  };

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  return {
    zoom,
    pan,
    reset: () => apply(1),
    apply,
    handlers: {
      onWheel: (event: React.WheelEvent) => apply(zoom * (event.deltaY < 0 ? 1.15 : 0.87)),
      onDoubleClick: () => apply(zoom > 1 ? 1 : 2.5),
      onPointerDown(event: ReactPointerEvent) {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size === 2) pinch.current = { distance: distance(), zoom };
        else swipeFrom.current = event.clientX;
      },
      onPointerMove(event: ReactPointerEvent) {
        const previous = pointers.current.get(event.pointerId);
        if (!previous) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pinch.current && pointers.current.size === 2) {
          apply((pinch.current.zoom * distance()) / pinch.current.distance);
        } else if (zoom > 1) {
          setPan((at) => ({
            x: at.x + event.clientX - previous.x,
            y: at.y + event.clientY - previous.y,
          }));
        }
      },
      onPointerUp(event: ReactPointerEvent) {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        const from = swipeFrom.current;
        swipeFrom.current = null;
        if (from === null || zoom > 1) return;
        const moved = event.clientX - from;
        if (Math.abs(moved) >= SWIPE_PX) onSwipe(moved < 0 ? 1 : -1);
      },
    },
  };
}
