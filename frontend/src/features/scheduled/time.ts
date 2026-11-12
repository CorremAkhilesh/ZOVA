import { SCHEDULE_AHEAD_MAX_DAYS } from '@zuvo/protocol';

/** Where the browser can't say (some locked-down or old ones), the people using Zuvo mostly are. */
export const DEFAULT_ZONE = 'Asia/Kolkata';
/** The picker works in whole minutes, so anything sooner than this is "too soon" here. */
export const MIN_LEAD_MS = 60_000;
export const QUICK_HOUR = 9;

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_ZONE;
  } catch {
    return DEFAULT_ZONE;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** What a clock on the wall in `zone` shows at this moment. */
export function wallClock(at: Date, zone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    hour: Number(part('hour')) % 24,
    minute: Number(part('minute')),
    second: Number(part('second')),
    weekday: WEEKDAYS.indexOf(part('weekday')),
  };
}

/** How far `zone` is ahead of UTC at this moment, in ms. */
function offsetAt(at: number, zone: string): number {
  const wall = wallClock(new Date(at), zone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The moment a wall clock in `zone` shows this date and time (checked again across DST changes). */
export function zonedTime(
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  zone: string,
): Date {
  const asUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = asUtc - offsetAt(asUtc, zone);
  return new Date(asUtc - offsetAt(first, zone));
}

/** `days` after today's date in `zone`, at hour:00 there. */
function daysAhead(now: Date, zone: string, days: number, hour: number): Date {
  const today = wallClock(now, zone);
  const day = new Date(Date.UTC(today.year, today.month - 1, today.day + days));
  return zonedTime(
    { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() },
    hour,
    0,
    zone,
  );
}

export const tomorrowAt = (now: Date, zone: string, hour = QUICK_HOUR) =>
  daysAhead(now, zone, 1, hour);

/** The coming Monday; on a Monday, the one a week later. */
export function nextMondayAt(now: Date, zone: string, hour = QUICK_HOUR): Date {
  const { weekday } = wallClock(now, zone);
  return daysAhead(now, zone, (8 - weekday) % 7 || 7, hour);
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** For `<input type="date">` and `<input type="time">`, as seen in `zone`. */
export function toInputs(at: Date, zone: string): { date: string; time: string } {
  const wall = wallClock(at, zone);
  return {
    date: `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`,
    time: `${pad(wall.hour)}:${pad(wall.minute)}`,
  };
}

/** The picker's date and time in `zone`; null if either is missing or malformed. */
export function fromInputs(date: string, time: string, zone: string): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  const clock = /^(\d{2}):(\d{2})$/u.exec(time);
  if (!day || !clock) return null;
  const [year, month, dayOfMonth] = day.slice(1).map(Number) as [number, number, number];
  const [hour, minute] = clock.slice(1).map(Number) as [number, number];
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31 || hour > 23 || minute > 59) {
    return null;
  }
  return zonedTime({ year, month, day: dayOfMonth }, hour, minute, zone);
}

export type SendAtProblem = 'invalid' | 'past' | 'tooSoon' | 'tooFar';

/** The same limits the server applies, checked before asking it. */
export function checkSendAt(at: Date | null, now: Date): SendAtProblem | null {
  if (!at || Number.isNaN(at.getTime())) return 'invalid';
  const ahead = at.getTime() - now.getTime();
  if (ahead <= 0) return 'past';
  if (ahead < MIN_LEAD_MS) return 'tooSoon';
  if (ahead > SCHEDULE_AHEAD_MAX_DAYS * 86_400_000) return 'tooFar';
  return null;
}

/** "GMT+5:30", for the label next to the picker. */
export function zoneOffsetName(zone: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'shortOffset',
  }).formatToParts(at);
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}

export const formatSendAt = (at: string | Date, locale: string, zone: string) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  }).format(new Date(at));
