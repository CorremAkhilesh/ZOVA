import type { Connection } from 'mongoose';
import { registerAuthModels } from './auth-models.ts';
import type { IndexedModel } from './sync-indexes.ts';

/**
 * Every Mongoose model, registered on a connection. `db:sync-indexes` syncs exactly these.
 * Feature modules add their registration functions here as they are built.
 */
export const modelRegistrations: Array<(connection: Connection) => IndexedModel[]> = [
  (connection) => Object.values(registerAuthModels(connection)),
];

export function registerModels(connection: Connection): IndexedModel[] {
  return modelRegistrations.flatMap((register) => register(connection));
}
