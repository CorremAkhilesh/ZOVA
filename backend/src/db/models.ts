import type { Connection } from 'mongoose';
import { registerAuthModels } from './auth-models.ts';
import { registerChatModels } from './chat-models.ts';
import { registerFolderModels } from './folder-models.ts';
import { registerLinkPreviewModels } from './link-preview-models.ts';
import { registerModerationModels } from './moderation-models.ts';
import { registerSecurityModels } from './security-models.ts';
import type { IndexedModel } from './sync-indexes.ts';

/**
 * Every Mongoose model, registered on a connection. `db:sync-indexes` syncs exactly these.
 * Feature modules add their registration functions here as they are built.
 */
export const modelRegistrations: Array<(connection: Connection) => IndexedModel[]> = [
  (connection) => Object.values(registerAuthModels(connection)),
  (connection) => Object.values(registerSecurityModels(connection)) as unknown as IndexedModel[],
  (connection) => Object.values(registerChatModels(connection)) as unknown as IndexedModel[],
  (connection) => Object.values(registerModerationModels(connection)) as unknown as IndexedModel[],
  (connection) => Object.values(registerLinkPreviewModels(connection)) as unknown as IndexedModel[],
  (connection) => Object.values(registerFolderModels(connection)) as unknown as IndexedModel[],
];

export function registerModels(connection: Connection): IndexedModel[] {
  return modelRegistrations.flatMap((register) => register(connection));
}
