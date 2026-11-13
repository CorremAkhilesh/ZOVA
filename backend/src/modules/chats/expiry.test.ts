import {
  chatResponseSchema,
  galleryResponseSchema,
  messageSearchResponseSchema,
  messagesExpiredEventSchema,
  starsResponseSchema,
  syncResponseSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, PDF } from '../../../test/media-helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  uuidv7,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { dueMessagesQuery, expireDueMessages } from '../../chats/expiry.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, call, say, history, summary } = groupClient(app);
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
const timed = async (a: Person, b: Person) => {
  const chatId = await direct(a, b);
  await call(a, 'PUT', `/v1/chats/${chatId}/disappearing`, { timer: '24h' });
  return chatId;
};
const later = () => new Date(Date.now() + 25 * 3_600_000);
const syncCursor = async (who: Person) =>
  syncResponseSchema.parse((await call(who, 'GET', '/v1/sync?since=0')).json()).cursor;

async function sendFile(who: Person, chatId: string) {
  const mediaId = await mediaClient(app()).ready(who as never, 'document', 'a.pdf', PDF);
  const { message } = await sendMessage(app(), {
    userId: who.id,
    chatId,
    clientMsgId: uuidv7(),
    mediaId,
  });
  return { mediaId, message };
}
const fileKey = async (mediaId: string) =>
  (await chatModels(app()).Media.findById(oid(mediaId)).lean())?.storageKey ?? '';

