import type { ReportEvidence, ReportReason, ReportTarget } from '@zuvo/protocol';
import { type Connection, type Model, Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

/** I blocked someone. Direct chats only: groups are not affected. */
export interface BlockDoc {
  _id: Types.ObjectId;
  /** Who blocked. */
  userId: Types.ObjectId;
  /** Who is blocked. */
  blockedId: Types.ObjectId;
  createdAt: Date;
}

const blockSchema = new Schema<BlockDoc>(
  {
    userId: { type: ObjectId, required: true },
    blockedId: { type: ObjectId, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'blocks' },
);
// Serves: block, unblock, "did I block them?". Unique: blocking twice is one row.
blockSchema.index({ userId: 1, blockedId: 1 }, { unique: true });
// Serves: my Blocked contacts list, newest first.
blockSchema.index({ userId: 1, createdAt: -1, _id: -1 });
// Serves: "did they block me?", and which of these people blocked me (profiles, search, presence).
blockSchema.index({ blockedId: 1, userId: 1 });

export interface ReportDoc {
  _id: Types.ObjectId;
  reporterId: Types.ObjectId;
  target: ReportTarget;
  reason: ReportReason;
  note: string | null;
  /** Copies, taken when reported: what the reporter could see, unchanged by later edits or deletes. */
  evidence: ReportEvidence[];
  /** The reporter also blocked the person. */
  blocked: boolean;
  status: 'open' | 'resolved';
  resolution: { action: 'none' | 'deactivated'; note: string | null } | null;
  resolvedBy: Types.ObjectId | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

const reportSchema = new Schema<ReportDoc>(
  {
    reporterId: { type: ObjectId, required: true },
    target: { type: Schema.Types.Mixed, required: true },
    reason: { type: String, required: true },
    note: { type: String, default: null },
    evidence: { type: Schema.Types.Mixed, default: () => [] },
    blocked: { type: Boolean, default: false },
    status: { type: String, default: 'open' },
    resolution: { type: Schema.Types.Mixed, default: null },
    resolvedBy: { type: ObjectId, default: null },
    resolvedAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'reports' },
);
// Serves: Admin → Reports filtered by status (open / resolved), newest first, cursor on (createdAt, _id).
reportSchema.index({ status: 1, createdAt: -1, _id: -1 });
// Serves: Admin → Reports with no filter, newest first.
reportSchema.index({ createdAt: -1, _id: -1 });
// Serves: how many reports one person sent lately (abuse limit).
reportSchema.index({ reporterId: 1, createdAt: -1 });

export function registerModerationModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return {
    Block: model('Block', blockSchema),
    Report: model('Report', reportSchema),
  };
}

export type ModerationModels = ReturnType<typeof registerModerationModels>;
