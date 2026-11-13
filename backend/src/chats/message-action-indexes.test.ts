import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { registerChatModels } from '../db/chat-models.ts';

let db: Awaited<ReturnType<typeof connectTestDb>>;
const models = () => registerChatModels(db.connection);

beforeAll(async () => {
  db = await connectTestDb();
});
afterAll(async () => {
  await db.cleanup();
});

describe('message actions use an index', () => {
  const userId = new Types.ObjectId();
  const chatId = new Types.ObjectId();
  const messageId = new Types.ObjectId();

  it('stars', async () => {
    const { Star } = models();
    const after = {
      $or: [{ at: { $lt: new Date() } }, { at: new Date(), _id: { $lt: messageId } }],
    };
    await expectIndexedQuery(Star.findOne({ userId, messageId }));
    await expectIndexedQuery(Star.find({ userId, messageId: { $in: [messageId] } }));
    await expectIndexedQuery(Star.find({ userId }).sort({ at: -1, _id: -1 }).limit(51));
    await expectIndexedQuery(
      Star.find({ userId, ...after })
        .sort({ at: -1, _id: -1 })
        .limit(51),
    );
    await expectIndexedQuery(Star.find({ userId, chatId }).sort({ at: -1, _id: -1 }).limit(51));
    await expectIndexedQuery(Star.find({ chatId, messageId }));
  });

  it('delete for me', async () => {
    const { MessageHidden } = models();
    await expectIndexedQuery(MessageHidden.find({ userId, chatId }));
    await expectIndexedQuery(MessageHidden.findOne({ userId, chatId, messageId }));
    await expectIndexedQuery(MessageHidden.find({ chatId, messageId, userId: { $in: [userId] } }));
    await expectIndexedQuery(
      MessageHidden.find({ userId, chatId: { $in: [chatId] }, messageId: { $in: [messageId] } }),
    );
  });

  it('forwarded files and quotes', async () => {
    const { Message, Media } = models();
    await expectIndexedQuery(Message.find({ 'media.id': messageId.toString() }));
    await expectIndexedQuery(Message.find({ 'replyTo.id': messageId.toString() }).limit(100));
    await expectIndexedQuery(Media.find({ deleteRequestedAt: { $type: 'date' } }).limit(200));
    await expectIndexedQuery(
      Message.findOne({ chatId, seq: { $lt: 5 }, _id: { $nin: [messageId] } }).sort({ seq: -1 }),
    );
  });

  it('pins and previews', async () => {
    const { ChatMember } = models();
    await expectIndexedQuery(ChatMember.find({ userId, pinnedAt: { $type: 'date' } }));
    await expectIndexedQuery(ChatMember.find({ chatId, 'previewLast.seq': 3 }));
    await expectIndexedQuery(ChatMember.find({ chatId }));
  });
});
