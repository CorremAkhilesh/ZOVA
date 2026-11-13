import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, PDF, png } from '../../../test/media-helpers.ts';
import { signedIn, uuidv7 } from '../../../test/realtime-helpers.ts';
import { chatModels, getOrCreateDirectChat } from '../../chats/chats.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => ctx.app;
type Person = Awaited<ReturnType<typeof signedIn>>;
let seed = 0;
const person = () => signedIn(app(), `ma${++seed}@corremadvisory.com`);
const client = () => mediaClient(app());
const start: ReturnType<typeof mediaClient>['start'] = (...args) => client().start(...args);
const chunk: ReturnType<typeof mediaClient>['chunk'] = (...args) => client().chunk(...args);
const complete: ReturnType<typeof mediaClient>['complete'] = (...args) =>
  client().complete(...args);
const upload: ReturnType<typeof mediaClient>['upload'] = (...args) => client().upload(...args);
const ready: ReturnType<typeof mediaClient>['ready'] = (...args) => client().ready(...args);
const content: ReturnType<typeof mediaClient>['content'] = (...args) => client().content(...args);

async function chatOf() {
  const alice = await person();
  const bob = await person();
  const { id: chatId } = await getOrCreateDirectChat(app(), alice.id, bob.id);
  return { alice, bob, chatId };
}

const attach = (who: Person, chatId: string, mediaId: string, text?: string) =>
  sendMessage(app(), { userId: who.id, chatId, clientMsgId: uuidv7(), mediaId, text });

