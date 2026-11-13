import { chatResponseSchema, messageSearchResponseSchema } from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { closeAllSockets } from '../../../test/realtime-helpers.ts';
import { chatModels } from '../../chats/chats.service.ts';
import {
  buildSearchQuery,
  SEARCH_LIMIT,
  textSearchOf,
} from '../../search/message-search.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  // The text index builds in the background on a fresh database; production syncs it at deploy.
  await chatModels(built.app).Message.init();
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const search = async (who: Person, params: Record<string, string>) => {
  const response = await call(who, 'GET', `/v1/search/messages?${new URLSearchParams(params)}`);
  expect(response.statusCode).toBe(200);
  return messageSearchResponseSchema.parse(response.json());
};
const found = async (who: Person, params: Record<string, string>) =>
  (await search(who, params)).items.map((hit) => hit.message.text);
/** A word nobody else's test uses, so results never mix. */
const word = () => `w${new Types.ObjectId().toString().slice(-10)}`;

describe('message search', () => {
  it('finds every word, newest first, with the chat and the sender named', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const tag = word();
    await say(bharat, chatId, `${tag} budget review on Monday`);
    await say(asha, chatId, `${tag} budget only`);
    await say(asha, chatId, `${tag} meetings moved`);
    expect(await found(asha, { q: `${tag} budget review` })).toEqual([
      `${tag} budget review on Monday`,
    ]);
    // English words also match their other forms.
    expect(await found(asha, { q: `${tag} meeting` })).toEqual([`${tag} meetings moved`]);
    const hits = (await search(asha, { q: `${tag} budget` })).items;
    expect(hits.map((hit) => hit.message.text)).toEqual([
      `${tag} budget only`,
      `${tag} budget review on Monday`,
    ]);
    expect(hits[1]).toMatchObject({
      chat: { id: chatId, type: 'direct' },
      senderName: expect.any(String),
    });
    expect(hits[1]?.chat.title).toBe(hits[1]?.senderName);
  });

  it('works for Hindi', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const tag = word();
    await say(bharat, chatId, `${tag} आज की बैठक रद्द हो गई।`);
    await say(bharat, chatId, `${tag} कल मिलते हैं`);
    expect(await found(asha, { q: `${tag} बैठक` })).toEqual([`${tag} आज की बैठक रद्द हो गई।`]);
    expect(await found(asha, { q: `रद्द ${tag} बैठक` })).toHaveLength(1);
    expect(await found(asha, { q: `${tag} मिलते` })).toEqual([`${tag} कल मिलते हैं`]);
    expect(await found(asha, { q: `${tag} दफ़्तर` })).toEqual([]);
  });

  it('only what I may see: my chats, my part of a group, not hidden, deleted or blocked', async () => {
    const [asha, bharat, chitra, outsider] = [
      await person(),
      await person(),
      await person(),
      await person(),
    ];
    const tag = word();
    const groupId = await group(asha, [bharat]);
    await say(asha, groupId, `${tag} before chitra`);
    await call(asha, 'POST', `/v1/chats/${groupId}/members`, { userIds: [chitra.id] });
    await say(asha, groupId, `${tag} while chitra was here`);
    await call(chitra, 'POST', `/v1/chats/${groupId}/leave`);
    await say(asha, groupId, `${tag} after chitra left`);
    expect(await found(chitra, { q: tag })).toEqual([`${tag} while chitra was here`]);
    expect(await found(outsider, { q: tag })).toEqual([]);

    const chatId = await direct(asha, bharat);
    const hidden = (await say(bharat, chatId, `${tag} hidden for asha`)).message.id;
    await call(asha, 'DELETE', `/v1/chats/${chatId}/messages/${hidden}?scope=me`);
    const gone = (await say(bharat, chatId, `${tag} deleted for everyone`)).message.id;
    await call(bharat, 'DELETE', `/v1/chats/${chatId}/messages/${gone}?scope=everyone`);
    const seen = await found(asha, { q: tag, chatId });
    expect(seen).toEqual([]);

    await say(bharat, chatId, `${tag} from bharat`);
    expect(await found(asha, { q: tag, chatId })).toEqual([`${tag} from bharat`]);
    await call(asha, 'PUT', `/v1/me/blocks/${bharat.id}`);
    expect(await found(asha, { q: tag, chatId })).toEqual([]);
    await call(asha, 'DELETE', `/v1/me/blocks/${bharat.id}`);

    await call(asha, 'POST', `/v1/chats/${chatId}/clear`);
    expect(await found(asha, { q: tag, chatId })).toEqual([]);
    // Bharat cleared and hid nothing: he still finds both, but never the deleted one.
    expect(await found(bharat, { q: tag, chatId })).toEqual([
      `${tag} from bharat`,
      `${tag} hidden for asha`,
    ]);
  });

  it('removed from a group: what came before stays findable, as in history', async () => {
    const [asha, bharat] = [await person(), await person()];
    const tag = word();
    const groupId = await group(asha, [bharat]);
    await say(asha, groupId, `${tag} for members`);
    expect(await found(bharat, { q: tag })).toEqual([`${tag} for members`]);
    await call(asha, 'DELETE', `/v1/chats/${groupId}/members/${bharat.id}`);
    const after = await found(bharat, { q: tag });
    // Someone removed keeps what came before, like history does.
    expect(after).toEqual([`${tag} for members`]);
  });

  it('filters by kind, with or without words, and in one chat', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const other = await direct(asha, await person());
    const tag = word();
    await say(bharat, chatId, `${tag} read https://example.com/report`);
    await say(bharat, chatId, `${tag} no link here`);
    await say(asha, other, `${tag} www.example.org elsewhere`);
    // A photo with a caption, stored as the upload flow would leave it.
    const { Chat, Message } = chatModels(app());
    const chat = await Chat.findByIdAndUpdate(chatId, { $inc: { seq: 1 } }, { new: true }).lean();
    await Message.create({
      chatId: new Types.ObjectId(chatId),
      seq: chat?.seq ?? 99,
      clientMsgId: null,
      senderId: new Types.ObjectId(bharat.id),
      type: 'image',
      text: `${tag} beach`,
    });
    expect(await found(asha, { q: tag, filter: 'links' })).toEqual([
      `${tag} www.example.org elsewhere`,
      `${tag} read https://example.com/report`,
    ]);
    expect(await found(asha, { q: tag, filter: 'links', chatId })).toEqual([
      `${tag} read https://example.com/report`,
    ]);
    expect(await found(asha, { q: tag, filter: 'photos' })).toEqual([`${tag} beach`]);
    expect(await found(asha, { filter: 'photos', chatId })).toEqual([`${tag} beach`]);
    expect(await found(asha, { q: tag, filter: 'voice' })).toEqual([]);
  });

  it('pages back with a cursor, never repeating', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const tag = word();
    for (const n of [1, 2, 3, 4, 5]) await say(asha, chatId, `${tag} number ${n}`);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await search(asha, { q: tag, limit: '2', ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((hit) => hit.message.text ?? ''));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([5, 4, 3, 2, 1].map((n) => `${tag} number ${n}`));
  });

  it('refuses bad input, other people’s chats, the signed out, and too many searches', async () => {
    const [asha, bharat, outsider] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    const get = (who: Person | null, query: string) =>
      call(who, 'GET', `/v1/search/messages?${query}`);
    expect((await get(asha, '')).statusCode).toBe(400);
    expect((await get(asha, `q=${'a'.repeat(101)}`)).statusCode).toBe(400);
    expect((await get(asha, 'q=x&filter=gifs')).statusCode).toBe(400);
    expect((await get(asha, 'q=x&chatId=nope')).statusCode).toBe(400);
    expect((await get(outsider, `q=x&chatId=${chatId}`)).statusCode).toBe(404);
    expect((await get(null, 'q=x')).statusCode).toBe(401);
    const busy = await person();
    for (let n = 0; n < SEARCH_LIMIT.max; n++) await get(busy, 'q=hello');
    expect((await get(busy, 'q=hello')).statusCode).toBe(429);
  });
});

