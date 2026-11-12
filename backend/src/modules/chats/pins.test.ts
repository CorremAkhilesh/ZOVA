import { chatResponseSchema, pinsResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient, systemKinds } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { closeAllSockets } from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { sweepExpiredPins } from '../../chats/pins.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say, history, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const pin = (who: Person | null, chatId: string, messageId: string, duration = '24h') =>
  call(who, 'PUT', `/v1/chats/${chatId}/messages/${messageId}/pin`, { duration });
const unpin = (who: Person, chatId: string, messageId: string) =>
  call(who, 'DELETE', `/v1/chats/${chatId}/messages/${messageId}/pin`);
const sent = async (who: Person, chatId: string, text: string) =>
  (await say(who, chatId, text)).message;

describe('pinned messages', () => {
  it('in a 1:1 chat either person pins, for the time chosen, with a notice for both', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const message = await sent(asha, chatId, 'the address is 12 Park Road');
    const response = await pin(bharat, chatId, message.id, '7d');
    expect(response.statusCode).toBe(200);
    const [pinned] = pinsResponseSchema.parse(response.json()).pins;
    expect(pinned).toMatchObject({ messageId: message.id, seq: message.seq, pinnedBy: bharat.id });
    const days = (Date.parse(pinned?.expiresAt ?? '') - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect((await summary(asha, chatId)).pins?.map((item) => item.messageId)).toEqual([message.id]);
    expect(systemKinds(await history(asha, chatId))).toContain('pinned');
  });

  it('keeps 3: a fourth replaces the oldest, newest first; unpin takes one away', async () => {
    const asha = await person();
    const chatId = await group(asha, [await person()]);
    const messages = [];
    for (const n of [1, 2, 3, 4]) messages.push(await sent(asha, chatId, `point ${n}`));
    for (const message of messages) await pin(asha, chatId, message.id);
    const pins = (await summary(asha, chatId)).pins ?? [];
    expect(pins.map((item) => item.seq)).toEqual(
      [messages[3], messages[2], messages[1]].map((message) => message?.seq),
    );
    const after = await unpin(asha, chatId, messages[2]?.id ?? '');
    expect(pinsResponseSchema.parse(after.json()).pins).toHaveLength(2);
  });

  it('in a group, follow the "Pin messages" setting', async () => {
    const [owner, member] = [await person(), await person()];
    const chatId = await group(owner, [member]);
    const message = await sent(owner, chatId, 'rules');
    expect((await pin(member, chatId, message.id)).statusCode).toBe(200);
    await call(owner, 'PUT', `/v1/chats/${chatId}/group/settings`, { pinMessages: 'admins' });
    const refused = await pin(member, chatId, message.id);
    expect(refused.statusCode).toBe(403);
    expect((await unpin(member, chatId, message.id)).statusCode).toBe(403);
    expect((await pin(owner, chatId, message.id)).statusCode).toBe(200);
  });

  it('follow history: someone who joined later never sees an older pin, nor may pin it', async () => {
    const [owner, early, late] = [await person(), await person(), await person()];
    const chatId = await group(owner, [early]);
    const before = await sent(owner, chatId, 'before late joined');
    await pin(owner, chatId, before.id);
    await call(owner, 'POST', `/v1/chats/${chatId}/members`, { userIds: [late.id] });
    expect((await summary(early, chatId)).pins).toHaveLength(1);
    expect((await summary(late, chatId)).pins).toEqual([]);
    expect((await pin(late, chatId, before.id)).statusCode).toBe(404);
  });

  it('go when the message is deleted for everyone, and when their time is up', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const deleted = await sent(asha, chatId, 'oops');
    const expiring = await sent(asha, chatId, 'for a day');
    await pin(asha, chatId, deleted.id);
    await pin(asha, chatId, expiring.id);
    await call(asha, 'DELETE', `/v1/chats/${chatId}/messages/${deleted.id}?scope=everyone`);
    expect((await summary(bharat, chatId)).pins?.map((item) => item.messageId)).toEqual([
      expiring.id,
    ]);
    // Time is up: hidden at once, removed by the job.
    await chatModels(app()).Chat.updateOne(
      { _id: oid(chatId) },
      { $set: { 'pins.0.expiresAt': new Date(Date.now() - 1000) } },
    );
    expect((await summary(bharat, chatId)).pins).toEqual([]);
    expect(await sweepExpiredPins(app())).toBeGreaterThanOrEqual(1);
    const stored = await chatModels(app()).Chat.findById(chatId).lean();
    expect(stored?.pins ?? []).toEqual([]);
  });

  it('refuse bad input, system messages, outsiders and the signed out', async () => {
    const [asha, bharat, outsider] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const message = await sent(asha, chatId, 'hi');
    const notice = (await history(asha, chatId)).find((item) => item.system);
    expect((await pin(asha, chatId, message.id, '1y')).statusCode).toBe(400);
    expect((await pin(asha, chatId, notice?.id ?? '')).statusCode).toBe(404);
    expect((await pin(outsider, chatId, message.id)).statusCode).toBe(404);
    expect((await pin(null, chatId, message.id)).statusCode).toBe(401);
  });

  it('the expiry job’s query uses an index', async () => {
    const { Chat } = chatModels(app());
    await expectIndexedQuery(Chat.find({ 'pins.expiresAt': { $lte: new Date() } }).limit(100));
  });
});
