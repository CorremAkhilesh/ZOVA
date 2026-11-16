import type { PushDevice, PushSubscriptionBody } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { type Connection, Types } from 'mongoose';
import type { AuthSessionRecord } from '../auth/session.ts';
import { isDuplicateKey } from '../chats/chats.service.ts';
import { registerAuthModels } from '../db/auth-models.ts';
import { type PushSubscriptionDoc, registerPushModels } from '../db/push-models.ts';
import { AppError } from '../lib/errors.ts';
import { describeDevice } from '../security/devices.ts';
import { announcePush } from './settings.service.ts';
import { isValidSubscriptionKeys } from './vapid.ts';

export const pushModels = (mongo: Connection) => registerPushModels(mongo);
const oid = (id: string) => new Types.ObjectId(id);

export function toPushDevice(doc: PushSubscriptionDoc, currentSessionId: string): PushDevice {
  return {
    id: doc._id.toString(),
    label: doc.label,
    current: doc.sessionId === currentSessionId,
    createdAt: doc.createdAt.toISOString(),
    lastUsedAt: doc.lastUsedAt ? doc.lastUsedAt.toISOString() : null,
  };
}

/** "Chrome on Windows 10", or the name the person gave this device in Settings → Devices. */
export function deviceLabel(userAgent: string | null | undefined, name?: string | null): string {
  if (name) return name;
  const device = describeDevice(userAgent);
  return `${device.browser.replace(/\s+\d+$/, '')} on ${device.os}`;
}

/** My devices with push on, newest first. */
export async function listPushDevices(app: FastifyInstance, userId: string, sessionId: string) {
  const docs = await pushModels(app.mongo)
    .PushSubscription.find({ userId: oid(userId) })
    .sort({ createdAt: -1 })
    .lean();
  return docs.map((doc) => toPushDevice(doc, sessionId));
}

/**
 * This browser's subscription, for this session. The endpoint is unique: if it was someone else's
 * (another account signed in on this browser) it moves here. A device keeps one subscription.
 */
export async function subscribe(
  app: FastifyInstance,
  userId: string,
  session: Pick<AuthSessionRecord, 'id' | 'expiresAt'>,
  body: PushSubscriptionBody,
): Promise<PushDevice> {
  if (!isValidSubscriptionKeys(body.keys)) {
    throw new AppError('BAD_REQUEST', 'These push subscription keys are not valid.', {
      field: 'keys',
    });
  }
  const { PushSubscription } = pushModels(app.mongo);
  const record = (await registerAuthModels(app.mongo)
    .AuthSession.findById(oid(session.id))
    .select({ userAgent: 1, deviceName: 1 })
    .lean()) as { userAgent?: string | null; deviceName?: string | null } | null;
  const now = new Date();
  const fields = {
    userId: oid(userId),
    sessionId: session.id,
    keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    label: deviceLabel(record?.userAgent, record?.deviceName),
    expiresAt: new Date(session.expiresAt),
  };
  const save = async () => {
    const existing = await PushSubscription.findOne({ endpoint: body.endpoint }).lean();
    const fresh = { createdAt: now, lastUsedAt: null };
    // Moved to this device: it starts again as new here.
    const update =
      existing && existing.sessionId !== session.id
        ? { $set: { ...fields, ...fresh } }
        : { $set: fields, $setOnInsert: fresh };
    return PushSubscription.findOneAndUpdate({ endpoint: body.endpoint }, update, {
      upsert: true,
      returnDocument: 'after',
    }).lean();
  };
  let doc: PushSubscriptionDoc | null;
  try {
    doc = await save();
  } catch (error) {
    // Two subscribes of one endpoint raced: the unique index let one insert; update it instead.
    if (!isDuplicateKey(error)) throw error;
    doc = await save();
  }
  if (!doc) throw new AppError('INTERNAL_ERROR', 'Could not save the subscription.');
  // The browser replaced its subscription: the old endpoint is dead.
  await PushSubscription.deleteMany({ sessionId: session.id, endpoint: { $ne: body.endpoint } });
  await announcePush(app, userId);
  return toPushDevice(doc, session.id);
}

/** This browser turned push off. Only my own subscription is touched. */
export async function unsubscribe(app: FastifyInstance, userId: string, endpoint: string) {
  const { deletedCount } = await pushModels(app.mongo).PushSubscription.deleteOne({
    endpoint,
    userId: oid(userId),
  });
  if (deletedCount > 0) await announcePush(app, userId);
  return deletedCount;
}

/** Settings → Notifications: stop pushes to one of my devices. Someone else's looks missing. */
export async function removePushDevice(app: FastifyInstance, userId: string, id: string) {
  const { deletedCount } = await pushModels(app.mongo).PushSubscription.deleteOne({
    _id: oid(id),
    userId: oid(userId),
  });
  if (deletedCount === 0) throw new AppError('NOT_FOUND', 'Device not found.');
  await announcePush(app, userId);
  return deletedCount;
}

/** A session ended (sign-out, revoke, "This wasn't me", deactivation): its pushes stop. */
export async function deleteSessionSubscriptions(mongo: Connection, sessionId: string) {
  return (await pushModels(mongo).PushSubscription.deleteMany({ sessionId })).deletedCount;
}

/** Every device of a person (deactivation, "This wasn't me"). */
export async function deleteUserSubscriptions(mongo: Connection, userId: string) {
  return (await pushModels(mongo).PushSubscription.deleteMany({ userId: oid(userId) }))
    .deletedCount;
}
