import {
  chatResponseSchema,
  galleryResponseSchema,
  messageUpdatedEventSchema,
  viewOnceOpenResponseSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, png } from '../../../test/media-helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  uuidv7,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { staleViewOnceQuery } from '../../chats/view-once.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, call, group, say } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let image: Buffer;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
  image = await png();
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const open = (who: Person | null, chatId: string, messageId: string) =>
  call(who, 'POST', `/v1/chats/${chatId}/messages/${messageId}/view-once`);
const minutes = (n: number, from = Date.now()) => new Date(from + n * 60_000);

async function sendOnce(who: Person, chatId: string) {
  const mediaId = await mediaClient(app()).ready(who as never, 'image', 'a.png', image);
  const { message } = await sendMessage(app(), {
    userId: who.id,
    chatId,
    clientMsgId: uuidv7(),
    mediaId,
    viewOnce: true,
  });
  const media = await chatModels(app()).Media.findById(oid(mediaId)).lean();
  return { mediaId, message, key: media?.storageKey ?? '', thumb: media?.thumbnailKey ?? '' };
}
const stored = (id: string) => chatModels(app()).Message.findById(oid(id)).lean();

describe('opening view once', () => {
  it('never gives a reply’s quote its thumbnail', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await sendOnce(asha, chatId);
    const reply = await sendMessage(app(), {
      userId: bharat.id,
      chatId,
      clientMsgId: uuidv7(),
      text: 'nice',
      replyTo: { chatId, messageId: message.id },
    });
    expect(reply.message.replyTo).toMatchObject({ mediaId: null, hasThumbnail: false });
  });

  it('works once, with a link that loads the file; then 410', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message, mediaId } = await sendOnce(asha, chatId);
    expect(message.media).toMatchObject({ placeholder: null, hasThumbnail: false });
    const response = await open(bharat, chatId, message.id);
    expect(response.statusCode).toBe(200);
    const link = viewOnceOpenResponseSchema.parse(response.json());
    expect(link.url).toContain(`/v1/media/${mediaId}/content`);
    const file = await app().inject({ method: 'GET', url: link.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');
    const again = await open(bharat, chatId, message.id);
    expect(again.statusCode).toBe(410);
    expect(again.json().code).toBe('VIEW_ONCE_OPENED');
  });

  it('refuses the sender, strangers, signed-out callers, bad ids and other messages', async () => {
    const [asha, bharat, stranger] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await sendOnce(asha, chatId);
    expect((await open(asha, chatId, message.id)).statusCode).toBe(403);
    expect((await open(stranger, chatId, message.id)).statusCode).toBe(404);
    expect((await open(null, chatId, message.id)).statusCode).toBe(401);
    expect((await open(bharat, chatId, 'nope')).statusCode).toBe(400);
    const plain = (await say(asha, chatId, 'plain')).message;
    expect((await open(bharat, chatId, plain.id)).statusCode).toBe(400);
    expect((await stored(message.id))?.viewOnceOpenedBy ?? []).toHaveLength(0);
  });

  it('two tabs at once: only one gets the link', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await sendOnce(asha, chatId);
    const codes = (
      await Promise.all([open(bharat, chatId, message.id), open(bharat, chatId, message.id)])
    ).map((response) => response.statusCode);
    expect(codes.sort()).toEqual([200, 410]);
  });

  it('is refused by /link and the content routes, for the sender too', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { mediaId } = await sendOnce(asha, chatId);
    const content = mediaClient(app()).content;
    for (const who of [asha, bharat]) {
      expect((await call(who, 'GET', `/v1/media/${mediaId}/link`)).statusCode).toBe(403);
      expect((await content(who as never, mediaId)).statusCode).toBe(403);
      expect((await content(who as never, mediaId, {}, '?variant=thumb')).statusCode).toBe(403);
    }
    const gallery = await call(bharat, 'GET', `/v1/chats/${chatId}/media?tab=media`);
    expect(galleryResponseSchema.parse(gallery.json()).items).toHaveLength(0);
  });

  it('a once link cannot be bent into a thumbnail or another file', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message } = await sendOnce(asha, chatId);
    const other = await sendOnce(asha, chatId);
    const { url: link } = viewOnceOpenResponseSchema.parse(
      (await open(bharat, chatId, message.id)).json(),
    );
    const thumb = await app().inject({ method: 'GET', url: `${link}&variant=thumb` });
    expect(thumb.statusCode).toBe(403);
    const swapped = link.replace(message.media?.id ?? '', other.mediaId);
    expect((await app().inject({ method: 'GET', url: swapped })).statusCode).toBe(403);
  });
});

