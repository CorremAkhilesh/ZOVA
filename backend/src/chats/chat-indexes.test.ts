import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { uuidv7 } from '../../test/realtime-helpers.ts';
import { registerChatModels } from '../db/chat-models.ts';

let db: Awaited<ReturnType<typeof connectTestDb>>;
const chatModels = () => registerChatModels(db.connection);

beforeAll(async () => {
  db = await connectTestDb();
});
afterAll(async () => {
  await db.cleanup();
});

describe('every query uses an index', () => {
  const someone = new Types.ObjectId();
  const chatId = new Types.ObjectId();

  it('membership, chat list and members', async () => {
    const { ChatMember } = chatModels();
    const base = { userId: someone, leftAt: null };
    const sort = { lastActivityAt: -1, chatId: -1 } as const;
    await expectIndexedQuery(ChatMember.findOne({ chatId, userId: someone, leftAt: null }));
    await expectIndexedQuery(ChatMember.find({ chatId, leftAt: null }));
    await expectIndexedQuery(
      ChatMember.find({ ...base, lastActivityAt: { $type: 'date' } })
        .sort(sort)
        .limit(31),
    );
    await expectIndexedQuery(
      ChatMember.find({
        ...base,
        $or: [
          { lastActivityAt: { $lt: new Date() } },
          { lastActivityAt: new Date(), chatId: { $lt: chatId } },
        ],
      })
        .sort(sort)
        .limit(31),
    );
    await expectIndexedQuery(ChatMember.find({ ...base, chatId: { $in: [chatId] } }));
    await expectIndexedQuery(
      ChatMember.find({ chatId: { $in: [chatId] }, userId: { $ne: someone } }),
    );
  });

  it('get-or-create', async () => {
    const { Chat } = chatModels();
    await expectIndexedQuery(Chat.findOne({ type: 'direct', pairKey: 'a:b' }));
    await expectIndexedQuery(Chat.findOne({ type: 'self', selfOwnerId: someone }));
    await expectIndexedQuery(Chat.find({ _id: { $in: [chatId] } }));
  });

  it('history, idempotency and hidden messages', async () => {
    const { Message, MessageHidden } = chatModels();
    await expectIndexedQuery(Message.find({ chatId }).sort({ seq: -1 }).limit(51));
    await expectIndexedQuery(Message.find({ chatId, seq: { $lt: 10 } }).sort({ seq: -1 }));
    await expectIndexedQuery(Message.find({ chatId, seq: { $gt: 10 } }).sort({ seq: 1 }));
    await expectIndexedQuery(
      Message.findOne({ senderId: someone, clientMsgId: { $eq: uuidv7(), $type: 'string' } }),
    );
    await expectIndexedQuery(MessageHidden.find({ userId: someone, chatId }));
  });

  it('sync', async () => {
    const { Message, UserSync, UserUpdate } = chatModels();
    await expectIndexedQuery(
      UserUpdate.find({ userId: someone, pts: { $gt: 5 } })
        .sort({ pts: 1 })
        .limit(201),
    );
    await expectIndexedQuery(UserSync.find({ _id: { $in: [someone] } }));
    await expectIndexedQuery(Message.find({ $or: [{ chatId, seq: { $in: [1, 2] } }] }));
  });
});
