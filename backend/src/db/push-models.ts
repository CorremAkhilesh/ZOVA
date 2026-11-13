import { type Connection, type Model, Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

/**
 * One browser's Web Push subscription. It belongs to the session that registered it and goes with
 * it: sign-out, revoke, deactivation, expiry (TTL below), or a 404/410 from the push service.
 */
export interface PushSubscriptionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** The Better Auth session (device) it belongs to. */
  sessionId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** "Chrome on Windows", from the session's user agent. */
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  /** The session's absolute expiry: the subscription is deleted with it. */
  expiresAt: Date;
}

const pushSubscriptionSchema = new Schema<PushSubscriptionDoc>(
  {
    userId: { type: ObjectId, required: true },
    sessionId: { type: String, required: true },
    endpoint: { type: String, required: true },
    keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
    label: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
    lastUsedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { ...options, collection: 'push_subscriptions' },
);
// Serves: subscribe (upsert by endpoint), unsubscribe, and the 404/410 cleanup. Unique: a browser
// endpoint belongs to one device; signing in as someone else on it moves it over.
pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
// Serves: my push devices (GET /v1/me/push), newest first, and every send to a person.
pushSubscriptionSchema.index({ userId: 1, createdAt: -1 });
// Serves: a session ending (sign-out, revoke) and the test push to this device.
pushSubscriptionSchema.index({ sessionId: 1 });
// TTL: a subscription never outlives its session (sessions last 7 days, never extended).
pushSubscriptionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export function registerPushModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return { PushSubscription: model('PushSubscription', pushSubscriptionSchema) };
}
