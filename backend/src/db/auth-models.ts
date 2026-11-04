import { type Connection, type Model, Schema } from 'mongoose';

/**
 * Index definitions for Better Auth's collections (user, session, verification, account).
 * Better Auth reads and writes these documents itself; these Mongoose models exist so that every
 * query it makes is index-backed (CLAUDE.md §8), synced by `db:sync-indexes` in production.
 */
const options = { strict: false, versionKey: false, autoCreate: true } as const;

const userSchema = new Schema(
  {
    email: String,
    username: String,
    usernameChangedAt: Date,
    displayName: String,
    about: String,
    avatar: { small: String, large: String, version: String },
    privacy: { lastSeen: String, profilePhoto: String, about: String, readReceipts: Boolean },
    /** Lowercase words of the display name and username, for prefix search. */
    searchTerms: [String],
    role: String,
    status: String,
    lastLoginAt: Date,
    createdAt: Date,
  },
  { ...options, collection: 'user' },
);
// Serves: find user by email (OTP sign-in, sign-up dedupe). Unique: one account per email.
userSchema.index({ email: 1 }, { unique: true });
// Serves: find user by @username (Step 7). Partial: most users have no username yet.
// Queries must include `username: { $eq: name, $type: 'string' }` so MongoDB can use it.
userSchema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } } },
);

// Serves: people search by name/username prefix (`searchTerms: /^prefix/`, multikey).
userSchema.index({ searchTerms: 1 });
// Serves: suggested people (active users, most recently signed in first).
userSchema.index({ status: 1, lastLoginAt: -1 });
// Serves: last-admin protection (count active admins).
userSchema.index({ role: 1, status: 1 });

const sessionSchema = new Schema(
  { token: String, userId: Schema.Types.ObjectId, expiresAt: Date },
  { ...options, collection: 'session' },
);
// Serves: session lookup by cookie token on every authenticated request.
sessionSchema.index({ token: 1 }, { unique: true });
// Serves: list/revoke a user's sessions, newest first (ESR: userId = equality, expiresAt = sort).
sessionSchema.index({ userId: 1, expiresAt: -1 });
// TTL: MongoDB deletes sessions once they expire.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const verificationSchema = new Schema(
  { identifier: String, expiresAt: Date },
  { ...options, collection: 'verification' },
);
// Serves: OTP lookup by identifier (used when Redis is not configured).
verificationSchema.index({ identifier: 1 });
// TTL: expired OTPs are removed automatically.
verificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const accountSchema = new Schema(
  { userId: Schema.Types.ObjectId, providerId: String, accountId: String },
  { ...options, collection: 'account' },
);
// Serves: accounts of a user.
accountSchema.index({ userId: 1 });
// Serves: account lookup by provider + provider account id. Unique per provider.
accountSchema.index({ providerId: 1, accountId: 1 }, { unique: true });

export function registerAuthModels(connection: Connection) {
  type AuthModel = Model<Record<string, unknown>>;
  const model = (name: string, schema: Schema): AuthModel =>
    (connection.models[name] as AuthModel | undefined) ??
    (connection.model(name, schema) as unknown as AuthModel);
  return {
    AuthUser: model('AuthUser', userSchema),
    AuthSession: model('AuthSession', sessionSchema),
    AuthVerification: model('AuthVerification', verificationSchema),
    AuthAccount: model('AuthAccount', accountSchema),
  };
}
