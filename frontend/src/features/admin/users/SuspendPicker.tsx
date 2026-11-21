import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const DAY_MS = 86_400_000;
/** The server's own bounds: 5 minutes to a year ahead. */
const MIN_MS = 5 * 60_000;
const MAX_MS = 366 * DAY_MS;

export type SuspendChoice = { kind: 'days'; days: 1 | 7 } | { kind: 'date'; local: string };

/** When the suspension ends (ISO), or undefined while the chosen date is not valid. */
export function suspendUntilOf(choice: SuspendChoice | null, now = Date.now()): string | undefined {
  if (!choice) return undefined;
  if (choice.kind === 'days') return new Date(now + choice.days * DAY_MS).toISOString();
  // A datetime-local value is the reader's own time zone.
  const at = new Date(choice.local).getTime();
  if (!choice.local || Number.isNaN(at) || at < now + MIN_MS || at > now + MAX_MS) return undefined;
  return new Date(at).toISOString();
}

/** "2026-11-28T18:30" for a datetime-local input, in the reader's time zone. */
function localInputValue(ms: number): string {
  const date = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

const CHIP =
  'tap-target inline-flex min-h-10 cursor-pointer items-center rounded-xl border px-3 text-sm font-medium transition-colors hover:bg-background has-checked:border-brand-text has-checked:bg-brand-subtle has-checked:text-brand-text has-focus-visible:ring-3 has-focus-visible:ring-brand/30';

/** 1 day, 7 days, or until a date and time; it ends on its own then. */
export function SuspendPicker({
  value,
  onChange,
}: {
  value: SuspendChoice | null;
  onChange: (choice: SuspendChoice) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const local = value?.kind === 'date' ? value.local : '';
  const invalid = value?.kind === 'date' && local !== '' && suspendUntilOf(value) === undefined;
  const now = Date.now();
  const options: Array<{ key: string; label: string; checked: boolean; choice: SuspendChoice }> = [
    {
      key: '1',
      label: t('adminPanel.users.suspend.oneDay'),
      checked: value?.kind === 'days' && value.days === 1,
      choice: { kind: 'days', days: 1 },
    },
    {
      key: '7',
      label: t('adminPanel.users.suspend.sevenDays'),
      checked: value?.kind === 'days' && value.days === 7,
      choice: { kind: 'days', days: 7 },
    },
    {
      key: 'date',
      label: t('adminPanel.users.suspend.untilDate'),
      checked: value?.kind === 'date',
      choice: { kind: 'date', local },
    },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{t('adminPanel.users.suspend.label')}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.key} className={CHIP}>
            <input
              type="radio"
              name={`${id}-until`}
              checked={option.checked}
              onChange={() => onChange(option.choice)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      {value?.kind === 'date' ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-date`} className="block text-sm">
            {t('adminPanel.users.suspend.dateLabel')}
          </label>
          <input
            id={`${id}-date`}
            type="datetime-local"
            value={local}
            min={localInputValue(now + MIN_MS)}
            max={localInputValue(now + MAX_MS)}
            onChange={(event) => onChange({ kind: 'date', local: event.target.value })}
            aria-invalid={invalid}
            aria-describedby={`${id}-date-hint`}
            className={cn(
              'h-11 rounded-lg border bg-surface px-3 text-sm shadow-sm outline-none focus-visible:border-brand-text focus-visible:ring-3 focus-visible:ring-brand/20',
              invalid && 'border-danger',
            )}
          />
          <p id={`${id}-date-hint`} className="text-xs text-text-muted">
            {t('adminPanel.users.suspend.dateHint')}
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}