describe('when everyone has opened it', () => {
  it('1:1: the sender hears "opened" and the file goes once the link has expired', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message, key, thumb } = await sendOnce(asha, chatId);
    const [sender, opener] = [await connect(url, asha.cookie), await connect(url, bharat.cookie)];
    const [toSender, toOpener] = [
      record(sender, 'message:updated'),
      record(opener, 'message:updated'),
    ];
    expect((await open(bharat, chatId, message.id)).statusCode).toBe(200);
    for (const list of [toSender, toOpener]) {
      await waitUntil(() => expect(list.length).toBeGreaterThan(0));
      const event = messageUpdatedEventSchema.parse(list.at(-1));
      expect(event.message).toMatchObject({ id: message.id, viewOnce: true, viewOnceOpened: true });
    }
    expect((await stored(message.id))?.viewOnceDoneAt).toBeInstanceOf(Date);
    // Still there while the opener's link works...
    await app().expirySweep.run(minutes(1));
    expect(await app().storage.exists(key)).toBe(true);
    // ...and gone after.
    await app().expirySweep.run(minutes(16));
    expect(await app().storage.exists(key)).toBe(false);
    expect(await app().storage.exists(thumb)).toBe(false);
  });

  it('group of 3: the file stays until the last member opens it', async () => {
    const [owner, one, two] = [await person(), await person(), await person()];
    const chatId = await group(owner, [one, two]);
    const { message, key } = await sendOnce(owner, chatId);
    const sender = record(await connect(url, owner.cookie), 'message:updated');
    expect((await open(one, chatId, message.id)).statusCode).toBe(200);
    expect((await stored(message.id))?.viewOnceDoneAt ?? null).toBeNull();
    await app().expirySweep.run(minutes(60));
    expect(await app().storage.exists(key)).toBe(true);
    expect(sender).toHaveLength(0);
    expect((await open(two, chatId, message.id)).statusCode).toBe(200);
    await waitUntil(() => expect(sender.length).toBeGreaterThan(0));
    expect(sender.at(-1)?.message.viewOnceOpened).toBe(true);
    await app().expirySweep.run(minutes(16));
    expect(await app().storage.exists(key)).toBe(false);
  });
});

describe('after 14 days unopened', () => {
  it('is done for everyone, and the file goes', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { message, key } = await sendOnce(asha, chatId);
    const watching = [
      record(await connect(url, asha.cookie), 'message:updated'),
      record(await connect(url, bharat.cookie), 'message:updated'),
    ];
    const day15 = Date.now() + 15 * 86_400_000;
    expect((await app().expirySweep.run(new Date(Date.now() + 13 * 86_400_000))).viewOnce).toBe(0);
    expect((await stored(message.id))?.viewOnceDoneAt ?? null).toBeNull();
    // Earlier tests in this file left some unopened too.
    expect((await app().expirySweep.run(new Date(day15))).viewOnce).toBeGreaterThanOrEqual(1);
    expect((await stored(message.id))?.viewOnceDoneAt).toBeInstanceOf(Date);
    for (const list of watching) {
      await waitUntil(() => expect(list.length).toBeGreaterThan(0));
      expect(list.at(-1)?.message.viewOnceOpened).toBe(true);
    }
    expect((await open(bharat, chatId, message.id)).statusCode).toBe(410);
    await app().expirySweep.run(minutes(16, day15));
    expect(await app().storage.exists(key)).toBe(false);
  });

  it('the queries use indexes', async () => {
    const { Message } = chatModels(app());
    await expectIndexedQuery(staleViewOnceQuery(app(), new Date()));
    await expectIndexedQuery(Message.findOne({ 'media.id': 'x', viewOnce: true }));
  });
});