describe('expiry sweep', () => {
  it('deletes messages whose time is up, and only those', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const kept = (await say(asha, chatId, 'stays')).message;
    await call(asha, 'PUT', `/v1/chats/${chatId}/disappearing`, { timer: '24h' });
    const gone = (await say(bharat, chatId, 'goes')).message;
    expect(await expireDueMessages(app())).toBe(0);
    expect(await expireDueMessages(app(), later())).toBe(1);
    const ids = (await history(asha, chatId)).map((item) => item.id);
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(gone.id);
    expect(await chatModels(app()).Message.findById(oid(gone.id)).lean()).toBeNull();
  });

  it('tells both people (messages:expired) and moves the chat list back', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await timed(asha, bharat);
    await say(asha, chatId, 'one');
    const two = (await say(bharat, chatId, 'two')).message;
    const sockets = [await connect(url, asha.cookie), await connect(url, bharat.cookie)];
    const expired = sockets.map((socket) => record(socket, 'messages:expired'));
    const updated = sockets.map((socket) => record(socket, 'chat:updated'));
    await expireDueMessages(app(), later());
    for (const [n, list] of expired.entries()) {
      await waitUntil(() => expect(list).toHaveLength(1));
      const event = messagesExpiredEventSchema.parse(list[0]);
      expect(event.chatId).toBe(chatId);
      expect(event.seqs).toContain(two.seq);
      await waitUntil(() => expect(updated[n]?.length).toBeGreaterThan(0));
      // Left: the timer notice, which never expires.
      expect(updated[n]?.at(-1)?.lastMessage?.type).toBe('system');
    }
    expect((await summary(asha, chatId)).lastMessage?.system?.kind).toBe('disappearing_changed');
  });

  it('a device that was away removes them on its next sync', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await timed(asha, bharat);
    const message = (await say(asha, chatId, 'brief')).message;
    const cursor = await syncCursor(bharat);
    await expireDueMessages(app(), later());
    const sync = syncResponseSchema.parse(
      (await call(bharat, 'GET', `/v1/sync?since=${cursor}`)).json(),
    );
    expect(sync.removed).toContainEqual({ chatId, seq: message.seq });
    expect(sync.messages.map((item) => item.id)).not.toContain(message.id);
    expect(sync.chats.find((chat) => chat.id === chatId)?.lastMessage?.seq).not.toBe(message.seq);
    // History tolerates the gap.
    const full = syncResponseSchema.parse((await call(bharat, 'GET', '/v1/sync?since=0')).json());
    expect(full.reset).toBe(false);
  });

  it('leaves nothing behind: stars, pins, search, gallery', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await timed(asha, bharat);
    const word = `zebra${Date.now()}`;
    const text = (await say(asha, chatId, `${word} crossing`)).message;
    const { message: file } = await sendFile(bharat, chatId);
    const base = `/v1/chats/${chatId}/messages/${text.id}`;
    expect((await call(bharat, 'PUT', `${base}/star`)).statusCode).toBe(200);
    expect((await call(asha, 'PUT', `${base}/pin`, { duration: '7d' })).statusCode).toBe(200);
    await expireDueMessages(app(), later());

    const stars = starsResponseSchema.parse((await call(bharat, 'GET', '/v1/stars')).json());
    expect(stars.items).toHaveLength(0);
    expect((await summary(asha, chatId)).pins ?? []).toHaveLength(0);
    // A fresh database builds its text index in the background.
    await chatModels(app()).Message.init();
    const search = await call(asha, 'GET', `/v1/search/messages?q=${word}`);
    expect(search.statusCode).toBe(200);
    expect(messageSearchResponseSchema.parse(search.json()).items).toHaveLength(0);
    const gallery = await call(asha, 'GET', `/v1/chats/${chatId}/media?tab=docs`);
    const items = galleryResponseSchema.parse(gallery.json()).items;
    expect(items.map((item) => item.id)).not.toContain(file.id);
    const { Star } = chatModels(app());
    expect(await Star.countDocuments({ messageId: oid(text.id) })).toBe(0);
  });

  it('deletes the file, unless a forwarded copy still uses it', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await timed(asha, bharat);
    const lone = await sendFile(asha, chatId);
    const shared = await sendFile(asha, chatId);
    const elsewhere = await direct(bharat, chitra);
    const forward = await call(bharat, 'POST', '/v1/forward', {
      forwardId: crypto.randomUUID(),
      messages: [{ chatId, messageId: shared.message.id }],
      chatIds: [elsewhere],
    });
    expect(forward.statusCode).toBe(200);
    const [loneKey, sharedKey] = [await fileKey(lone.mediaId), await fileKey(shared.mediaId)];
    expect(await app().storage.exists(loneKey)).toBe(true);

    const result = await app().expirySweep.run(later());
    expect(result.messages).toBe(2);
    expect(await app().storage.exists(loneKey)).toBe(false);
    expect(await chatModels(app()).Media.findById(oid(lone.mediaId)).lean()).toBeNull();
    expect(await app().storage.exists(sharedKey)).toBe(true);
    const link = await call(chitra, 'GET', `/v1/media/${shared.mediaId}/link`);
    expect(link.statusCode).toBe(200);
  });

  it('a reply elsewhere no longer quotes it', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await timed(asha, bharat);
    const original = (await say(asha, chatId, 'secret plan')).message;
    await call(asha, 'PUT', `/v1/chats/${chatId}/disappearing`, { timer: 'off' });
    const { message: reply } = await sendMessage(app(), {
      userId: bharat.id,
      chatId,
      clientMsgId: uuidv7(),
      text: 'ok',
      replyTo: { chatId, messageId: original.id },
    });
    expect(reply.replyTo?.text).toBe('secret plan');
    await expireDueMessages(app(), later());
    const shown = (await history(asha, chatId)).find((item) => item.id === reply.id);
    expect(shown?.replyTo).toMatchObject({ text: '', deleted: true });
  });

  it('the due-messages query uses an index', async () => {
    await expectIndexedQuery(dueMessagesQuery(app(), new Date()));
  });
});

describe('POST /v1/test/expire-messages', () => {
  it('makes a chat’s timed messages due and runs the sweep', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await timed(asha, bharat);
    await say(asha, chatId, 'a');
    await say(bharat, chatId, 'b');
    const response = await call(asha, 'POST', '/v1/test/expire-messages', { chatId });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ expired: 2 });
    expect((await history(bharat, chatId)).map((item) => item.type)).toEqual(['system']);
    expect((await call(asha, 'POST', '/v1/test/expire-messages', {})).statusCode).toBe(400);
  });
});
