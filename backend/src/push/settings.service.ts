import {
  DEFAULT_PUSH_SETTINGS,
  type PushSettings,
  pushSettingsSchema,
  type UpdatePushSettings,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { type Connection, type Model, Types } from 'mongoose';
import { registerAuthModels } from '../db/auth-models.ts';

/** What may be stored: today's settings, plus the older on/off for the send sound. */
type StoredPushSettings = Partial<PushSettings> & { soundSent?: boolean };

/** The user document's own field (Better Auth's `user` collection, like quiet hours). */
interface PushSettingsField {
  _id: Types.ObjectId;
  pushSettings?: StoredPushSettings | null;
}

const users = (mongo: Connection) =>
  registerAuthModels(mongo).AuthUser as unknown as Model<PushSettingsField>;

/**
 * Stored settings over the defaults, field by field: whatever was never set (or cannot be read) is
 * the default, which is "on". So an account that never changed anything gets everything on, with
 * no migration to run, and a setting someone did change is kept.
 */
export function toPushSettings(stored: StoredPushSettings | null | undefined): PushSettings {
  const shape = pushSettingsSchema.shape;
  const merged: Record<string, unknown> = { ...DEFAULT_PUSH_SETTINGS };
  // Before sound choices, "send sound" was on/off only: someone who turned it off keeps it off;
  // everyone else was on the default and gets the new one.
  if (stored?.soundSent === false) merged.sentTone = 'off';
  for (const key of Object.keys(shape) as (keyof PushSettings)[]) {
    const value = stored?.[key];
    if (value !== undefined && shape[key].safeParse(value).success) merged[key] = value;
  }
  return pushSettingsSchema.parse(merged);
}

/** My notification settings, the same on every device (read by _id). */
export async function pushSettingsFor(mongo: Connection, userId: string): Promise<PushSettings> {
  const user = await users(mongo)
    .findById(new Types.ObjectId(userId))
    .select({ pushSettings: 1 })
    .lean();
  return toPushSettings(user?.pushSettings);
}

/** Tells my devices to fetch GET /v1/me/push again (settings or devices changed). */
export async function announcePush(app: FastifyInstance, userId: string) {
  app.realtime.emitToUser(userId, 'push:updated', {
    settings: await pushSettingsFor(app.mongo, userId),
  });
}

/** Changes only what was sent. */
export async function updatePushSettings(
  app: FastifyInstance,
  userId: string,
  changes: UpdatePushSettings,
): Promise<PushSettings> {
  const set = Object.fromEntries(
    Object.entries(changes)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [`pushSettings.${key}`, value]),
  );
  if (Object.keys(set).length > 0) {
    await users(app.mongo).updateOne({ _id: new Types.ObjectId(userId) }, { $set: set });
  }
  const settings = await pushSettingsFor(app.mongo, userId);
  app.realtime.emitToUser(userId, 'push:updated', { settings });
  return settings;
}
