import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-full font-semibold tabular-nums',
  {
    variants: {
      variant: {
        brand: 'bg-brand text-brand-foreground',
        accent: 'bg-accent text-accent-foreground',
        muted: 'bg-background text-text-muted border',
        outline: 'border border-warning text-warning',
      },
      size: {
        default: 'h-5 min-w-5 px-1.5 text-xs',
        sm: 'h-4 px-1.5 text-[10px] uppercase tracking-wide',
      },
    },
    defaultVariants: { variant: 'brand', size: 'default' },
  },
);

function Badge({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge };
