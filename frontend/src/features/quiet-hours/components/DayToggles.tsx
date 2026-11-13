import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { EVERY_DAY, sameDays, WEEKDAYS, WEEKENDS } from '../rules';

/** Sunday 2026-11-01, so day n of that week is weekday n. */
const SUNDAY = Date.UTC(2026, 10, 1, 12);

function dayName(day: number, locale: string, weekday: 'short' | 'long') {
  return new Intl.DateTimeFormat(locale, { weekday, timeZone: 'UTC' }).format(
    new Date(SUNDAY + day * 86_400_000),
  );
}

const CHIP = 'rounded-full border px-3 py-1 text-sm font-medium transition-colors';

/** Seven day toggles, plus quick picks for weekdays, weekends and every day. */
export function DayToggles(props: { days: number[]; onChange: (days: number[]) => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const { days, onChange } = props;
  const quick = [
    { label: t('quietHours.weekdays'), days: WEEKDAYS },
    { label: t('quietHours.weekends'), days: WEEKENDS },
    { label: t('quietHours.everyDay'), days: EVERY_DAY },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('quietHours.days')}</legend>
      <div className="flex flex-wrap gap-1.5">
        {EVERY_DAY.map((day) => {
          const on = days.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              aria-label={dayName(day, locale, 'long')}
              onClick={() =>
                onChange(on ? days.filter((item) => item !== day) : [...days, day].sort())
              }
              className={cn(
                'size-10 rounded-full border text-sm font-medium transition-colors',
                on
                  ? 'border-brand bg-brand text-brand-foreground'
                  : 'text-text-muted hover:text-text',
              )}
            >
              {dayName(day, locale, 'short')}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {quick.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-pressed={sameDays(days, item.days)}
            onClick={() => onChange(item.days)}
            className={cn(
              CHIP,
              sameDays(days, item.days)
                ? 'border-brand bg-brand-subtle text-brand-text'
                : 'text-text-muted hover:text-text',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
