import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { registerChatModels } from '../db/chat-models.ts';

// Admin → Groups reads through indexes (CLAUDE.md §8).

let db: Awaited<ReturnType<typeof connectTestDb>>;
beforeAll(async () => {
  db = await connectTestDb();
});
afterAll(async () => {
  await db.cleanup();
});

describe('admin group indexes', () => {
  it('groups newest first, their admins, and their storage', async () => {
    const { Chat, ChatMember, Media, Message, Star } = registerChatModels(db.connection);
    const ids = [new Types.ObjectId()];
    await expectIndexedQuery(
      Chat.find({ type: 'group', 'group.adminDeleted': null }).sort({ _id: -1 }),
    );
    await expectIndexedQuery(
      ChatMember.find({ chatId: { $in: ids }, role: { $in: ['admin', 'owner'] }, leftAt: null }),
    );
    await expectIndexedQuery(Media.find({ chatId: { $in: ids }, status: 'ready' }));
    await expectIndexedQuery(Media.find({ chatId: ids[0] }));
    // Deleting a group: its messages and everyone's stars in it.
    await expectIndexedQuery(Message.find({ chatId: ids[0] }));
    await expectIndexedQuery(Star.find({ chatId: ids[0] }));
  });
});
