import {
  WALLPAPER_IMAGES_MAX,
  wallpaperImageResponseSchema,
  wallpaperImagesResponseSchema,
} from '@zuvo/protocol';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { EXE } from '../../../test/media-helpers.ts';
import { multipartFile } from '../../../test/user-helpers.ts';
import { appearanceModels, oidOf } from '../../appearance/appearance.service.ts';
import { WALLPAPER_MAX_SIDE } from '../../appearance/wallpapers.service.ts';
import { chatModels } from '../../chats/chats.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await built.cleanup();
});

const picture = (width = 400, height = 300) =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 120, b: 200 } } })
    .jpeg()
    .toBuffer();

function upload(who: Person | null, bytes: Buffer, filename = 'beach.jpg') {
  const { payload, contentType } = multipartFile(bytes, filename);
  return app().inject({
    method: 'POST',
    url: '/v1/me/wallpapers',
    headers: { ...headers(who?.cookie), 'content-type': contentType },
    payload,
  });
}
const uploaded = async (who: Person, bytes?: Buffer) =>
  wallpaperImageResponseSchema.parse((await upload(who, bytes ?? (await picture()))).json()).image;

describe('wallpaper pictures', () => {
  it('are re-encoded to WebP, at most 2560 px, under a random key', async () => {
    const asha = await person();
    const image = await uploaded(asha, await picture(4000, 1000));
    expect(image.url).toBe(`/v1/me/wallpapers/${image.id}`);
    const served = await call(asha, 'GET', image.url);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toContain('private');
    const meta = await sharp(served.rawPayload).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: WALLPAPER_MAX_SIDE, height: 640 });
    const doc = await appearanceModels(app()).WallpaperImage.findById(image.id).lean();
    expect(doc?.key).not.toContain('beach');
  });

  it('take pictures over the 5 MB avatar limit, up to 10 MB', async () => {
    const asha = await person();
    const big = await sharp({
      create: {
        width: 1700,
        height: 1300,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(big.length).toBeGreaterThan(5 * 1024 * 1024);
    expect(big.length).toBeLessThan(10 * 1024 * 1024);
    expect((await upload(asha, big, 'big.png')).statusCode).toBe(200);
    const tooBig = Buffer.concat([await picture(), Buffer.alloc(10 * 1024 * 1024)]);
    expect((await upload(asha, tooBig)).statusCode).toBe(413);
  });

  it('refuse a non-image disguised as .jpg, and a missing file', async () => {
    const asha = await person();
    const fake = await upload(asha, EXE, 'holiday.jpg');
    expect(fake.statusCode).toBe(415);
    expect(fake.json().code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100)]);
    expect((await upload(asha, broken)).statusCode).toBe(415);
    const empty = await app().inject({
      method: 'POST',
      url: '/v1/me/wallpapers',
      headers: headers(asha.cookie),
    });
    expect(empty.statusCode).toBeGreaterThanOrEqual(400);
  });

  it(`stop at ${WALLPAPER_IMAGES_MAX} per person`, async () => {
    const asha = await person();
    const bytes = await picture(50, 50);
    for (let i = 0; i < WALLPAPER_IMAGES_MAX; i++) await uploaded(asha, bytes);
    const over = await upload(asha, bytes);
    expect(over.statusCode).toBe(409);
    expect(over.json().code).toBe('CONFLICT');
    const list = await call(asha, 'GET', '/v1/me/wallpapers');
    expect(wallpaperImagesResponseSchema.parse(list.json()).images).toHaveLength(10);
  });

  it('refuse uploads when the disk is too full', async () => {
    const asha = await person();
    vi.spyOn(app().storage, 'space').mockResolvedValue({ total: 100, free: 5 });
    const full = await upload(asha, await picture());
    expect(full.statusCode).toBe(507);
    expect(full.json().code).toBe('STORAGE_FULL');
  });

  it("are private: another person's id is not found, to see or to delete", async () => {
    const [asha, bharat] = [await person(), await person()];
    const image = await uploaded(asha);
    expect((await call(bharat, 'GET', image.url)).statusCode).toBe(404);
    expect((await call(bharat, 'DELETE', image.url)).statusCode).toBe(404);
    const bharatList = await call(bharat, 'GET', '/v1/me/wallpapers');
    expect(bharatList.json().images).toEqual([]);
    expect((await call(asha, 'GET', image.url)).statusCode).toBe(200);
    expect((await call(asha, 'GET', '/v1/me/wallpapers/nope')).statusCode).toBe(400);
  });

  it('a missing file is "not available", never a crash', async () => {
    const asha = await person();
    const image = await uploaded(asha);
    const doc = await appearanceModels(app()).WallpaperImage.findById(image.id).lean();
    await app().storage.delete(doc?.key ?? '');
    expect((await call(asha, 'GET', image.url)).statusCode).toBe(404);
  });

  it('deleting one resets my default and every chat that used it', async () => {
    const asha = await person();
    const [first, second] = [await group(asha), await group(asha)];
    const image = await uploaded(asha);
    const other = await uploaded(asha);
    const wallpaper = { kind: 'image', id: image.id };
    await call(asha, 'PATCH', '/v1/me/appearance', { wallpaper });
    await call(asha, 'PUT', `/v1/chats/${first}/wallpaper`, { wallpaper });
    await call(asha, 'PUT', `/v1/chats/${second}/wallpaper`, {
      wallpaper: { kind: 'image', id: other.id },
    });
    const removed = await call(asha, 'DELETE', image.url);
    expect(removed.statusCode).toBe(200);
    expect(wallpaperImagesResponseSchema.parse(removed.json()).images).toEqual([other]);
    const appearance = (await call(asha, 'GET', '/v1/me/appearance')).json().appearance;
    expect(appearance.wallpaper).toEqual({ kind: 'pattern', id: 'dots' });
    expect((await call(asha, 'GET', `/v1/chats/${first}`)).json().chat.wallpaper).toBeNull();
    expect((await call(asha, 'GET', `/v1/chats/${second}`)).json().chat.wallpaper).toEqual({
      kind: 'image',
      id: other.id,
    });
    expect((await call(asha, 'GET', image.url)).statusCode).toBe(404);
  });

  it('need a session', async () => {
    const id = '0123456789abcdef01234567';
    expect((await upload(null, await picture())).statusCode).toBe(401);
    expect((await call(null, 'GET', '/v1/me/wallpapers')).statusCode).toBe(401);
    expect((await call(null, 'GET', `/v1/me/wallpapers/${id}`)).statusCode).toBe(401);
    expect((await call(null, 'DELETE', `/v1/me/wallpapers/${id}`)).statusCode).toBe(401);
  });

  it('queries use an index', async () => {
    const asha = await person();
    const me = oidOf(asha.id);
    const { WallpaperImage } = appearanceModels(app());
    await expectIndexedQuery(WallpaperImage.find({ userId: me }).sort({ createdAt: 1 }));
    await expectIndexedQuery(WallpaperImage.find({ _id: me, userId: me }));
    await expectIndexedQuery(
      chatModels(app()).ChatMember.find({
        userId: me,
        'wallpaper.kind': 'image',
        'wallpaper.id': asha.id,
      }),
    );
  });
});
