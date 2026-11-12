import { type Connection, type Model, Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

/** A WebAuthn ceremony in progress: one at a time per person, short-lived. */
export interface LockChallenge {
  value: string;
  purpose: 'register' | 'unlock';
  expiresAt: Date;
}

/** "Forgot PIN": the emailed code, hashed. */
export interface LockResetCode {
  codeHash: string;
  expiresAt: Date;
  attempts: number;
}

/**
 * One per person (`_id` = user id): the PIN (argon2id hash only), app lock, wrong-PIN counting and
 * lockouts. Never returned or logged as it is: the API only shows a LockStatus.
 */
export interface LockDoc {
  _id: Types.ObjectId;
  pinHash: string | null;
  appLockEnabled: boolean;
  idleMinutes: number;
  /** Wrong PINs since the last correct one or the last lockout. */
  failedAttempts: number;
  /** Lockouts in a row (decays 24 h after the last one): each one lasts twice as long. */
  lockouts: number;
  lastLockoutAt: Date | null;
  lockedUntil: Date | null;
  /** The last correct PIN (or fingerprint): adding a fingerprint needs one in the last 5 minutes. */
  lastVerifiedAt: Date | null;
  challenge: LockChallenge | null;
  reset: LockResetCode | null;
  updatedAt: Date;
}

const lockSchema = new Schema<LockDoc>(
  {
    _id: { type: ObjectId, required: true },
    pinHash: { type: String, default: null },
    appLockEnabled: { type: Boolean, default: false },
    idleMinutes: { type: Number, default: 5 },
    failedAttempts: { type: Number, default: 0 },
    lockouts: { type: Number, default: 0 },
    lastLockoutAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
    lastVerifiedAt: { type: Date, default: null },
    challenge: { type: Schema.Types.Mixed, default: null },
    reset: { type: Schema.Types.Mixed, default: null },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'pin_locks' },
);
// Every query is by `_id` (the user id): the built-in _id index serves them all.

/** A device that can unlock with Windows Hello, Touch ID, a fingerprint… (a WebAuthn credential). */
export interface LockCredentialDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** base64url, as the browser reports it. */
  credentialId: string;
  /** base64url COSE public key. */
  publicKey: string;
  counter: number;
  transports: string[];
  createdAt: Date;
}

const lockCredentialSchema = new Schema<LockCredentialDoc>(
  {
    userId: { type: ObjectId, required: true },
    credentialId: { type: String, required: true },
    publicKey: { type: String, required: true },
    counter: { type: Number, default: 0 },
    transports: { type: [String], default: [] },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'lock_credentials' },
);
// Serves: unlocking with one credential (with its owner). Unique: a credential is registered once.
lockCredentialSchema.index({ credentialId: 1 }, { unique: true });
// Serves: my credentials (count, allow/exclude lists, remove all), oldest first.
lockCredentialSchema.index({ userId: 1, createdAt: 1 });

export function registerLockModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return {
    Lock: model('PinLock', lockSchema),
    LockCredential: model('LockCredential', lockCredentialSchema),
  };
}
