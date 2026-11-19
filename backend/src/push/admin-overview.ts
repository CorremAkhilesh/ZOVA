import type { AdminPushDevice, AdminPushPage, DevicePlatform } from '@zuvo/protocol';
import Bowser from 'bowser';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { registerAuthModels } from '../db/auth-models.ts';
import { describeDevice } from '../security/devices.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';
import type { StoredPushClient } from './client-state.ts';
import { pushModels } from './subscriptions.service.ts';

interface SessionRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId | string;
  userAgent?: string | null;
  createdAt: Date;
  lastActiveAt?: Date | null;
  pushClient?: StoredPushClient | null;
}

/** Android, iPhone (and iPad), Windows, Mac, Linux, from the session's user agent. */
export function platformOf(userAgent: string | null | undefined): DevicePlatform {
  if (!userAgent) return 'other';
  const os = Bowser.parse(userAgent).os.name ?? '';
  if (os === 'Android') return 'android';
  if (os === 'iOS' || os === 'iPadOS') return 'iphone';
  if (os === 'Windows') return 'windows';
  if (os === 'macOS') return 'mac';
  if (os === 'Linux' || os === 'Chrome OS') return 'linux';
  return 'other';
}

const iso = (date: Date | null | undefined) => (date ? new Date(date).toISOString() : null);

function toDevice(session: SessionRow, subscribed: Set<string>): AdminPushDevice {
  const { browser, os } = describeDevice(session.userAgent);
  const client = session.pushClient ?? null;
  return {
    id: session._id.toString(),
    label: `${browser} on ${os}`,
    platform: platformOf(session.userAgent),
    installed: typeof client?.installed === 'boolean' ? client.installed : null,
    permission: client?.permission ?? null,
    pushOn: subscribed.has(session._id.toString()),
    lastActiveAt: (session.lastActiveAt ?? session.createdAt).toISOString(),
  };
}

/**
 * Admin → Notifications: active people, oldest account first, cursor on _id (default _id index),
 * each with their signed-in devices (sessions: index userId + expiresAt) and whether each has a push
 * subscription (index userId + createdAt).
 */
export async function adminPushOverview(
  app: FastifyInstance,
  limit: number,
  cursor?: string,
): Promise<AdminPushPage> {
  const filter: Record<string, unknown> = { status: { $ne: 'deactivated' } };
  if (cursor && Types.ObjectId.isValid(cursor)) filter._id = { $gt: new Types.ObjectId(cursor) };
  const docs = (await usersModel(app)
    .find(filter)
    .sort({ _id: 1 })
    .limit(limit + 1)
    .lean()) as UserDoc[];
  const users = docs.slice(0, limit);
  const ids = users.map((user) => user._id);
  const sessions = (await registerAuthModels(app.mongo)
    // Better Auth may store the user id as an ObjectId or as a string: ask for both.
    .AuthSession.find({
      userId: { $in: [...ids, ...ids.map(String)] },
      expiresAt: { $gt: new Date() },
    })
    .sort({ expiresAt: -1 })
    .lean()) as unknown as SessionRow[];
  const subscriptions = await pushModels(app.mongo)
    .PushSubscription.find({ userId: { $in: ids } })
    .select({ sessionId: 1 })
    .lean();
  const subscribed = new Set(subscriptions.map((row) => row.sessionId));
  const byUser = new Map<string, AdminPushDevice[]>();
  for (const session of sessions) {
    const key = String(session.userId);
    byUser.set(key, [...(byUser.get(key) ?? []), toDevice(session, subscribed)]);
  }
  return {
    items: users.map((user) => {
      const devices = byUser.get(user._id.toString()) ?? [];
      const newest =
        devices
          .map((device) => device.lastActiveAt)
          .sort()
          .at(-1) ?? null;
      return {
        user: {
          id: user._id.toString(),
          email: user.email,
          displayName: user.displayName ?? null,
          username: user.username ?? null,
        },
        devices,
        pushOn: devices.some((device) => device.pushOn),
        lastSeenAt: iso(user.lastSeenAt) ?? newest,
      };
    }),
    nextCursor: docs.length > limit ? (users.at(-1)?._id.toString() ?? null) : null,
  };
}
