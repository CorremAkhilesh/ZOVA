import { type Connection, type Model, Schema, type Types } from 'mongoose';

/** Admin → Announcements: a banner and/or a chat message from an admin. */
export interface AnnouncementDoc {
  _id: Types.ObjectId;
  title: string;
  body: string;
  level: 'info' | 'warning';
  audience: 'all' | 'some';
  /** Only for `some`: who it is for. */
  userIds: Types.ObjectId[];
  recipients: number;
  banner: boolean;
  message: boolean;
  /** The banner goes when this passes (null: until ended). */
  endsAt: Date | null;
  /** Ended early by an admin. */
  endedAt: Date | null;
  createdBy: { id: string; email: string };
  createdAt: Date;
}

const announcementSchema = new Schema<AnnouncementDoc>(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    level: { type: String, required: true },
    audience: { type: String, required: true },
    userIds: { type: [Schema.Types.ObjectId], default: [] },
    recipients: { type: Number, default: 0 },
    banner: { type: Boolean, required: true },
    message: { type: Boolean, required: true },
    endsAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    createdBy: { id: String, email: String },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false, autoCreate: true, collection: 'announcements' },
);
// Serves: the banners running now (banner, not ended), newest first. Few at a time; the audience
// and end date are checked on those. Partial: only banners still running are in it.
announcementSchema.index(
  { createdAt: -1 },
  {
    name: 'running_banners',
    partialFilterExpression: { banner: true, endedAt: null },
  },
);
// Admin → Announcements lists newest first by _id (default index).

/** One row per person per banner they closed. */
export interface AnnouncementDismissalDoc {
  announcementId: Types.ObjectId;
  userId: Types.ObjectId;
  at: Date;
}

const dismissalSchema = new Schema<AnnouncementDismissalDoc>(
  {
    announcementId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false, autoCreate: true, collection: 'announcement_dismissals' },
);
// Serves: which of the running banners I closed (userId + announcementId $in), and closing one
// (upsert). Unique: once per person per banner.
dismissalSchema.index({ userId: 1, announcementId: 1 }, { unique: true });

export function registerAnnouncementModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return {
    Announcement: model('Announcement', announcementSchema),
    AnnouncementDismissal: model('AnnouncementDismissal', dismissalSchema),
  };
}
