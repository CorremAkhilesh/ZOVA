import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export const QUOTA_PRESETS_GB = [1, 3, 5, 10, 20] as const;
const MIN_GB = 0.1;
const MAX_GB = 1024;

/** What the admin picked: a preset or custom size in MiB, or the default limit (null). */
export type QuotaChoice =
  | { kind: 'default' }
  | { kind: 'preset'; gb: number }
  | { kind: 'custom'; text: string };

/** MiB to send, `null` for the default, or `undefined` while the custom size is not valid. */
export function quotaMbOf(choice: QuotaChoice | null): number | null | undefined {
  if (!choice) return undefined;
  if (choice.kind === 'default') return null;
  if (choice.kind === 'preset') return choice.gb * 1024;
  const value = Number(choice.text.replace(',', '.'));
  if (choice.text.trim() === '' || !Number.isFinite(value)) return undefined;
  return value >= MIN_GB && value <= MAX_GB ? Math.round(value * 1024) : undefined;
}

/** A radio styled as a chip; the input stays in the label for keyboard and screen readers. */
const CHIP =
  'tap-target inline-flex min-h-10 cursor-pointer items-center rounded-xl border px-3 text-sm font-medium transition-colors hover:bg-background has-checked:border-brand-text has-checked:bg-brand-subtle has-checked:text-brand-text has-focus-visible:ring-3 has-focus-visible:ring-brand/30';

/** Presets, "Custom" with a size in GB, and "Default (3 GB)". */
export function QuotaPicker({
  value,
  onChange,
  defaultGb,
}: {
  value: QuotaChoice | null;
  onChange: (choice: QuotaChoice) => void;
  defaultGb: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  const custom = value?.kind === 'custom' ? value.text : '';
  const customInvalid = value?.kind === 'custom' && quotaMbOf(value) === undefined && custom !== '';
  const options: Array<{ key: string; label: string; checked: boolean; choice: QuotaChoice }> = [
    ...QUOTA_PRESETS_GB.map((gb) => ({
      key: `gb-${gb}`,
      label: t('adminPanel.users.quota.gb', { count: gb }),
      checked: value?.kind === 'preset' && value.gb === gb,
      choice: { kind: 'preset', gb } as const,
    })),
    {
      key: 'default',
      label: t('adminPanel.users.quota.default', { gb: defaultGb }),
      checked: value?.kind === 'default',
      choice: { kind: 'default' },
    },
    {
      key: 'custom',
      label: t('adminPanel.users.quota.custom'),
      checked: value?.kind === 'custom',
      choice: { kind: 'custom', text: custom },
    },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{t('adminPanel.users.quota.label')}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.key} className={CHIP}>
            <input
              type="radio"
              name={`${id}-quota`}
              checked={option.checked}
              onChange={() => onChange(option.choice)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      {value?.kind === 'custom' ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-gb`} className="block text-sm">
            {t('adminPanel.users.quota.customLabel')}
          </label>
          <input
            id={`${id}-gb`}
            inputMode="decimal"
            value={custom}
            onChange={(event) => onChange({ kind: 'custom', text: event.target.value })}
            aria-invalid={customInvalid}
            aria-describedby={`${id}-hint`}
            className={cn(
              'h-11 w-40 rounded-lg border bg-surface px-3 text-sm shadow-sm outline-none focus-visible:border-brand-text focus-visible:ring-3 focus-visible:ring-brand/20',
              customInvalid && 'border-danger',
            )}
          />
          <p id={`${id}-hint`} className="text-xs text-text-muted">
            {t('adminPanel.users.quota.customHint', { min: MIN_GB, max: MAX_GB })}
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}
