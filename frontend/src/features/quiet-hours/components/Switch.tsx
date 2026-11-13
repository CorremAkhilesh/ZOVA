import { cn } from '@/lib/utils';

/** A labelled on/off switch (a checkbox underneath, so it works with every input method). */
export function Switch(props: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{props.label}</span>
        <span className="block text-sm text-text-muted">{props.hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={props.checked}
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'relative mt-1 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2',
          props.checked ? 'bg-brand' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
            props.checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </label>
  );
}
