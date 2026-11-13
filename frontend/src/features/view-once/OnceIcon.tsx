import { cn } from '@/lib/utils';

/** A "1" in a dashed circle: the mark for view once. */
export function OnceIcon({ className, faded }: { className?: string; faded?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border-2 font-bold',
        faded ? 'border-dotted opacity-60' : 'border-dashed',
        className,
      )}
    >
      1
    </span>
  );
}
