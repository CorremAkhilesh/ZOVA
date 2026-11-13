import { type Connection, type Model, Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

/** One of a person's own wallpaper pictures (re-encoded WebP). Private to its owner. */
export interface WallpaperImageDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Random storage key: never the uploaded file name. */
  key: string;
  size: number;
  createdAt: Date;
}

const wallpaperImageSchema = new Schema<WallpaperImageDoc>(
  {
    userId: { type: ObjectId, required: true },
    key: { type: String, required: true },
    size: { type: Number, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'wallpaper_images' },
);
// Serves: my pictures oldest first, how many I have, and one of them by id with its owner.
wallpaperImageSchema.index({ userId: 1, createdAt: 1 });

export function registerAppearanceModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return { WallpaperImage: model('WallpaperImage', wallpaperImageSchema) };
}
