import type { ReactNode } from 'react';

const GAP_DEGREES = 6;

/**
 * A ring around an avatar: one segment per status, accent-coloured until seen, then grey.
 * `seen` counts the oldest ones (statuses are seen in order).
 */
export function StatusRing(props: {
  total: number;
  seen: number;
  size?: number;
  children: ReactNode;
}) {
  const { total, seen, size = 52 } = props;
  const radius = size / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const gap = total > 1 ? (GAP_DEGREES / 360) * circumference : 0;
  const segment = circumference / Math.max(total, 1) - gap;
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden
        data-testid="status-ring"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
      >
        {Array.from({ length: Math.max(total, 1) }, (_, index) => (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: one segment per position, never reordered
            key={index}
            data-seen={index < seen}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={2.5}
            strokeLinecap="round"
            className={index < seen ? 'stroke-text-muted/50' : 'stroke-brand'}
            strokeDasharray={`${segment} ${circumference - segment}`}
            strokeDashoffset={-index * (segment + gap)}
          />
        ))}
      </svg>
      <span className="grid place-items-center" style={{ width: size - 8, height: size - 8 }}>
        {props.children}
      </span>
    </span>
  );
}
