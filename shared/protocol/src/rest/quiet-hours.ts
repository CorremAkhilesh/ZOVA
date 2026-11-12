import { z } from 'zod';

/** Lowercase ObjectId hex. No transform: these schemas are also used to serialize responses. */
const idSchema = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');

export const QUIET_EXCEPTION_CHATS_MAX = 50;
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

/** Do Not Disturb: kept on the server, so notifications (Step 18) follow it on every device. */
export const quietHoursSchema = z.object({
  /** Off; on until turned off; or on a schedule. */
  mode: z.enum(['off', 'on', 'scheduled']),
  /** The schedule, in `timezone`. A start after the end runs over midnight (22:00–08:00). */
  start: timeOfDaySchema,
  end: timeOfDaySchema,
  /** The days a quiet period may start on, 0 = Sunday. */
  days: z.array(z.number().int().min(0).max(6)).max(7),
  timezone: z.string().min(1).max(64),
  /** Still let these through: messages that mention me, and these chats. */
  allowMentions: z.boolean(),
  allowChatIds: z.array(idSchema).max(QUIET_EXCEPTION_CHATS_MAX),
});
export const DEFAULT_QUIET_HOURS: QuietHours = {
  mode: 'off',
  start: '22:00',
  end: '08:00',
  days: [0, 1, 2, 3, 4, 5, 6],
  timezone: DEFAULT_TIMEZONE,
  allowMentions: true,
  allowChatIds: [],
};

/** GET/PUT /v1/me/quiet-hours, and quiet-hours:updated (server → my devices). */
export const quietHoursResponseSchema = z.object({ quietHours: quietHoursSchema });

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The day of the week and minute of the day at `at`, where the person is. */
function localTime(at: Date, timezone: string): { day: number; minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    return localTime(at, DEFAULT_TIMEZONE);
  }
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  return {
    day: WEEKDAYS.indexOf(get('weekday')),
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Is it quiet now? Overnight periods belong to the day they start on. */
export function isQuietAt(settings: QuietHours, at: Date): boolean {
  if (settings.mode === 'off') return false;
  if (settings.mode === 'on') return true;
  const start = minutesOf(settings.start);
  const end = minutesOf(settings.end);
  if (start === end) return false;
  const { day, minute } = localTime(at, settings.timezone);
  if (start < end) return settings.days.includes(day) && minute >= start && minute < end;
  if (minute >= start) return settings.days.includes(day);
  // Early morning: the period started yesterday.
  return minute < end && settings.days.includes((day + 6) % 7);
}

/** Would this message get through while it is quiet? */
export function passesQuietHours(
  settings: QuietHours,
  message: { chatId: string; mentionsMe: boolean },
): boolean {
  return (
    (settings.allowMentions && message.mentionsMe) || settings.allowChatIds.includes(message.chatId)
  );
}

export type QuietHours = z.infer<typeof quietHoursSchema>;
