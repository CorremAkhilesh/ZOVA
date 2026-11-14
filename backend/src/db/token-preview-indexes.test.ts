import { afterAll, beforeAll, describe, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { registerLinkPreviewModels } from './link-preview-models.ts';
import { registerSecurityModels } from './security-models.ts';

let db: Awaited<ReturnType<typeof connectTestDb>>;

beforeAll(async () => {
  db = await connectTestDb();
});
afterAll(async () => {
  await db.cleanup();
});

// Found by `pnpm --filter @zuvo/backend index:coverage`: these shapes had no explain() test.
describe('security tokens and link previews use an index', () => {
  it('"This wasn\'t me" token: claim, then explain why it failed', async () => {
    const { SecurityToken } = registerSecurityModels(db.connection);
    await expectIndexedQuery(
      SecurityToken.findOne({ tokenHash: 'h', usedAt: null, expiresAt: { $gt: new Date() } }),
    );
    await expectIndexedQuery(SecurityToken.findOne({ tokenHash: 'h' }));
  });

  it('link preview cache: by key (read, and upsert after a fetch)', async () => {
    const { LinkPreview } = registerLinkPreviewModels(db.connection);
    await expectIndexedQuery(LinkPreview.findOne({ key: 'abc' }));
  });
});
