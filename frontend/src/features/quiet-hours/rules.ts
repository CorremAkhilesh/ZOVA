import { DEFAULT_QUIET_HOURS, DEFAULT_TIMEZONE, type QuietHours } from '@zuvo/protocol';

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKENDS = [0, 6];
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** A short list to pick from; the browser's own zone and the saved one are added when missing. */
export const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
];

export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone.length > 0 && zone.length <= 64;
  } catch {
    return false;
  }
}

/** This device's timezone, or India's when the browser does not say. */
export function browserTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimezone(zone) ? zone : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function timezoneOptions(...extra: string[]): string[] {
  return [...new Set([...extra.filter(isValidTimezone), ...COMMON_TIMEZONES])];
}

/** Never set up: start from this device's timezone rather than the server's default. */
export function initialForm(saved: QuietHours): QuietHours {
  const untouched =
    saved.mode === 'off' &&
    saved.timezone === DEFAULT_QUIET_HOURS.timezone &&
    saved.allowChatIds.length === 0;
  return untouched ? { ...saved, timezone: browserTimezone() } : saved;
}

export type QuietProblem = 'sameTimes' | 'noDays' | 'badTimezone';

/** What stops these settings from being saved; null when they are fine. */
export function quietProblem(form: QuietHours): QuietProblem | null {
  if (!isValidTimezone(form.timezone)) return 'badTimezone';
  if (form.mode !== 'scheduled') return null;
  if (form.start === form.end) return 'sameTimes';
  if (form.days.length === 0) return 'noDays';
  return null;
}

export const sameDays = (a: number[], b: number[]) =>
  a.length === b.length && a.every((day) => b.includes(day));
