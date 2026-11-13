import { Avatar as AvatarPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn, initials } from '@/lib/utils';

/** Deterministic, token-based fallback tints so the same person always gets the same color. */
const TINTS = [
  'bg-brand-subtle text-brand-text',
  'bg-accent-subtle text-accent-text',
  'bg-brand text-brand-foreground',
  'bg-accent text-accent-foreground',
];

function tintFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length] ?? TINTS[0] ?? '';
}

interface AvatarProps extends React.ComponentProps<typeof AvatarPrimitive.Root> {
  name: string;
  src?: string | undefined;
  /** Shows a presence dot. */
  online?: boolean;
}

function Avatar({ name, src, online, className, ...props }: AvatarProps) {
  return (
    <span className="relative inline-flex shrink-0">
      <AvatarPrimitive.Root
        data-slot="avatar"
        className={cn('relative flex size-12 overflow-hidden rounded-full', className)}
        {...props}
      >
        {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
        <AvatarPrimitive.Fallback
          className={cn(
            'flex size-full items-center justify-center text-sm font-semibold',
            tintFor(name),
          )}
        >
          {initials(name)}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      {online ? (
        <span
          aria-hidden
          className="absolute right-0 bottom-0 size-3.5 rounded-full border-2 border-surface bg-accent"
        />
      ) : null}
    </span>
  );
}

export { Avatar };
