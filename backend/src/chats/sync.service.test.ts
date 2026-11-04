import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../test/helpers.ts';
import { uuidv7 } from '../../test/realtime-helpers.ts';
import { insertUser } from '../../test/user-helpers.ts';
import { chatModels, getOrCreateDirectChat } from './chats.service.ts';
import { markRead, sendMessage } from './messages.service.ts';
import { syncSince } from './sync.service.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => ctx.app;
let seed = 0;
const user = () => insertUser(app(), { email: `s${++seed}@corremadvisory.com` });
const say = (userId: string, chatId: string, text = 'hi') =>
  sendMessage(app(), { userId, chatId, clientMsgId: uuidv7(), text });

beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('sync', () => {
  it('returns exactly what was missed, then nothing', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const start = await syncSince(app(), b, undefined, 100);
    expect(start).toMatchObject({ reset: true, cursor: '0', chats: [], messages: [] });

    const { id } = await getOrCreateDirectChat(app(), a, b);
    await say(a, id, 'one');
    await say(b, id, 'two');
    await say(a, id, 'three');
    await markRead(app(), b, id, 3);

    const caught = await syncSince(app(), b, start.cursor, 100);
    expect(caught.reset).toBe(false);
    expect(caught.messages.map((m) => m.text)).toEqual(['one', 'two', 'three']);
    expect(caught.chats).toMatchObject([{ id, lastReadSeq: 3, unreadCount: 0 }]);

    await say(a, id, 'four');
    const next = await syncSince(app(), b, caught.cursor, 100);
    expect(next.messages.map((m) => m.text)).toEqual(['four']);
    expect(await syncSince(app(), b, next.cursor, 100)).toMatchObject({
      cursor: next.cursor,
      reset: false,
      hasMore: false,
      messages: [],
    });
  });

  it('pages long catch-ups without losing or repeating anything', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const { id } = await getOrCreateDirectChat(app(), a, b);
    await Promise.all(Array.from({ length: 7 }, (_, i) => say(a, id, `m${i}`)));
    const seen: number[] = [];
    let cursor = '0';
    let rounds = 0;
    for (let more = true; more; rounds++) {
      const page = await syncSince(app(), b, cursor, 3);
      seen.push(...page.messages.map((m) => m.seq));
      cursor = page.cursor;
      more = page.hasMore;
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rounds).toBe(3);
  });

  it('asks for a reload when the cursor is from the future or its log has expired', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const { id } = await getOrCreateDirectChat(app(), a, b);
    await say(a, id, 'one');
    await say(a, id, 'two');
    expect(await syncSince(app(), b, '999', 10)).toMatchObject({ reset: true, cursor: '2' });

    const { UserUpdate } = chatModels(app());
    await UserUpdate.deleteOne({ userId: new Types.ObjectId(b), pts: 1 });
    expect(await syncSince(app(), b, '0', 10)).toMatchObject({ reset: true, cursor: '2' });
    expect((await syncSince(app(), b, '1', 10)).messages.map((m) => m.seq)).toEqual([2]);
  });

  it('never returns chats or messages of a chat I left', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const { id } = await getOrCreateDirectChat(app(), a, b);
    await say(a, id, 'secret');
    await chatModels(app()).ChatMember.updateOne(
      { chatId: new Types.ObjectId(id), userId: new Types.ObjectId(b) },
      { $set: { leftAt: new Date() } },
    );
    expect(await syncSince(app(), b, '0', 10)).toMatchObject({ chats: [], messages: [] });
  });
});
