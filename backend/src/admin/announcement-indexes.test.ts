import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { registerAnnouncementModels } from '../db/announcement-models.ts';

// Banners and dismissals read through indexes (CLAUDE.md §8).

let db: Awaited<ReturnType<typeof connectTestDb>>;
beforeAll(async () => {
  db = await connectTestDb();
});
afterAll(async () => {
  await db.cleanup();
});

describe('announcement indexes', () => {
  it('running banners, my dismissals, and the admin list', async () => {
    const { Announcement, AnnouncementDismissal } = registerAnnouncementModels(db.connection);
    await expectIndexedQuery(
      Announcement.find({ banner: true, endedAt: null }).sort({ createdAt: -1 }),
    );
    await expectIndexedQuery(
      AnnouncementDismissal.find({
        userId: new Types.ObjectId(),
        announcementId: { $in: [new Types.ObjectId()] },
      }),
    );
    await expectIndexedQuery(
      Announcement.find({ _id: { $lt: new Types.ObjectId() } }).sort({ _id: -1 }),
    );
  });
});
