import type { FolderRules } from '@zuvo/protocol';
import { type Connection, type Model, Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

/** A chat folder of one person's. */
export interface FolderDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  emoji: string | null;
  chatIds: Types.ObjectId[];
  rules: FolderRules;
  /** Position among this person's folders: 0, 1, 2… */
  order: number;
  createdAt: Date;
}

const folderSchema = new Schema<FolderDoc>(
  {
    userId: { type: ObjectId, required: true },
    name: { type: String, required: true },
    emoji: { type: String, default: null },
    chatIds: { type: [ObjectId], default: [] },
    rules: { type: Schema.Types.Mixed, required: true },
    order: { type: Number, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'chat_folders' },
);
// Serves: my folders in my order, how many I have, and each one by id with its owner.
folderSchema.index({ userId: 1, order: 1 });

export function registerFolderModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return { Folder: model('Folder', folderSchema) };
}
