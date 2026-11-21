import { type Connection, type Model, Schema } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;

/** One-time tokens, e.g. the "This wasn't me" link. Only the SHA-256 hash is stored. */
export interface SecurityTokenDoc {
  tokenHash: string;
  userId: string;
  purpose: 'revoke-all-sessions';
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

const securityTokenSchema = new Schema<SecurityTokenDoc>(
  {
    tokenHash: { type: String, required: true },
    userId: { type: String, required: true },
    purpose: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'security_tokens' },
);
// Serves: token lookup when the link is opened. Unique: one row per token.
securityTokenSchema.index({ tokenHash: 1 }, { unique: true });
// TTL: tokens disappear once expired (7 days).
securityTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Admin actions, kept for accountability. */
export interface AuditLogDoc {
  action: string;
  actorId: string;
  actorEmail: string;
  targetId: string;
  targetEmail: string;
  ipAddress: string | null;
  at: Date;
  /** Why, in the admin's words (required since the admin panel asks for it). */
  reason?: string | null;
  /** What changed, e.g. { fromMb, toMb } for a storage limit. */
  details?: Record<string, string | number | null> | null;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    action: { type: String, required: true },
    actorId: { type: String, required: true },
    actorEmail: { type: String, required: true },
    targetId: { type: String, required: true },
    targetEmail: { type: String, required: true },
    ipAddress: { type: String, default: null },
    at: { type: Date, default: () => new Date() },
    reason: { type: String, default: null },
    details: { type: Schema.Types.Mixed, default: null },
  },
  { ...options, collection: 'audit_logs' },
);
// Serves: Admin → Audit log, newest first, cursor on (at, _id).
auditLogSchema.index({ at: -1, _id: -1 });
// Serves: history of actions on one user.
auditLogSchema.index({ targetId: 1, at: -1 });
// Serves: history of one admin's actions.
auditLogSchema.index({ actorId: 1, at: -1 });

export function registerSecurityModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return {
    SecurityToken: model('SecurityToken', securityTokenSchema),
    AuditLog: model('AuditLog', auditLogSchema),
  };
}
