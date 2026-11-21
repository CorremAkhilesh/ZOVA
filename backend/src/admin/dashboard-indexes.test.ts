import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { registerActivityModels } from '../db/activity-models.ts';
import { registerAuthModels } from '../db/auth-models.ts';
import { registerCallModels } from '../db/call-models.ts';
import { registerChatModels } from '../db/chat-models.ts';
import { registerPushModels } from '../db/push-models.ts';
import { idFrom, lastDays } from './report-days.ts';

// Every query behind Admin → Dashboard is served by an index (CLAUDE.md §8). Aggregations are
// checked through a find with the same filter.

let db: Awaited<ReturnType<typeof connectTestDb>>;
beforeAll(async () => {
  db = await connectTestDb();
});
afterAll(async () => {
  await db.cleanup();
});

describe('dashboard indexes', () => {
  it('people by status and role, and the top storage users', async () => {
    const { AuthUser } = registerAuthModels(db.connection);
    await expectIndexedQuery(AuthUser.find({ status: 'deactivated' }));
    await expectIndexedQuery(AuthUser.find({ role: 'admin', status: { $ne: 'deactivated' } }));
    await expectIndexedQuery(AuthUser.find({ _id: { $in: [new Types.ObjectId()] } }));
    await expectIndexedQuery(
      AuthUser.find({
        _id: { $in: [new Types.ObjectId()] },
        status: { $ne: 'deactivated' },
      }),
    );
  });

  it('active people per day and across days', async () => {
    const { ActivityDay } = registerActivityModels(db.connection);
    const days = lastDays(new Date(), 7);
    await expectIndexedQuery(ActivityDay.find({ day: days[0] as string }));
    await expectIndexedQuery(ActivityDay.find({ day: { $in: days } }, { userId: 1 }));
    await expectIndexedQuery(
      ActivityDay.find({ day: days[0] as string, userId: new Types.ObjectId() }),
    );
  });

  it('messages and calls since a day, by the time in their id', async () => {
    const from = idFrom(new Date(Date.now() - 30 * 86_400_000));
    const { Message, Media } = registerChatModels(db.connection);
    await expectIndexedQuery(Message.find({ _id: { $gte: from }, type: { $ne: 'system' } }));
    await expectIndexedQuery(registerCallModels(db.connection).Call.find({ _id: { $gte: from } }));
    await expectIndexedQuery(Media.find({ status: 'ready' }, { ownerId: 1, size: 1, _id: 0 }));
  });

  it('people with push on', async () => {
    await expectIndexedQuery(
      registerPushModels(db.connection).PushSubscription.distinct('userId', {
        expiresAt: { $gt: new Date() },
      }),
    );
  });
});
