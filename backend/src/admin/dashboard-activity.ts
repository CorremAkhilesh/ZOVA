import type { AdminDashboard, AdminDayStat } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import { callModels } from '../calls/call-finish.ts';
import { chatModels } from '../chats/chats.service.ts';
import { registerActivityModels } from '../db/activity-models.ts';
import { pushModels } from '../push/subscriptions.service.ts';
import { usersModel } from '../users/user-record.ts';
import { dayStart, idFrom, lastDays, REPORT_TIME_ZONE } from './report-days.ts';

export const SERIES_DAYS = 30;

/** People by status and role. Indexes: status + lastLoginAt, role + status. */
export async function userCounts(app: FastifyInstance) {
  const users = usersModel(app);
  const [total, deactivated, admins] = await Promise.all([
    users.estimatedDocumentCount(),
    users.countDocuments({ status: 'deactivated' }),
    users.countDocuments({ role: 'admin', status: { $ne: 'deactivated' } }),
  ]);
  return { total, deactivated, active: Math.max(0, total - deactivated), admins };
}

/** Per day: how many of `_id`s were made, counted by the time inside each ObjectId. */
const perDayById = (match: Record<string, unknown>) => [
  { $match: match },
  {
    $group: {
      _id: {
        $dateToString: {
          format: '%Y-%m-%d',
          date: { $toDate: '$_id' },
          timezone: REPORT_TIME_ZONE,
        },
      },
      count: { $sum: 1 },
    },
  },
];

type DayCount = { _id: string; count: number };
const toMap = (rows: DayCount[]) => new Map(rows.map((row) => [row._id, row.count]));

/**
 * Messages people sent (not system lines) and calls started, per day since `from`.
 * Index: `_id` (range on the creation time inside it).
 */
export function messagesSince(app: FastifyInstance, from: Date) {
  return chatModels(app).Message.aggregate<DayCount>(
    perDayById({ _id: { $gte: idFrom(from) }, type: { $ne: 'system' } }),
  );
}

export function callsSince(app: FastifyInstance, from: Date) {
  return callModels(app).Call.aggregate<DayCount>(perDayById({ _id: { $gte: idFrom(from) } }));
}

/** Active people on each of `days`. Index: day + userId (count by day). */
export function activeOn(app: FastifyInstance, days: string[]) {
  const { ActivityDay } = registerActivityModels(app.mongo);
  return Promise.all(days.map((day) => ActivityDay.countDocuments({ day })));
}

/** Different people active over `days`. Index: day + userId. */
export async function activeAcross(app: FastifyInstance, days: string[]) {
  const ids = await registerActivityModels(app.mongo).ActivityDay.distinct('userId', {
    day: { $in: days },
  });
  return ids.length;
}

/** People (not deactivated) with push on for a signed-in device. Index: expiresAt (TTL). */
export async function usersWithPush(app: FastifyInstance, now: Date): Promise<number> {
  const ids = (await pushModels(app.mongo).PushSubscription.distinct('userId', {
    expiresAt: { $gt: now },
  })) as Types.ObjectId[];
  if (ids.length === 0) return 0;
  return usersModel(app).countDocuments({ _id: { $in: ids }, status: { $ne: 'deactivated' } });
}

/** The activity half of the dashboard: people, today, the 30-day series and push. */
export async function activityStats(
  app: FastifyInstance,
  now: Date,
): Promise<Pick<AdminDashboard, 'users' | 'today' | 'notifications' | 'series'>> {
  const days = lastDays(now, SERIES_DAYS);
  const from = dayStart(days[0] as string);
  const [counts, active, active7d, messages, calls, withPush] = await Promise.all([
    userCounts(app),
    activeOn(app, days),
    activeAcross(app, days.slice(-7)),
    messagesSince(app, from).then(toMap),
    callsSince(app, from).then(toMap),
    usersWithPush(app, now),
  ]);
  const series: AdminDayStat[] = days.map((date, index) => ({
    date,
    activeUsers: active[index] ?? 0,
    messages: messages.get(date) ?? 0,
    calls: calls.get(date) ?? 0,
  }));
  const today = series.at(-1);
  return {
    users: { ...counts, activeToday: today?.activeUsers ?? 0, active7d },
    today: { messages: today?.messages ?? 0, calls: today?.calls ?? 0 },
    notifications: {
      usersWithPush: withPush,
      percent: counts.active ? Math.round((withPush / counts.active) * 1000) / 10 : 0,
    },
    series,
  };
}
