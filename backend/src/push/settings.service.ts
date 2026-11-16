import { DEFAULT_PUSH_SETTINGS, type PushSettings, pushSettingsSchema } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { type Connection, type Model, Types } from 'mongoose';
import { registerAuthModels } from '../db/auth-models.ts';

/** The user document's own field (Better Auth's `user` collection, like quiet hours). */
interface PushSettingsField {
  _id: Types.ObjectId;
  pushSettings?: Partial<PushSettings> | null;
}

const users = (mongo: Connection) =>
  registerAuthModels(mongo).AuthUser as unknown as Model<PushSettingsField>;

/** Stored settings over the defaults; anything unreadable falls back to the defaults. */
export function toPushSettings(stored: Partial<PushSettings> | null | undefined): PushSettings {
  const parsed = pushSettingsSchema.safeParse({ ...DEFAULT_PUSH_SETTINGS, ...(stored ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_PUSH_SETTINGS;
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
  changes: { showPreview?: boolean | undefined; sound?: boolean | undefined },
): Promise<PushSettings> {
  const set = Object.fromEntries(
    Object.entries(changes)
      .filter(([, value]) => typeof value === 'boolean')
      .map(([key, value]) => [`pushSettings.${key}`, value]),
  );
  if (Object.keys(set).length > 0) {
    await users(app.mongo).updateOne({ _id: new Types.ObjectId(userId) }, { $set: set });
  }
  const settings = await pushSettingsFor(app.mongo, userId);
  app.realtime.emitToUser(userId, 'push:updated', { settings });
  return settings;
}
