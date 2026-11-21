import { afterAll, beforeAll, describe, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { registerChatModels } from '../db/chat-models.ts';
import { registerSettingsModels, SETTINGS_ID } from './app-settings.ts';

// Settings and auto-cleanup read through indexes (CLAUDE.md §8).

let db: Awaited<ReturnType<typeof connectTestDb>>;
beforeAll(async () => {
  db = await connectTestDb();
});
afterAll(async () => {
  await db.cleanup();
});

describe('settings indexes', () => {
  it('the one settings document, and old files oldest first', async () => {
    await expectIndexedQuery(
      registerSettingsModels(db.connection).AppSettings.findById(SETTINGS_ID),
    );
    await expectIndexedQuery(
      registerChatModels(db.connection)
        .Media.find({ status: 'ready', createdAt: { $lt: new Date() } })
        .sort({ createdAt: 1 }),
    );
  });
});
