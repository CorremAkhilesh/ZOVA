import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaInfoSchema } from '@zuvo/protocol';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { EXE, mediaClient, PDF, png } from '../../../test/media-helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';
import { jpegWithExif } from '../../../test/user-helpers.ts';
import { chatModels } from '../../chats/chats.service.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => ctx.app;
type Person = Awaited<ReturnType<typeof signedIn>>;
let seed = 0;
const person = () => signedIn(app(), `m${++seed}@corremadvisory.com`);
const client = () => mediaClient(app());
const start: ReturnType<typeof mediaClient>['start'] = (...args) => client().start(...args);
const chunk: ReturnType<typeof mediaClient>['chunk'] = (...args) => client().chunk(...args);
const complete: ReturnType<typeof mediaClient>['complete'] = (...args) =>
  client().complete(...args);
const upload: ReturnType<typeof mediaClient>['upload'] = (...args) => client().upload(...args);
const ready: ReturnType<typeof mediaClient>['ready'] = (...args) => client().ready(...args);
const content: ReturnType<typeof mediaClient>['content'] = (...args) => client().content(...args);

beforeAll(async () => {
  ctx = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('checking files', () => {
  it.each([
    ['a text file called .jpg', 'image', 'photo.jpg', Buffer.from('just some text, not a photo')],
    [
      'an SVG sent as an image',
      'image',
      'x.svg',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    ],
    ['a PDF sent as a video', 'video', 'x.mp4', PDF],
    ['an executable', 'document', 'setup.exe', EXE],
    ['an executable with an innocent name', 'document', 'report.pdf', EXE],
    ['a batch file', 'document', 'run.bat', Buffer.from('del /s /q c:\\')],
    [
      'a binary file called .txt',
      'document',
      'notes.txt',
      Buffer.concat([Buffer.alloc(32), randomBytes(64)]),
    ],
    ['an unknown extension', 'document', 'thing.xyz', Buffer.from('plain words')],
  ])('refuses %s, and removes it', async (_what, kind, name, bytes) => {
    const who = await person();
    const { uploadId, response } = await upload(who, kind, name, bytes);
    expect(response.statusCode).toBe(415);
    const stored = await chatModels(app()).Media.findById(uploadId).lean();
    expect(stored?.status).toBe('failed');
    const left = await readdir(join(app().env.MEDIA_STORAGE_PATH, '.uploads')).catch(() => []);
    expect(left).not.toContain(uploadId);
  });

  it.each([
    ['PDF', 'report.pdf', PDF, 'application/pdf'],
    ['text', 'notes.txt', Buffer.from('hello'), 'text/plain'],
    ['CSV', 'data.csv', Buffer.from('a,b\n1,2\n'), 'text/plain'],
  ])('accepts %s as a document', async (_what, name, bytes, mime) => {
    const who = await person();
    const { response } = await upload(who, 'document', name, bytes);
    expect(response.statusCode).toBe(200);
    const { media } = response.json();
    expect(mediaInfoSchema.parse(media)).toMatchObject({ kind: 'document', mime, name });
  });

  it('refuses bytes past the declared size', async () => {
    const who = await person();
    const started = await start(who, { kind: 'document', name: 'a.pdf', mime: 'x/y', size: 10 });
    const { uploadId } = started.json();
    expect((await chunk(who, uploadId, 0, randomBytes(11))).statusCode).toBe(413);
  });
});

describe('images', () => {
  it('strips EXIF and GPS, auto-rotates and makes both sizes', async () => {
    const who = await person();
    const source = await jpegWithExif();
    const id = await ready(who, 'image', 'holiday.jpg', source);
    const stored = await chatModels(app()).Media.findById(id).lean();
    expect(stored).toMatchObject({ status: 'ready', mime: 'image/webp' });
    expect(stored?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.placeholder).toMatch(/^data:image\/webp;base64,/);

    const full = (await content(who, id)).rawPayload;
    const meta = await sharp(full).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(full.includes(Buffer.from('Secret Model 9'))).toBe(false);
    const thumbnail = await content(who, id, {}, '?variant=thumb');
    expect(thumbnail.headers['content-type']).toBe('image/webp');
    expect(thumbnail.statusCode).toBe(200);
  });

  it('limits the size to 2560 and 320 px, keeping transparency', async () => {
    const who = await person();
    const id = await ready(who, 'image', 'wide.png', await png());
    const full = await sharp((await content(who, id)).rawPayload).metadata();
    expect(full).toMatchObject({ width: 2560, hasAlpha: true });
    const thumb = await sharp((await content(who, id, {}, '?variant=thumb')).rawPayload).metadata();
    expect(thumb.width).toBe(320);
  });

  it('never keeps the user’s file name on disk', async () => {
    const who = await person();
    const id = await ready(who, 'image', '../../evil name.png', await png());
    const stored = await chatModels(app()).Media.findById(id).lean();
    expect(stored?.storageKey).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}$/);
    expect(stored?.storageKey).not.toContain('evil');
  });
});

