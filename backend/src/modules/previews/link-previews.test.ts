import {
  chatResponseSchema,
  galleryResponseSchema,
  linkPreviewResponseSchema,
  messageSchema,
} from '@zuvo/protocol';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { closeAllSockets, signedIn, uuidv7 } from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { registerLinkPreviewModels } from '../../db/link-preview-models.ts';
import {
  fakeResolver,
  localOptions,
  sendHtml,
  startServer,
  type TestServer,
} from '../../link-preview/test-server.ts';
import { PREVIEW_LIMIT } from '../../previews/link-previews.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let site: TestServer;
const app = () => built.app;
const { person, call, history } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

const PAGE = `<!doctype html><html><head>
<meta property="og:title" content="Quarterly results">
<meta property="og:description" content="Revenue grew &amp; costs fell">
<meta property="og:site_name" content="Example News">
<meta property="og:image" content="/cover.png">
</head><body><script>alert(1)</script></body></html>`;

beforeAll(async () => {
  const cover = await sharp({
    create: { width: 1200, height: 630, channels: 3, background: '#4f46e5' },
  })
    .png()
    .toBuffer();
  site = await startServer((request, response) => {
    if (request.url === '/cover.png') {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(cover);
    } else if (request.url?.startsWith('/file')) {
      response.writeHead(200, { 'Content-Type': 'application/pdf' });
      response.end('%PDF-1.4');
    } else sendHtml(response, PAGE);
  });
  built = await buildTestApp(
    { linkPreviewOptions: localOptions() },
    { OTP_IP_LIMIT_PER_HOUR: '1000' },
  );
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
  await site.close();
});

const lookup = (who: Person | null, url: string) => call(who, 'POST', '/v1/link-previews', { url });
const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const send = (who: Person, chatId: string, text: string, linkPreviewId?: string) =>
  sendMessage(app(), { userId: who.id, chatId, clientMsgId: uuidv7(), text, linkPreviewId });

