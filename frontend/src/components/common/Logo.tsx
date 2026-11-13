import { brand } from '@zuvo/config';
import { cn } from '@/lib/utils';

/** Brand mark: indigo → teal tile with a stylised "Z". Name comes from brand.ts. */
export function Logo({ className, withName = false }: { className?: string; withName?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 64 64" className="size-9 shrink-0" role="img" aria-label={brand.name}>
        <defs>
          <linearGradient id="zuvo-logo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--color-brand)" />
            <stop offset="1" stopColor="var(--color-accent)" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="18" fill="url(#zuvo-logo)" />
        <path
          d="M20 22h24L22 42h22"
          fill="none"
          stroke="#fff"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {withName ? <span className="text-xl font-bold tracking-tight">{brand.name}</span> : null}
    </span>
  );
}
