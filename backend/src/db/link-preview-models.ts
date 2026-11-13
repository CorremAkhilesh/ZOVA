import type { LinkPreview } from '@zuvo/protocol';
import { type Connection, type Model, Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;

/** One looked-up link, shared by everyone who types it, for a day (a failure for an hour). */
export interface LinkPreviewDoc {
  _id: Types.ObjectId;
  /** SHA-256 of the normalised URL. */
  key: string;
  /** The URL as asked for: a message must contain it to carry this preview. */
  requestUrl: string;
  preview: LinkPreview | null;
  /** Why there is no preview, for the logs. */
  failure: string | null;
  expiresAt: Date;
}

const linkPreviewSchema = new Schema<LinkPreviewDoc>(
  {
    key: { type: String, required: true },
    requestUrl: { type: String, required: true },
    preview: { type: Schema.Types.Mixed, default: null },
    failure: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { ...options, collection: 'link_previews' },
);
// Serves: "seen this link lately?". Unique: two people typing it at once store one row.
linkPreviewSchema.index({ key: 1 }, { unique: true });
// TTL: a cached preview is forgotten after a day, a failure after an hour.
linkPreviewSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** A preview image, fetched and resized once by our server. Messages keep pointing at it. */
export interface LinkPreviewImageDoc {
  _id: Types.ObjectId;
  storageKey: string;
  width: number;
  height: number;
  createdAt: Date;
}

const linkPreviewImageSchema = new Schema<LinkPreviewImageDoc>(
  {
    storageKey: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'link_preview_images' },
);
// Serves: nothing beyond _id (images are opened by id).

export function registerLinkPreviewModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return {
    LinkPreview: model('LinkPreview', linkPreviewSchema),
    LinkPreviewImage: model('LinkPreviewImage', linkPreviewImageSchema),
  };
}
