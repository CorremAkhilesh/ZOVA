import { WAVEFORM_MAX } from '@zuvo/protocol';
import { type KeyboardEvent, type PointerEvent, useRef } from 'react';
import { formatDuration } from '@/features/media/process';
import { cn } from '@/lib/utils';

const ARROW_STEP_SECONDS = 5;
const MIN_BAR_PERCENT = 8;

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
      className="flex h-9 min-w-0 flex-1 touch-none items-center gap-[2px] rounded outline-offset-2"
    >
      {bars.map((bar, index) => (
        <span
          // The bars never change or move once made.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          style={{
            height: `${Math.max(MIN_BAR_PERCENT, (bar / WAVEFORM_MAX) * 100)}%`,
          }}
          className={cn(
            'min-w-[2px] flex-1 rounded-full',
            (index + 0.5) / bars.length <= fraction ? playedClass : restClass,
          )}
        />
      ))}
    </div>
  );
}
