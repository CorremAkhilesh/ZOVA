import { type ComponentProps, type RefObject, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const HIDE_AFTER_MS = 900;

/**
 * Native scrolling (keyboard, screen readers and touch all work as usual) with a thin, token-colored
 * scrollbar that only shows on hover, focus or while scrolling. Styles live in globals.css.
 */
export function ScrollArea({
  className,
  onScroll,
  viewportRef,
  ...props
}: ComponentProps<'div'> & { viewportRef?: RefObject<HTMLDivElement | null> }) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = viewportRef ?? ownRef;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Toggle an attribute directly: no React re-render per scroll event.
  const handleScroll = useCallback<NonNullable<ComponentProps<'div'>['onScroll']>>(
    (event) => {
      const element = ref.current;
      if (element) {
        element.dataset.scrolling = '';
        clearTimeout(timer.current);
        timer.current = setTimeout(() => delete element.dataset.scrolling, HIDE_AFTER_MS);
      }
      onScroll?.(event);
    },
    [onScroll, ref],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div
      ref={ref}
      data-slot="scroll-area"
      onScroll={handleScroll}
      className={cn('scroll-area overflow-y-auto overscroll-contain', className)}
      {...props}
    />
  );
}
