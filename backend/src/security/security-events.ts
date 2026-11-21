import type { FastifyInstance } from 'fastify';
import { type Connection, type Model, Schema, Types } from 'mongoose';

/**
 * Sign-in trouble an admin should see (Admin → Security): wrong codes and emails locked for the
 * day. The IP is masked before it is stored; rows go after 30 days.
 */
export interface SecurityEventDoc {
  _id: Types.ObjectId;
  kind: 'otp_failed' | 'otp_locked';
  email: string;
  /** "203.0.113.*" or "2001:db8:1::*": enough to tell networks apart, not to find a person. */
  ip: string;
  at: Date;
  /** Locks only: when it ends on its own, and whether an admin ended it first. */
  until?: Date | null;
  unlockedAt?: Date | null;
  unlockedBy?: string | null;
}

export const SECURITY_EVENT_KEEP_DAYS = 30;

const eventSchema = new Schema<SecurityEventDoc>(
  {
    kind: { type: String, required: true },
    email: { type: String, required: true },
    ip: { type: String, required: true },
    at: { type: Date, required: true },
    until: { type: Date, default: null },
    unlockedAt: { type: Date, default: null },
    unlockedBy: { type: String, default: null },
  },
  { versionKey: false, autoCreate: true, collection: 'security_events' },
);
// Serves: recent failed sign-ins, newest first (kind equality, then at).
eventSchema.index({ kind: 1, at: -1 });
// Serves: locks still running (kind equality, until after now), and "is this email's lock recorded".
eventSchema.index({ kind: 1, email: 1, until: -1 });
// TTL: rows go after SECURITY_EVENT_KEEP_DAYS.
eventSchema.index({ at: 1 }, { expireAfterSeconds: SECURITY_EVENT_KEEP_DAYS * 86_400 });

export function registerSecurityEventModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return { SecurityEvent: model('SecurityEvent', eventSchema) };
}

/** Keeps the network, drops the host: IPv4 last part, IPv6 all but the first three groups. */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return 'unknown';
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return `${v4.split('.').slice(0, 3).join('.')}.*`;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::*`;
  return 'unknown';
}

const events = (app: FastifyInstance) => registerSecurityEventModels(app.mongo).SecurityEvent;

/**
 * A wrong code for `email` from `ip`; when it locked the email for the day (`lockedSeconds` > 0),
 * the lock too, once. Never fails the sign-in it records.
 */
export async function recordOtpFailure(
  app: FastifyInstance,
  email: string,
  ip: string | null | undefined,
  lockedSeconds: number,
  now = new Date(),
) {
  try {
    const masked = maskIp(ip);
    await events(app).create({ kind: 'otp_failed', email, ip: masked, at: now });
    if (lockedSeconds <= 0) return;
    const open = await events(app).exists({
      kind: 'otp_locked',
      email,
      until: { $gt: now },
      unlockedAt: null,
    });
    if (!open) {
      await events(app).create({
        kind: 'otp_locked',
        email,
        ip: masked,
        at: now,
        until: new Date(now.getTime() + lockedSeconds * 1000),
      });
    }
  } catch (error) {
    app.log.warn({ err: error }, 'could not record a sign-in failure');
  }
}

export async function runningLocks(app: FastifyInstance, now = new Date()) {
  return events(app)
    .find({ kind: 'otp_locked', until: { $gt: now }, unlockedAt: null })
    .sort({ until: -1 })
    .limit(200)
    .lean();
}

export async function recentFailures(app: FastifyInstance, limit = 50) {
  return events(app).find({ kind: 'otp_failed' }).sort({ at: -1 }).limit(limit).lean();
}

export async function findLock(app: FastifyInstance, id: string) {
  return Types.ObjectId.isValid(id) ? events(app).findById(id).lean() : null;
}

export async function markUnlocked(app: FastifyInstance, id: Types.ObjectId, by: string) {
  await events(app).updateOne({ _id: id }, { $set: { unlockedAt: new Date(), unlockedBy: by } });
}
