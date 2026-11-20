import { messageHistoryResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { closeAllSockets } from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';

// The app fills a hole in a chat (a message it missed) with GET /v1/chats/:id/messages?after=&before=:
// exactly the positions between, never what I deleted for myself, only for members, and indexed.

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, say } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const direct = async (who: Person, other: Person) =>
  (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json().chat.id as string;
const range = async (who: Person, chatId: string, after: number, before: number, limit = 50) => {
  const response = await call(
    who,
    'GET',
    `/v1/chats/${chatId}/messages?after=${after}&before=${before}&limit=${limit}`,
  );
  return { status: response.statusCode, body: response.json() };
};

describe('a range of a chat', () => {
  it('returns exactly the positions between, oldest first, the newest page first', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    for (const n of [1, 2, 3, 4, 5, 6]) await say(asha, chatId, `m${n}`);
    const between = await range(bharat, chatId, 2, 6);
    expect(between.status).toBe(200);
    const page = messageHistoryResponseSchema.parse(between.body);
    expect(page.items.map((item) => item.seq)).toEqual([3, 4, 5]);
    expect(page.hasMore).toBe(false);
    const small = messageHistoryResponseSchema.parse((await range(bharat, chatId, 0, 7, 2)).body);
    expect(small.items.map((item) => item.seq)).toEqual([5, 6]);
    expect(small.hasMore).toBe(true);
  });

  it('leaves out what I deleted for myself; outsiders get nothing', async () => {
    const [asha, bharat, outsider] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    const kept = (await say(asha, chatId, 'kept')).message;
    const gone = (await say(asha, chatId, 'gone')).message;
    await call(bharat, 'DELETE', `/v1/chats/${chatId}/messages/${gone.id}?scope=me`);
    const page = messageHistoryResponseSchema.parse((await range(bharat, chatId, 0, 10)).body);
    expect(page.items.map((item) => item.id)).toEqual([kept.id]);
    expect((await range(outsider, chatId, 0, 10)).status).toBe(404);
  });

  it('is served by an index', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await say(asha, chatId, 'x');
    await expectIndexedQuery(
      chatModels(app())
        .Message.find({ chatId: oid(chatId), seq: { $gt: 2, $lt: 9 }, _id: { $nin: [] } })
        .sort({ seq: -1 })
        .limit(51),
    );
  });
});
