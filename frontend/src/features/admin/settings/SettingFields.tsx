import { RotateCcw } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const INPUT =
  'h-10 w-28 rounded-lg border bg-surface px-3 text-sm tabular-nums shadow-sm outline-none focus-visible:border-brand-text focus-visible:ring-3 focus-visible:ring-brand/20 pointer-coarse:h-11 aria-[invalid=true]:border-danger';

/**
 * One setting: its name, what it does, the default, and a way back to it. `control` receives the
 * ids to label and describe itself with.
 */
export function SettingRow({
  label,
  hint,
  defaultText,
  overridden,
  onReset,
  error,
  control,
}: {
  label: string;
  hint: string;
  defaultText: string;
  overridden: boolean;
  onReset: () => void;
  error?: string | null;
  control: (ids: { id: string; describedBy: string }) => ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="block font-medium">
          {label}
        </label>
        <p id={hintId} className="text-sm text-text-muted">
          {hint}{' '}
          <span className="whitespace-nowrap">
            {t('adminPanel.settings.default', { value: defaultText })}
          </span>
        </p>
        {error ? (
          <p id={errorId} className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {control({ id, describedBy: error ? `${hintId} ${errorId}` : hintId })}
        {overridden ? (
          <button
            type="button"
            onClick={onReset}
            className="tap-target inline-flex items-center gap-1 rounded-md text-sm font-medium text-brand-text hover:underline"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {t('adminPanel.settings.reset')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function NumberInput({
  id,
  describedBy,
  value,
  unit,
  invalid,
  onChange,
}: {
  id: string;
  describedBy: string;
  value: string;
  unit?: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={INPUT}
      />
      {unit ? <span className="text-sm text-text-muted">{unit}</span> : null}
    </span>
  );
}

export function Toggle({
  id,
  describedBy,
  checked,
  onChange,
}: {
  id: string;
  describedBy: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <span className="relative inline-flex">
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-describedby={describedBy}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute -inset-y-2.5 inset-x-0 z-10 cursor-pointer opacity-0"
      />
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-text peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface',
          checked ? 'bg-brand' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </span>
  );
}

export function Choice({
  id,
  describedBy,
  value,
  options,
  onChange,
}: {
  id: string;
  describedBy: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 rounded-lg border bg-surface px-3 text-sm shadow-sm outline-none focus-visible:border-brand-text focus-visible:ring-3 focus-visible:ring-brand/20 pointer-coarse:h-11"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
