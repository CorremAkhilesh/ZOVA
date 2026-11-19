import type { MediaInfo, StatusKind, StatusStyle } from '@zuvo/protocol';
import { type Connection, type Model, Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

/** How long after a status expires its views are kept (then MongoDB removes them). */
export const STATUS_VIEW_TTL_HOURS = 48;

export type AudienceMode = 'all' | 'except' | 'only';

/** A status: text on a background, or a photo or video with a caption. Gone 24 hours later. */
export interface StatusDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  kind: StatusKind;
  /** The words of a text status, or a caption. */
  text: string | null;
  style: StatusStyle | null;
  mediaId: Types.ObjectId | null;
  media: MediaInfo | null;
  /** Who may see it: my status privacy as it was when I posted it. */
  audience: { mode: AudienceMode; userIds: Types.ObjectId[] };
  createdAt: Date;
  /** MongoDB removes it at this time (TTL), and its file goes in the media cleanup job. */
  expiresAt: Date;
}

const statusSchema = new Schema<StatusDoc>(
  {
    userId: { type: ObjectId, required: true },
    kind: { type: String, required: true },
    text: { type: String, default: null },
    style: { type: Schema.Types.Mixed, default: null },
    mediaId: { type: ObjectId, default: null },
    media: { type: Schema.Types.Mixed, default: null },
    audience: {
      mode: { type: String, required: true },
      userIds: { type: [ObjectId], default: [] },
    },
    createdAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true },
  },
  { ...options, collection: 'statuses' },
);
// Serves: my own statuses and one person's (userId, still running), and how many I posted in the
// last 24 hours (the daily limit: createdAt is within expiresAt's range).
statusSchema.index({ userId: 1, expiresAt: 1 });
// Serves: everything still running, for the feed (range on expiresAt). TTL: MongoDB deletes each
// status when it expires.
statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Serves: whether a file belongs to a status someone may see (media access). Not partial: MongoDB
// does not use a `$type` partial index for an equality match on the id.
statusSchema.index({ mediaId: 1 });

/** Someone saw a status (and maybe reacted). Kept a little past the status, then removed. */
export interface StatusViewDoc {
  _id: Types.ObjectId;
  statusId: Types.ObjectId;
  ownerId: Types.ObjectId;
  viewerId: Types.ObjectId;
  viewedAt: Date;
  reaction: string | null;
}

const statusViewSchema = new Schema<StatusViewDoc>(
  {
    statusId: { type: ObjectId, required: true },
    ownerId: { type: ObjectId, required: true },
    viewerId: { type: ObjectId, required: true },
    viewedAt: { type: Date, required: true },
    reaction: { type: String, default: null },
  },
  { ...options, collection: 'status_views' },
);
// Serves: whether I saw a status, and its count. Unique: one view per person.
statusViewSchema.index({ statusId: 1, viewerId: 1 }, { unique: true });
// Serves: "Viewed by", newest first.
statusViewSchema.index({ statusId: 1, viewedAt: -1 });
// Serves: which of these statuses I have seen (viewerId, statusId in the feed).
statusViewSchema.index({ viewerId: 1, statusId: 1 });
// TTL: views go a while after their status.
statusViewSchema.index(
  { viewedAt: 1 },
  { expireAfterSeconds: (24 + STATUS_VIEW_TTL_HOURS) * 3600 },
);

/** My status privacy (no document: all colleagues). */
export interface StatusSettingsDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  mode: AudienceMode;
  userIds: Types.ObjectId[];
  updatedAt: Date;
}

const statusSettingsSchema = new Schema<StatusSettingsDoc>(
  {
    userId: { type: ObjectId, required: true },
    mode: { type: String, required: true, default: 'all' },
    userIds: { type: [ObjectId], default: [] },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'status_settings' },
);
// Serves: my setting, by userId. Unique: one each.
statusSettingsSchema.index({ userId: 1 }, { unique: true });

/** Whose statuses I muted: they move to "Muted" in my list. */
export interface StatusMuteDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  mutedUserId: Types.ObjectId;
  createdAt: Date;
}

const statusMuteSchema = new Schema<StatusMuteDoc>(
  {
    userId: { type: ObjectId, required: true },
    mutedUserId: { type: ObjectId, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'status_mutes' },
);
// Serves: everyone I muted (the feed), and muting one person once. Unique: one each.
statusMuteSchema.index({ userId: 1, mutedUserId: 1 }, { unique: true });

export function registerStatusModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return {
    Status: model('Status', statusSchema),
    StatusView: model('StatusView', statusViewSchema),
    StatusSettings: model('StatusSettings', statusSettingsSchema),
    StatusMute: model('StatusMute', statusMuteSchema),
  };
}

export type StatusModels = ReturnType<typeof registerStatusModels>;
