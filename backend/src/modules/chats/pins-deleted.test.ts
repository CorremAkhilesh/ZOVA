import { chatResponseSchema, syncResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { expireDueMessages } from '../../chats/expiry.service.ts';
import { removeStalePins } from '../../chats/pins.service.ts';

// A pin never outlives its message: deleted for everyone (by its sender or a group admin), for me,
// or gone with a disappearing timer. Every device hears it at once (chat:updated with the pins) or
// on its next sync, and pins left on deleted messages by older versions are cleared.

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, call, group, say, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const pin = (who: Person, chatId: string, messageId: string) =>
  call(who, 'PUT', `/v1/chats/${chatId}/messages/${messageId}/pin`, { duration: '7d' });
const remove = (who: Person, chatId: string, messageId: string, scope: 'everyone' | 'me') =>
  call(who, 'DELETE', `/v1/chats/${chatId}/messages/${messageId}?scope=${scope}`);
const pinIds = async (who: Person, chatId: string) =>
  ((await summary(who, chatId)).pins ?? []).map((item) => item.messageId);
const cursorOf = async (who: Person) =>
  syncResponseSchema.parse((await call(who, 'GET', '/v1/sync')).json()).cursor;
const syncedPins = async (who: Person, cursor: string, chatId: string) => {
  const sync = syncResponseSchema.parse(
    (await call(who, 'GET', `/v1/sync?since=${cursor}`)).json(),
  );
  return sync.chats.find((chat) => chat.id === chatId)?.pins?.map((item) => item.messageId);
};
/** chat:updated events that carry pins, for this chat. */
const pinEvents = async (who: Person, chatId: string) => {
  const events = record(await connect(url, who.cookie), 'chat:updated');
  return () =>
    events.filter((event) => event.chatId === chatId && event.pins !== undefined).at(-1)?.pins;
};

describe('a pinned message that is deleted', () => {
  it('for everyone: unpinned for both, live and on the next sync; the next pin shows', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const first = (await say(asha, chatId, 'the address')).message;
    const second = (await say(asha, chatId, 'the code')).message;
    await pin(asha, chatId, first.id);
    await pin(asha, chatId, second.id);
    const offline = await cursorOf(bharat);
    const live = await pinEvents(bharat, chatId);
    expect((await remove(asha, chatId, second.id, 'everyone')).statusCode).toBe(200);
    await waitUntil(() => expect(live()?.map((item) => item.messageId)).toEqual([first.id]));
    expect(await syncedPins(bharat, offline, chatId)).toEqual([first.id]);
    expect(await pinIds(asha, chatId)).toEqual([first.id]);
  });

  it('by a group admin: the sender’s pinned message goes for everyone, pin and all', async () => {
    const [owner, member] = [await person(), await person()];
    const chatId = await group(owner, [member]);
    const message = (await say(member, chatId, 'my numbers')).message;
    await pin(member, chatId, message.id);
    const live = await pinEvents(member, chatId);
    expect((await remove(owner, chatId, message.id, 'everyone')).statusCode).toBe(200);
    await waitUntil(() => expect(live()).toEqual([]));
    expect(await pinIds(member, chatId)).toEqual([]);
  });

  it('for me: gone from my pins on all my devices, still pinned for the other person', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const message = (await say(bharat, chatId, 'call me')).message;
    await pin(bharat, chatId, message.id);
    const offline = await cursorOf(asha);
    const live = await pinEvents(asha, chatId);
    expect((await remove(asha, chatId, message.id, 'me')).statusCode).toBe(200);
    await waitUntil(() => expect(live()).toEqual([]));
    expect(await syncedPins(asha, offline, chatId)).toEqual([]);
    expect(await pinIds(asha, chatId)).toEqual([]);
    expect(await pinIds(bharat, chatId)).toEqual([message.id]);
  });

  it('by a disappearing timer: unpinned, and both hear it', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await call(asha, 'PUT', `/v1/chats/${chatId}/disappearing`, { timer: '24h' });
    const message = (await say(asha, chatId, 'temporary')).message;
    await pin(asha, chatId, message.id);
    const live = await pinEvents(bharat, chatId);
    expect(await expireDueMessages(app(), new Date(Date.now() + 25 * 3_600_000))).toBe(1);
    await waitUntil(() => expect(live()).toEqual([]));
    expect(await pinIds(bharat, chatId)).toEqual([]);
  });
});

describe('older data', () => {
  it('pins left on deleted (or missing) messages are removed, and devices hear it', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const kept = (await say(asha, chatId, 'keep')).message;
    const deleted = (await say(asha, chatId, 'deleted long ago')).message;
    await pin(asha, chatId, kept.id);
    await pin(asha, chatId, deleted.id);
    // As an older version left it: deleted for everyone, still pinned.
    await chatModels(app()).Message.updateOne(
      { _id: oid(deleted.id) },
      { $set: { deletedForEveryoneAt: new Date(), text: null } },
    );
    const offline = await cursorOf(bharat);
    expect(await removeStalePins(app())).toBe(1);
    expect(await removeStalePins(app())).toBe(0);
    expect(await syncedPins(bharat, offline, chatId)).toEqual([kept.id]);
    const stored = await chatModels(app()).Chat.findById(chatId).lean();
    expect(stored?.pins?.map((item) => item.messageId.toString())).toEqual([kept.id]);
  });

  it('a star left on a message deleted for everyone no longer lists', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const message = (await say(asha, chatId, 'starred then deleted')).message;
    await call(bharat, 'PUT', `/v1/chats/${chatId}/messages/${message.id}/star`, {});
    await chatModels(app()).Message.updateOne(
      { _id: oid(message.id) },
      { $set: { deletedForEveryoneAt: new Date(), text: null } },
    );
    const stars = (await call(bharat, 'GET', '/v1/stars')).json();
    expect(stars.items).toEqual([]);
  });

  it('the cleanup finds chats with pins by an index', async () => {
    await expectIndexedQuery(
      chatModels(app())
        .Chat.find({ 'pins.expiresAt': { $gt: new Date(0) } })
        .limit(100),
    );
  });
});
