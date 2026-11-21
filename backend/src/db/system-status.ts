import { type Connection, type Model, Schema } from 'mongoose';

/** Facts the server reports about itself, one document each (Admin → Dashboard). */
export interface BackupStatusDoc {
  _id: 'backup';
  /** When the nightly backup (deploy/scripts/backup.sh) last finished well. */
  finishedAt: Date;
  /** Files in the uploads snapshot. */
  files: number;
}

const statusSchema = new Schema<BackupStatusDoc>(
  {
    _id: { type: String, required: true },
    finishedAt: { type: Date, required: true },
    files: { type: Number, default: 0 },
  },
  { versionKey: false, autoCreate: true, collection: 'system_status' },
);
// Read and written by _id only: the default _id index serves both.

export function registerSystemStatusModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return { SystemStatus: model('SystemStatus', statusSchema) };
}

/** The backup finished: called by backup.sh through dist/scripts/backup-done.js. */
export async function recordBackup(connection: Connection, finishedAt: Date, files: number) {
  await registerSystemStatusModels(connection).SystemStatus.updateOne(
    { _id: 'backup' },
    { $set: { finishedAt, files } },
    { upsert: true },
  );
}

export async function lastBackup(connection: Connection): Promise<BackupStatusDoc | null> {
  return registerSystemStatusModels(connection).SystemStatus.findById('backup').lean();
}