describe('videos', () => {
  const MP4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypisom', 'ascii'),
    Buffer.alloc(12),
    randomBytes(4000),
  ]);

  const startVideo = async (who: Person) => {
    const started = await start(who, {
      kind: 'video',
      name: 'clip.mp4',
      mime: 'video/mp4',
      size: MP4.length,
      width: 640,
      height: 360,
      duration: 12.5,
    });
    return started.json().uploadId as string;
  };
  const poster = (who: Person, id: string, bytes: Buffer) =>
    app().inject({
      method: 'PUT',
      url: `/v1/uploads/${id}/poster`,
      headers: { ...headers(who.cookie), 'content-type': 'application/octet-stream' },
      payload: bytes,
    });

  it('takes its poster and numbers from the client, and validates the poster', async () => {
    const who = await person();
    const id = await startVideo(who);
    expect((await poster(who, id, await png())).statusCode).toBe(200);
    await chunk(who, id, 0, MP4);
    const { media } = (await complete(who, id)).json();
    expect(media).toMatchObject({
      kind: 'video',
      mime: 'video/mp4',
      width: 640,
      height: 360,
      duration: 12.5,
      hasThumbnail: true,
    });
    expect(media.placeholder).toMatch(/^data:image\/webp/);
  });

  it('refuses a poster that is not an image', async () => {
    const who = await person();
    const id = await startVideo(who);
    const response = await poster(who, id, Buffer.from('<svg></svg>'));
    expect(response.statusCode).toBe(415);
  });

  it('supports byte ranges for seeking', async () => {
    const who = await person();
    const id = await startVideo(who);
    await chunk(who, id, 0, MP4);
    await complete(who, id);
    const size = MP4.length;

    const whole = await content(who, id);
    expect(whole.statusCode).toBe(200);
    expect(whole.headers['accept-ranges']).toBe('bytes');
    expect(whole.headers['content-disposition']).toMatch(/^inline/);

    const part = await content(who, id, { range: 'bytes=100-199' });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 100-199/${size}`);
    expect(part.rawPayload.equals(MP4.subarray(100, 200))).toBe(true);

    const end = await content(who, id, { range: 'bytes=-50' });
    expect(end.headers['content-range']).toBe(`bytes ${size - 50}-${size - 1}/${size}`);
    const open = await content(who, id, { range: `bytes=${size - 10}-` });
    expect(open.rawPayload).toHaveLength(10);

    const past = await content(who, id, { range: `bytes=${size}-` });
    expect(past.statusCode).toBe(416);
    expect(past.headers['content-range']).toBe(`bytes */${size}`);
  });
});

describe('resuming', () => {
  it('continues after an interruption, from what the server has', async () => {
    const who = await person();
    const bytes = PDF;
    const { uploadId: id } = (
      await start(who, {
        kind: 'document',
        name: 'a.pdf',
        mime: 'application/pdf',
        size: bytes.length,
      })
    ).json();
    expect((await chunk(who, id, 0, bytes.subarray(0, 500))).json().offset).toBe(500);

    // The client lost track, and asks.
    const state = await app().inject({
      method: 'GET',
      url: `/v1/uploads/${id}`,
      headers: headers(who.cookie),
    });
    expect(state.json()).toMatchObject({ offset: 500, status: 'pending' });

    // Unfinished: it cannot complete yet.
    const early = await complete(who, id);
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('UPLOAD_OFFSET_MISMATCH');

    await chunk(who, id, 500, bytes.subarray(500));
    expect((await complete(who, id)).statusCode).toBe(200);
    const stored = await chatModels(app()).Media.findById(id).lean();
    expect((await content(who, id)).rawPayload.equals(bytes)).toBe(true);
    expect(stored?.size).toBe(bytes.length);
  });

  it('refuses a chunk at the wrong offset, and says where to continue', async () => {
    const who = await person();
    const { uploadId: id } = (
      await start(who, { kind: 'document', name: 'a.pdf', mime: 'x', size: 100 })
    ).json();
    await chunk(who, id, 0, randomBytes(40));
    const wrong = await chunk(who, id, 10, randomBytes(10));
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json()).toMatchObject({
      code: 'UPLOAD_OFFSET_MISMATCH',
      details: { offset: 40 },
    });
    const again = await chunk(who, id, 0, randomBytes(10));
    expect(again.statusCode).toBe(409);
  });

  it('completing twice is safe: nothing is stored twice', async () => {
    const who = await person();
    const { uploadId, response } = await upload(who, 'document', 'a.pdf', PDF);
    const first = response.json().media;
    const second = await complete(who, uploadId);
    expect(second.json().media).toEqual(first);
  });

  it('cancelling removes it', async () => {
    const who = await person();
    const { uploadId: id } = (
      await start(who, { kind: 'document', name: 'a.pdf', mime: 'x', size: 100 })
    ).json();
    await chunk(who, id, 0, randomBytes(40));
    const cancelled = await app().inject({
      method: 'DELETE',
      url: `/v1/uploads/${id}`,
      headers: headers(who.cookie),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(await chatModels(app()).Media.findById(id).lean()).toBeNull();
  });
});
