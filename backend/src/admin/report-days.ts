import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { registerActivityModels } from '../db/activity-models.ts';

/**
 * The admin dashboard counts days in the organization's time zone, India (UTC+05:30, no daylight
 * saving), so "today" starts at midnight in the office, not in London.
 */
export const REPORT_TIME_ZONE = 'Asia/Kolkata';
const OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** YYYY-MM-DD of `at` in the report time zone. */
export function dayKey(at: Date): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** The moment a report day (YYYY-MM-DD) begins. */
export function dayStart(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - OFFSET_MS);
}

/** The last `count` days, oldest first, ending with the day of `now`. */
export function lastDays(now: Date, count: number): string[] {
  const today = dayStart(dayKey(now)).getTime();
  return Array.from({ length: count }, (_, index) =>
    dayKey(new Date(today - (count - 1 - index) * DAY_MS)),
  );
}

/** The first ObjectId that could have been made at `at` (range queries on `_id`). */
export const idFrom = (at: Date) => Types.ObjectId.createFromTime(Math.floor(at.getTime() / 1000));

/** This person used the app today. Idempotent: one row per person per day. */
export async function recordActivity(app: FastifyInstance, userId: string, now = new Date()) {
  await registerActivityModels(app.mongo).ActivityDay.updateOne(
    { day: dayKey(now), userId: new Types.ObjectId(userId) },
    { $setOnInsert: { at: now } },
    { upsert: true },
  );
}
