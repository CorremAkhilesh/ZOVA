import type { Connection, Model } from 'mongoose';

/**
 * Every Mongoose model, registered on a connection. `db:sync-indexes` syncs exactly these.
 * Feature modules add their `register*Model` functions here as they are built.
 */
export const modelRegistrations: Array<(connection: Connection) => Model<never>> = [];

export function registerModels(connection: Connection): Model<never>[] {
  return modelRegistrations.map((register) => register(connection));
}
