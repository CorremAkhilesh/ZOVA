import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../test/helpers.ts';
import { uuidv7 } from '../../test/realtime-helpers.ts';
import { insertUser } from '../../test/user-helpers.ts';
import {
  chatModels,
  getOrCreateDirectChat,
  getOrCreateSelfChat,
  listChats,
  pairKeyOf,
} from './chats.service.ts';
import { toPreview } from './message-format.ts';
import { getHistory, markRead, sendMessage } from './messages.service.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => ctx.app;
let seed = 0;
const user = (fields: Parameters<typeof insertUser>[1] | object = {}) =>
  insertUser(app(), {
    email: `u${++seed}@corremadvisory.com`,
    displayName: `User ${seed}`,
    ...fields,
  });
const say = (userId: string, chatId: string, text = 'hi', clientMsgId = uuidv7()) =>
  sendMessage(app(), { userId, chatId, clientMsgId, text });

beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('sending', () => {
  it('gives 50 parallel sends the positions 1..50, with no gaps or duplicates', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const chat = await getOrCreateDirectChat(app(), a, b);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => say(i % 2 ? a : b, chat.id, `m${i}`)),
    );
    const seqs = results.map((result) => result.message.seq).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const { Chat, Message } = chatModels(app());
    expect((await Chat.findById(chat.id).lean())?.seq).toBe(50);
    expect(await Message.countDocuments({ chatId: new Types.ObjectId(chat.id) })).toBe(50);
  });

  it('stores the same clientMsgId once, sequentially or in parallel', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const chat = await getOrCreateDirectChat(app(), a, b);
    const id = uuidv7();
    const first = await say(a, chat.id, 'once', id);
    const again = await say(a, chat.id, 'once', id);
    expect(first.duplicate).toBe(false);
    expect(again).toMatchObject({ duplicate: true, message: { id: first.message.id, seq: 1 } });

    const raced = uuidv7();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => say(a, chat.id, 'raced', raced)));
    expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    const { Message, Chat } = chatModels(app());
    expect(await Message.countDocuments({ chatId: new Types.ObjectId(chat.id) })).toBe(2);
    // The rejected attempts left no gap.
    expect((await Chat.findById(chat.id).lean())?.seq).toBe(2);
  });

  it('refuses reusing a clientMsgId in another chat, non-members and deactivated recipients', async () => {
    const [a, b, c, gone] = await Promise.all([user(), user(), user(), user()]);
    const ab = await getOrCreateDirectChat(app(), a, b);
    const ac = await getOrCreateDirectChat(app(), a, c);
    const id = uuidv7();
    await say(a, ab.id, 'x', id);
    await expect(say(a, ac.id, 'x', id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(say(c, ab.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const toGone = await getOrCreateDirectChat(app(), a, gone);
    await chatModels(app())
      .Chat.db.collection('user')
      .updateOne({ _id: new Types.ObjectId(gone) }, { $set: { status: 'deactivated' } });
    await expect(say(a, toGone.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps a short one-line preview', () => {
    expect(toPreview('  two\n\nlines  ')).toBe('two lines');
    expect(toPreview('x'.repeat(200))).toHaveLength(121);
  });
});

describe('direct chats and Saved Messages', () => {
  it('creates one chat when two requests race, whichever side opens it', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const chats = await Promise.all([
      getOrCreateDirectChat(app(), a, b),
      getOrCreateDirectChat(app(), b, a),
      getOrCreateDirectChat(app(), a, b),
    ]);
    expect(new Set(chats.map((chat) => chat.id)).size).toBe(1);
    const { Chat, ChatMember } = chatModels(app());
    expect(await Chat.countDocuments({ pairKey: pairKeyOf(a, b) })).toBe(1);
    expect(await ChatMember.countDocuments({ chatId: new Types.ObjectId(chats[0]?.id) })).toBe(2);
  });

  it('refuses yourself, unknown and deactivated people', async () => {
    const [a, gone] = await Promise.all([user(), user({ status: 'deactivated' })]);
    await expect(getOrCreateDirectChat(app(), a, a)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(getOrCreateDirectChat(app(), a, gone)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      getOrCreateDirectChat(app(), a, new Types.ObjectId().toString()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps one Saved Messages per user, even when created in parallel', async () => {
    const a = await user();
    const chats = await Promise.all([1, 2, 3].map(() => getOrCreateSelfChat(app(), a)));
    expect(new Set(chats.map((chat) => chat.id)).size).toBe(1);
    expect(chats[0]).toMatchObject({ type: 'self', otherUser: null });
    const sent = await say(a, chats[0]?.id ?? '', 'note to self');
    const [saved] = (await listChats(app(), a, 10)).items;
    // My own messages are never unread.
    expect(saved).toMatchObject({ unreadCount: 0, lastReadSeq: sent.message.seq });
  });
});

describe('chat list', () => {
  it('sorts by activity, pages by cursor, counts unread and applies privacy', async () => {
    const me = await user();
    const hidden = await user({ about: 'secret', privacy: { about: 'nobody' } });
    const [p1, p2] = await Promise.all([user(), user()]);
    const c1 = await getOrCreateDirectChat(app(), me, p1);
    const c2 = await getOrCreateDirectChat(app(), me, p2);
    const c3 = await getOrCreateDirectChat(app(), me, hidden);
    await say(p1, c1.id, 'one');
    await say(hidden, c3.id, 'two');
    await say(hidden, c3.id, 'three');

    const first = await listChats(app(), me, 2);
    expect(first.items.map((chat) => chat.id)).toEqual([c3.id, c1.id]);
    expect(first.items[0]).toMatchObject({
      unreadCount: 2,
      lastMessage: { preview: 'three', seq: 2 },
      otherUser: { id: hidden, about: null },
    });
    const second = await listChats(app(), me, 2, first.nextCursor ?? undefined);
    expect(second.items.map((chat) => chat.id)).toEqual([c2.id]);
    expect(second.nextCursor).toBeNull();
    await expect(listChats(app(), me, 2, 'nonsense')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('shows a chat to the other person only from the first message', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const chat = await getOrCreateDirectChat(app(), a, b);
    expect((await listChats(app(), b, 10)).items).toEqual([]);
    expect((await listChats(app(), a, 10)).items.map((c) => c.id)).toEqual([chat.id]);
    await say(a, chat.id);
    expect((await listChats(app(), b, 10)).items.map((c) => c.id)).toEqual([chat.id]);
  });
});

describe('history and read state', () => {
  it('pages before and after a position, always oldest first', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const { id } = await getOrCreateDirectChat(app(), a, b);
    for (const n of [1, 2, 3, 4, 5]) await say(a, id, `m${n}`);
    const seqs = async (query: { before?: number; after?: number; limit: number }) => {
      const page = await getHistory(app(), a, id, query);
      return [page.items.map((m) => m.seq), page.hasMore];
    };
    expect(await seqs({ limit: 2 })).toEqual([[4, 5], true]);
    expect(await seqs({ before: 4, limit: 2 })).toEqual([[2, 3], true]);
    expect(await seqs({ before: 2, limit: 2 })).toEqual([[1], false]);
    expect(await seqs({ after: 3, limit: 5 })).toEqual([[4, 5], false]);
    expect(await seqs({ after: 1, before: 4, limit: 5 })).toEqual([[2, 3], false]);
  });

  it('never moves the read position back or past the end', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const { id } = await getOrCreateDirectChat(app(), a, b);
    for (const n of [1, 2, 3]) await say(a, id, `m${n}`);
    expect(await markRead(app(), b, id, 2)).toMatchObject({ lastReadSeq: 2, unreadCount: 1 });
    expect(await markRead(app(), b, id, 1)).toMatchObject({ lastReadSeq: 2, unreadCount: 1 });
    expect(await markRead(app(), b, id, 99)).toMatchObject({ lastReadSeq: 3, unreadCount: 0 });
    const parallel = await Promise.all([1, 2, 3].map((seq) => markRead(app(), a, id, seq)));
    expect(parallel.every((result) => result.lastReadSeq === 3)).toBe(true);
    await expect(markRead(app(), await user(), id, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getHistory(app(), await user(), id, { limit: 5 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
