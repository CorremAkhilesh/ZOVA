import { Check } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** One choice: a native radio (so arrow keys and names work), drawn as a small preview. */
export function WallpaperTile(props: {
  name: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <label className="relative block cursor-pointer" title={props.label}>
      <input
        type="radio"
        name={props.name}
        checked={props.checked}
        onChange={props.onSelect}
        className="peer sr-only"
      />
      <span className="sr-only">{props.label}</span>
      <span
        aria-hidden
        style={props.style}
        className={cn(
          'flex h-16 w-14 items-center justify-center rounded-xl border bg-background text-xs text-text-muted',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2',
          props.checked && 'border-brand ring-2 ring-brand',
        )}
      >
        {props.children}
      </span>
      {props.checked ? (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-brand text-brand-foreground"
        >
          <Check className="size-3" />
        </span>
      ) : null}
    </label>
  );
}
