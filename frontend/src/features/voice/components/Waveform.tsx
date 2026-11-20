import { WAVEFORM_MAX } from '@zuvo/protocol';
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { formatDuration } from '@/features/media/process';
import { cn } from '@/lib/utils';

const ARROW_STEP_SECONDS = 5;
const MIN_BAR_PERCENT = 8;
/** A bar is at least 2 px wide with 2 px between bars (`min-w-[2px]`, `gap-[2px]`). */
const BAR_PX = 2;
const GAP_PX = 2;

/**
 * As many bars as fit in `width` px: neighbours are merged, keeping the loudest of each group, so
 * the shape stays and nothing spills out of the bubble. Width 0 (not measured yet): all of them.
 */
export function fitBars(bars: readonly number[], width: number): readonly number[] {
  const room = Math.floor((width + GAP_PX) / (BAR_PX + GAP_PX));
  if (width <= 0 || room >= bars.length || room < 1) return bars;
  return Array.from({ length: room }, (_, index) => {
    const start = Math.floor((index * bars.length) / room);
    const end = Math.max(start + 1, Math.floor(((index + 1) * bars.length) / room));
    return Math.max(...bars.slice(start, end));
  });
}

/** The element's width, kept up to date (0 where ResizeObserver does not exist). */
function useWidth(element: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = element.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

export function nextPosition(key: string, position: number, duration: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowUp')
    return Math.min(duration, position + ARROW_STEP_SECONDS);
  if (key === 'ArrowLeft' || key === 'ArrowDown') return Math.max(0, position - ARROW_STEP_SECONDS);
  if (key === 'Home') return 0;
  if (key === 'End') return duration;
  return null;
}

interface WaveformProps {
  bars: readonly number[];
  label: string;
  position: number;
  duration: number;
  disabled?: boolean;
  /** Classes for the part already heard and the part still to come. */
  playedClass: string;
  restClass: string;
  onSeek: (seconds: number) => void;
  onToggle: () => void;
}

/** The note's shape, which is also where you tap or drag to move through it. */
export function Waveform(props: WaveformProps) {
  const { bars, label, position, duration, disabled, playedClass, restClass, onSeek, onToggle } =
    props;
  const area = useRef<HTMLDivElement>(null);
  const shown = fitBars(bars, useWidth(area));
  const dragging = useRef(false);
  const fraction = duration > 0 ? Math.min(1, position / duration) : 0;

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = area.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    // Right to left is not needed here: time always runs the same way as the bars.
    const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    onSeek(ratio * duration);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') {
      event.preventDefault();
      return onToggle();
    }
    const next = nextPosition(event.key, position, duration);
    if (next === null) return;
    event.preventDefault();
    onSeek(next);
  };

  return (
    <div
      ref={area}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={`${formatDuration(position)} / ${formatDuration(duration)}`}
      onKeyDown={disabled ? undefined : onKeyDown}
      onPointerDown={(event) => {
        if (disabled) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        seekFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) seekFromPointer(event);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      className="flex h-9 min-w-0 flex-1 touch-none items-center gap-[2px] overflow-hidden rounded outline-offset-2"
    >
      {shown.map((bar, index) => (
        <span
          // The bars never change or move once made.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          style={{
            height: `${Math.max(MIN_BAR_PERCENT, (bar / WAVEFORM_MAX) * 100)}%`,
          }}
          className={cn(
            'min-w-[2px] flex-1 rounded-full',
            (index + 0.5) / shown.length <= fraction ? playedClass : restClass,
          )}
        />
      ))}
    </div>
  );
}
