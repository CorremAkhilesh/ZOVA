import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { registerAuthModels } from '../db/auth-models.ts';
import { registerChatModels } from '../db/chat-models.ts';
import { registerModerationModels } from '../db/moderation-models.ts';
import { registerPushModels } from '../db/push-models.ts';

let db: Awaited<ReturnType<typeof connectTestDb>>;
const id = () => new Types.ObjectId();

beforeAll(async () => {
  db = await connectTestDb();
});
afterAll(async () => {
  await db.cleanup();
});

describe('Web Push queries use indexes', () => {
  it('push subscriptions: by endpoint, by person (newest first), by session', async () => {
    const { PushSubscription } = registerPushModels(db.connection);
    await expectIndexedQuery(PushSubscription.find({ endpoint: 'https://push.example.test/a' }));
    await expectIndexedQuery(PushSubscription.find({ userId: id() }).sort({ createdAt: -1 }));
    await expectIndexedQuery(PushSubscription.find({ userId: { $in: [id(), id()] } }));
    await expectIndexedQuery(PushSubscription.find({ _id: id(), userId: id() }));
    await expectIndexedQuery(
      PushSubscription.find({ sessionId: 's1', endpoint: { $ne: 'https://push.example.test/a' } }),
    );
  });

  it('what a push job reads: membership, messages, hidden, blocks, badge', async () => {
    const { Chat, ChatMember, Message, MessageHidden } = registerChatModels(db.connection);
    await expectIndexedQuery(ChatMember.find({ chatId: id(), userId: id() }));
    await expectIndexedQuery(
      ChatMember.find({
        _id: id(),
        $or: [{ pushedSeq: { $exists: false } }, { pushedSeq: { $lt: 5 } }],
      }),
    );
    await expectIndexedQuery(
      Message.find({ chatId: id(), seq: { $gt: 3, $lte: 9 } })
        .sort({ seq: -1 })
        .limit(100),
    );
    await expectIndexedQuery(
      MessageHidden.find({ userId: id(), chatId: id(), messageId: { $in: [id()] } }),
    );
    await expectIndexedQuery(ChatMember.find({ userId: id(), lastActivityAt: { $type: 'date' } }));
    await expectIndexedQuery(Chat.find({ _id: { $in: [id(), id()] } }));
    const { Block } = registerModerationModels(db.connection);
    await expectIndexedQuery(Block.find({ userId: id(), blockedId: id() }));
  });

  it('live sessions of the devices', async () => {
    const { AuthSession } = registerAuthModels(db.connection);
    await expectIndexedQuery(
      AuthSession.find({ _id: { $in: [id(), id()] }, expiresAt: { $gt: new Date() } }),
    );
  });
});
