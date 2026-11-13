const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60],
];

/** "5 min ago", "2 hr ago", "just now"-style text in the given language. */
export function formatRelativeTime(iso: string, language: string, now = Date.now()): string {
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' });
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  }
  return format.format(0, 'second');
}
