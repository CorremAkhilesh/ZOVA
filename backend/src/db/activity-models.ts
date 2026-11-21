import { type Connection, type Model, Schema, type Types } from 'mongoose';

/**
 * One row per person per day they used the app (Admin → Dashboard: active today, in 7 days, and
 * the 30-day chart). Written at most once per session every 5 minutes (`trackActivity`). Nothing
 * about what they did: only that they were there.
 */
export interface ActivityDayDoc {
  /** YYYY-MM-DD in the organization's time zone. */
  day: string;
  userId: Types.ObjectId;
  /** First activity that day; the TTL index removes the row after a year. */
  at: Date;
}

export const ACTIVITY_KEEP_DAYS = 400;

const activityDaySchema = new Schema<ActivityDayDoc>(
  {
    day: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true },
  },
  { versionKey: false, autoCreate: true, collection: 'activity_days' },
);
// Serves: record a day once (upsert on day + userId), active people on a day (count by day),
// and active people across days (distinct userId for day $in). Unique: one row per person per day.
activityDaySchema.index({ day: 1, userId: 1 }, { unique: true });
// TTL: rows go after ACTIVITY_KEEP_DAYS.
activityDaySchema.index({ at: 1 }, { expireAfterSeconds: ACTIVITY_KEEP_DAYS * 86_400 });

export function registerActivityModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return { ActivityDay: model('ActivityDay', activityDaySchema) };
}
