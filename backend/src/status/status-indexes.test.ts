import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { registerStatusModels } from '../db/status-models.ts';

let db: Awaited<ReturnType<typeof connectTestDb>>;
const models = () => registerStatusModels(db.connection);

beforeAll(async () => {
  db = await connectTestDb();
  for (const model of Object.values(models())) await model.syncIndexes();
});
afterAll(async () => {
  await db.cleanup();
});

describe('status queries use an index', () => {
  const userId = new Types.ObjectId();
  const statusId = new Types.ObjectId();
  const now = new Date();

  it('statuses: the feed, mine, the daily limit, and media access', async () => {
    const { Status } = models();
    await expectIndexedQuery(Status.find({ expiresAt: { $gt: now } }).sort({ expiresAt: 1 }));
    await expectIndexedQuery(Status.find({ userId, expiresAt: { $gt: now } }));
    await expectIndexedQuery(Status.findOne({ mediaId: new Types.ObjectId() }));
  });

  it('views: mine, viewed by, and seen by me', async () => {
    const { StatusView } = models();
    await expectIndexedQuery(StatusView.find({ statusId }).sort({ viewedAt: -1 }));
    await expectIndexedQuery(StatusView.findOne({ statusId, viewerId: userId }));
    await expectIndexedQuery(StatusView.find({ viewerId: userId, statusId: { $in: [statusId] } }));
  });

  it('privacy and mutes', async () => {
    const { StatusSettings, StatusMute } = models();
    await expectIndexedQuery(StatusSettings.findOne({ userId }));
    await expectIndexedQuery(StatusMute.find({ userId }));
    await expectIndexedQuery(StatusMute.findOne({ userId, mutedUserId: new Types.ObjectId() }));
  });

  it('expire by TTL: statuses when they end, views a while later', async () => {
    const { Status, StatusView } = models();
    const ttl = async (model: typeof Status | typeof StatusView) =>
      (await model.collection.indexes()).filter((index) => index.expireAfterSeconds !== undefined);
    expect(await ttl(Status)).toEqual([
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
    ]);
    expect(await ttl(StatusView)).toEqual([
      expect.objectContaining({ key: { viewedAt: 1 }, expireAfterSeconds: 72 * 3600 }),
    ]);
  });
});