describe('search query', () => {
  it('quotes each word so all must match, and drops quotes and negation', () => {
    expect(textSearchOf('budget  review')).toBe('"budget" "review"');
    expect(textSearchOf('-secret "x"')).toBe('"secret" "x"');
    expect(textSearchOf('   ')).toBeNull();
  });

  it('every shape uses an index', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    const groupId = await group(asha, [bharat]);
    await call(asha, 'POST', `/v1/chats/${groupId}/members`, { userIds: [chitra.id] });
    await call(asha, 'POST', `/v1/chats/${chatId}/clear`);
    const { Message } = chatModels(app());
    const cursor = new Types.ObjectId().toString();
    for (const input of [
      { q: 'hello', limit: 20 },
      { q: 'hello', chatId, limit: 20, cursor },
      { q: '', filter: 'photos' as const, limit: 20 },
      { q: '', filter: 'links' as const, chatId, limit: 20 },
      { q: 'hello', filter: 'docs' as const, limit: 20 },
    ]) {
      // Chitra is in the group only (joined late); Asha cleared the direct chat.
      for (const who of input.chatId ? [asha] : [asha, chitra]) {
        const filter = await buildSearchQuery(app(), who.id, input);
        if (filter) await expectIndexedQuery(Message.find(filter).sort({ _id: -1 }).limit(21));
      }
    }
  });
});
