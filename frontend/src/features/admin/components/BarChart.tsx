import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface BarPoint {
  date: string;
  value: number;
}

/** "21 Nov" in the reader's language, from YYYY-MM-DD. */
export function shortDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * One series of daily counts as thin bars on a baseline. Hover or touch a day for its value; the
 * same numbers are in a table for screen readers. Light and dark use their own validated indigo.
 */
export function BarChart({ title, points }: { title: string; points: BarPoint[] }) {
  const { t, i18n } = useTranslation();
  const [hovered, setHovered] = useState<number | null>(null);
  const captionId = useId();
  const peak = Math.max(0, ...points.map((point) => point.value));
  const max = Math.max(1, peak);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const shown = hovered === null ? null : points[hovered];
  const first = points[0];
  const last = points.at(-1);

  return (
    <figure
      aria-labelledby={captionId}
      className="space-y-2 rounded-2xl border bg-surface p-4 shadow-sm"
    >
      <figcaption id={captionId} className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-text-muted">
          {t('adminPanel.dashboard.chartTotal', { value: number(total), count: points.length })}
        </span>
      </figcaption>
      <div className="relative">
        <p aria-hidden className="min-h-5 text-xs text-text-muted">
          {shown
            ? `${shortDate(shown.date, i18n.language)}: ${number(shown.value)}`
            : t('adminPanel.dashboard.chartPeak', { value: number(peak) })}
        </p>
        <div
          aria-hidden
          data-chart-bars
          className="flex h-32 items-end gap-0.5 border-b"
          onMouseLeave={() => setHovered(null)}
        >
          {points.map((point, index) => {
            const percent = point.value === 0 ? 0 : Math.max(2, (point.value / max) * 100);
            return (
              // The whole column is the hover target, wider and taller than the bar.
              // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only extra; the bars are aria-hidden and the same numbers are in the table below
              <div
                key={point.date}
                data-chart-column
                className="flex h-full min-w-0 flex-1 items-end justify-center"
                onMouseEnter={() => setHovered(index)}
                onTouchStart={() => setHovered(index)}
              >
                <div
                  className={cn(
                    'w-full max-w-6 rounded-t-[4px] bg-[#4338CA] dark:bg-[#6366F1]',
                    hovered !== null && hovered !== index && 'opacity-40',
                  )}
                  style={{ height: `${percent}%` }}
                />
              </div>
            );
          })}
        </div>
        <div aria-hidden className="mt-1 flex justify-between text-[11px] text-text-muted">
          <span>{first ? shortDate(first.date, i18n.language) : ''}</span>
          <span>{last ? shortDate(last.date, i18n.language) : ''}</span>
        </div>
      </div>
      <table className="sr-only" aria-labelledby={captionId}>
        <thead>
          <tr>
            <th scope="col">{t('adminPanel.dashboard.tableDate')}</th>
            <th scope="col">{t('adminPanel.dashboard.tableValue')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <td>{shortDate(point.date, i18n.language)}</td>
              <td>{number(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