beforeAll(async () => {
  ctx = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('authorization', () => {
  it('needs a session, on every route', async () => {
    const who = await person();
    const { uploadId } = await upload(who, 'document', 'a.pdf', PDF);
    const anonymous = [
      await app().inject({ method: 'POST', url: '/v1/uploads', payload: {} }),
      await app().inject({ method: 'GET', url: `/v1/uploads/${uploadId}` }),
      await app().inject({ method: 'GET', url: `/v1/media/${uploadId}/link` }),
      await content(null, uploadId),
    ];
    for (const response of anonymous) expect(response.statusCode).toBe(401);
  });

  it('keeps someone else’s upload out of reach', async () => {
    const owner = await person();
    const other = await person();
    const { uploadId: id } = (
      await start(owner, { kind: 'document', name: 'a.pdf', mime: 'x', size: 100 })
    ).json();
    expect((await chunk(other, id, 0, randomBytes(10))).statusCode).toBe(404);
    expect((await complete(other, id)).statusCode).toBe(404);
    const state = await app().inject({
      method: 'GET',
      url: `/v1/uploads/${id}`,
      headers: headers(other.cookie),
    });
    expect(state.statusCode).toBe(404);
  });

  it('lets chat members download, and nobody else', async () => {
    const { alice, bob, chatId } = await chatOf();
    const stranger = await person();
    const id = await ready(alice, 'document', 'a.pdf', PDF);

    // Not attached yet: only its owner.
    expect((await content(bob, id)).statusCode).toBe(404);
    expect((await content(alice, id)).statusCode).toBe(200);

    await attach(alice, chatId, id, 'see attached');
    expect((await content(bob, id)).statusCode).toBe(200);
    expect((await content(stranger, id)).statusCode).toBe(404);
    const link = await app().inject({
      method: 'GET',
      url: `/v1/media/${id}/link`,
      headers: headers(stranger.cookie),
    });
    expect(link.statusCode).toBe(404);
  });

  it('serves documents as safe downloads, and everything as nosniff and immutable', async () => {
    const who = await person();
    const html = await ready(
      who,
      'document',
      'page.html',
      Buffer.from('<script>alert(1)</script>'),
    );
    const response = await content(who, html);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(response.headers['content-disposition']).toMatch(/^attachment/);
    expect(response.headers['content-disposition']).toContain('page.html');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(response.headers['content-security-policy']).toContain('sandbox');
  });

  it('keeps odd file names from breaking the header', async () => {
    const who = await person();
    const id = await ready(who, 'document', 'rép"ort\r\nX-Evil: 1.pdf', PDF);
    const header = (await content(who, id)).headers['content-disposition'] as string;
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain("filename*=UTF-8''");
  });
});

describe('signed links', () => {
  const linkFor = async (who: Person, id: string) => {
    const response = await app().inject({
      method: 'GET',
      url: `/v1/media/${id}/link`,
      headers: headers(who.cookie),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { url: string; expiresAt: string };
  };
  const follow = (url: string) => app().inject({ method: 'GET', url });

  it('works without a session for 15 minutes, then does not', async () => {
    const who = await person();
    const id = await ready(who, 'document', 'a.pdf', PDF);
    const { url, expiresAt } = await linkFor(who, id);
    expect((await follow(url)).statusCode).toBe(200);
    const minutes = (Date.parse(expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 16 * 60_000 });
    const expired = await follow(url);
    vi.useRealTimers();
    expect(expired.statusCode).toBe(403);
    expect(expired.json().code).toBe('MEDIA_LINK_INVALID');
  });

  it('refuses a changed signature, expiry or file', async () => {
    const who = await person();
    const id = await ready(who, 'document', 'a.pdf', PDF);
    const other = await ready(who, 'document', 'b.pdf', PDF);
    const { url } = await linkFor(who, id);
    const later = url.replace(/exp=\d+/, 'exp=99999999999');
    const swapped = url.replace(id, other);
    const forged = url.replace(/sig=[^&]+/, 'sig=AAAA');
    for (const bad of [later, swapped, forged]) {
      expect((await follow(bad)).statusCode).toBe(403);
    }
  });
});

describe('attaching to a message', () => {
  it('makes a message with its type, caption and preview', async () => {
    const { alice, bob, chatId } = await chatOf();
    const id = await ready(alice, 'image', 'a.png', await png());
    const { message } = await attach(alice, chatId, id, 'Look at this');
    expect(message).toMatchObject({ type: 'image', text: 'Look at this', chatId });
    expect(message.media).toMatchObject({ id, kind: 'image', hasThumbnail: true });
    const chat = await chatModels(app()).Chat.findById(chatId).lean();
    expect(chat?.lastMessage).toMatchObject({ type: 'image', preview: 'Look at this' });
    expect(bob.id).toBeTruthy();
  });

  it('puts the file name in a document’s preview', async () => {
    const { alice, chatId } = await chatOf();
    const id = await ready(alice, 'document', 'q3.pdf', PDF);
    await attach(alice, chatId, id, 'final');
    const chat = await chatModels(app()).Chat.findById(chatId).lean();
    expect(chat?.lastMessage?.preview).toBe('q3.pdf · final');
  });

  it('only the uploader, and only once', async () => {
    const { alice, bob, chatId } = await chatOf();
    const id = await ready(alice, 'document', 'a.pdf', PDF);
    await expect(attach(bob, chatId, id)).rejects.toMatchObject({ code: 'MEDIA_NOT_ATTACHABLE' });
    await attach(alice, chatId, id);
    await expect(attach(alice, chatId, id)).rejects.toMatchObject({
      code: 'MEDIA_NOT_ATTACHABLE',
    });
    const chat = await chatModels(app()).Chat.findById(chatId).lean();
    // The refused attempts left no gap in the chat.
    expect(chat?.seq).toBe(1);
  });

  it('refuses a file still uploading', async () => {
    const { alice, chatId } = await chatOf();
    const { uploadId } = (
      await start(alice, { kind: 'document', name: 'a.pdf', mime: 'x', size: 100 })
    ).json();
    await expect(attach(alice, chatId, uploadId)).rejects.toMatchObject({
      code: 'MEDIA_NOT_ATTACHABLE',
    });
  });

  it('sending again with the same id returns the same message', async () => {
    const { alice, chatId } = await chatOf();
    const id = await ready(alice, 'document', 'a.pdf', PDF);
    const clientMsgId = uuidv7();
    const input = { userId: alice.id, chatId, clientMsgId, mediaId: id };
    const first = await sendMessage(app(), input);
    const second = await sendMessage(app(), input);
    expect(second).toMatchObject({ duplicate: true });
    expect(second.message.id).toBe(first.message.id);
  });

  it('groups an album', async () => {
    const { alice, chatId } = await chatOf();
    const albumId = '0190a000-0000-7000-8000-000000000009';
    for (const name of ['1.png', '2.png']) {
      const mediaId = await ready(alice, 'image', name, await png());
      const { message } = await sendMessage(app(), {
        userId: alice.id,
        chatId,
        clientMsgId: uuidv7(),
        mediaId,
        albumId,
      });
      expect(message.albumId).toBe(albumId);
    }
  });
});

describe('missing files', () => {
  it('says so clearly, without crashing', async () => {
    const who = await person();
    const id = await ready(who, 'image', 'a.png', await png());
    const stored = await chatModels(app()).Media.findById(id).lean();
    await app().storage.delete(stored?.storageKey ?? '');
    const response = await content(who, id);
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('MEDIA_NOT_FOUND');
  });

  it('a video with no poster has no thumbnail to give', async () => {
    const who = await person();
    const started = await start(who, {
      kind: 'document',
      name: 'a.pdf',
      mime: 'x',
      size: PDF.length,
    });
    const { uploadId: id } = started.json();
    await chunk(who, id, 0, PDF);
    await complete(who, id);
    const response = await content(who, id, {}, '?variant=thumb');
    expect(response.json().code).toBe('MEDIA_NOT_FOUND');
  });
});