describe('link previews', () => {
  it('fetches once, serves our own resized picture, and travels with the message', async () => {
    const [asha, bharat] = [await person(), await person()];
    const url = site.url('/results');
    const response = await lookup(asha, url);
    expect(response.statusCode).toBe(200);
    const { id, preview } = linkPreviewResponseSchema.parse(response.json());
    expect(preview).toMatchObject({
      title: 'Quarterly results',
      description: 'Revenue grew & costs fell',
      siteName: 'Example News',
      image: { width: 600, height: 315 },
    });
    const picture = await call(bharat, 'GET', `/v1/link-previews/images/${preview.image?.id}`);
    expect(picture.statusCode).toBe(200);
    expect(picture.headers['content-type']).toBe('image/webp');
    expect((await sharp(picture.rawPayload).metadata()).width).toBe(600);

    const chatId = await direct(asha, bharat);
    await send(asha, chatId, `Have a look: ${url}.`, id);
    const [received] = await history(bharat, chatId);
    expect(received?.linkPreview).toEqual(preview);
    const links = galleryResponseSchema.parse(
      (await call(bharat, 'GET', `/v1/chats/${chatId}/media?tab=links`)).json(),
    );
    expect(links.items.map((item) => item.text)).toEqual([`Have a look: ${url}.`]);
  });

  it('remembers a link for everyone, and a failure too', async () => {
    const [asha, bharat] = [await person(), await person()];
    const url = site.url(`/cached-${uuidv7()}`);
    await lookup(asha, url);
    const asked = site.paths.length;
    expect((await lookup(bharat, url)).statusCode).toBe(200);
    expect(site.paths.length).toBe(asked);

    const file = site.url(`/file-${uuidv7()}`);
    const refused = await lookup(asha, file);
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe('PREVIEW_UNAVAILABLE');
    const before = site.paths.length;
    expect((await lookup(bharat, file)).statusCode).toBe(422);
    expect(site.paths.length).toBe(before);
  });

  it('is left off a message whose text no longer has that link, and goes with the link', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const { id } = linkPreviewResponseSchema.parse(
      (await lookup(asha, site.url('/mismatch'))).json(),
    );
    const sent = await send(asha, chatId, `other link ${site.url('/elsewhere')}`, id);
    expect(sent.message.linkPreview).toBeNull();
    const kept = await send(asha, chatId, `see ${site.url('/mismatch')}`, id);
    expect(kept.message.linkPreview).not.toBeNull();
    // Editing every link away takes the preview and the Links entry with it.
    const edit = await call(asha, 'PATCH', `/v1/chats/${chatId}/messages/${kept.message.id}`, {
      text: 'never mind',
    });
    expect(edit.statusCode).toBe(200);
    const after = messageSchema.array().parse(await history(bharat, chatId));
    expect(after.at(-1)?.linkPreview ?? null).toBeNull();
    const links = galleryResponseSchema.parse(
      (await call(bharat, 'GET', `/v1/chats/${chatId}/media?tab=links`)).json(),
    );
    expect(links.items.map((item) => item.id)).toEqual([sent.message.id]);
    // Deleted for everyone: no preview either.
    await call(asha, 'DELETE', `/v1/chats/${chatId}/messages/${sent.message.id}?scope=everyone`);
    const gone = messageSchema.array().parse(await history(bharat, chatId));
    expect(gone.find((item) => item.id === sent.message.id)?.linkPreview ?? null).toBeNull();
  });

  it('refuses bad links, the signed out, unknown pictures, and too many lookups', async () => {
    const asha = await person();
    expect((await lookup(asha, 'ftp://site.test/file')).statusCode).toBe(400);
    expect((await lookup(asha, 'not a url')).statusCode).toBe(400);
    expect((await lookup(null, site.url('/x'))).statusCode).toBe(401);
    expect(
      (await call(null, 'GET', '/v1/link-previews/images/0123456789abcdef01234567')).statusCode,
    ).toBe(401);
    expect(
      (await call(asha, 'GET', '/v1/link-previews/images/0123456789abcdef01234567')).statusCode,
    ).toBe(404);
    const busy = await person();
    const url = site.url('/busy');
    for (let n = 0; n < PREVIEW_LIMIT.max; n++) await lookup(busy, url);
    const limited = await lookup(busy, url);
    expect(limited.statusCode).toBe(429);
  });

  it('every preview query uses an index', async () => {
    const { LinkPreview } = registerLinkPreviewModels(app().mongo);
    await expectIndexedQuery(LinkPreview.find({ key: 'abc', expiresAt: { $gt: new Date() } }));
    const { Message } = chatModels(app());
    await expectIndexedQuery(
      Message.find({
        chatId: oid('0123456789abcdef01234567'),
        hasLink: true,
        seq: { $lt: 9 },
      }).sort({
        seq: -1,
      }),
    );
  });
});

describe('link previews with the real address policy', () => {
  it('never reaches a private address, whatever the link says', async () => {
    // Real address policy; only DNS is faked, so a normal-looking name points at this machine.
    const strict = await buildTestApp(
      { linkPreviewOptions: { resolve: fakeResolver({ 'site.test': ['127.0.0.1'] }) } },
      { OTP_IP_LIMIT_PER_HOUR: '1000' },
    );
    try {
      const asha = await signedIn(strict.app, 'strict@corremadvisory.com');
      const connections = site.connections();
      for (const url of [
        site.url('/'),
        `http://127.0.0.1:${site.port}/`,
        `http://localhost:${site.port}/`,
        'http://169.254.169.254/latest/meta-data/',
        'http://[::1]/',
      ]) {
        const response = await strict.app.inject({
          method: 'POST',
          url: '/v1/link-previews',
          headers: headers(asha.cookie),
          payload: { url },
        });
        // 400: refused as input already (IP literals, single names); 422: refused by the fetcher.
        expect([400, 422]).toContain(response.statusCode);
      }
      expect(site.connections()).toBe(connections);
    } finally {
      await strict.cleanup();
    }
  });
});
