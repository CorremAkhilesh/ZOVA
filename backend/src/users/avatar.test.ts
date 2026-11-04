import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { jpegWithExif } from '../../test/user-helpers.ts';
import { detectImageType, processAvatar } from './avatar.ts';

const png = () =>
  sharp({ create: { width: 300, height: 900, channels: 4, background: '#14B8A6' } })
    .png()
    .toBuffer();

describe('detectImageType (magic bytes, never the extension)', () => {
  it('recognises JPEG, PNG, WebP and HEIC signatures', async () => {
    expect(detectImageType(await jpegWithExif())).toBe('jpeg');
    expect(detectImageType(await png())).toBe('png');
    const webp = await sharp(await png())
      .webp()
      .toBuffer();
    expect(detectImageType(webp)).toBe('webp');
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheic', 'ascii'),
      Buffer.alloc(16),
    ]);
    expect(detectImageType(heic)).toBe('heic');
  });

  it('rejects anything else, including a renamed text file or a GIF', () => {
    expect(detectImageType(Buffer.from('hello, this is not a picture'))).toBeNull();
    expect(detectImageType(Buffer.from('GIF89a........', 'ascii'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('processAvatar', () => {
  it('makes 512 px and 128 px square WebP files without EXIF', async () => {
    const source = await jpegWithExif();
    expect((await sharp(source).metadata()).exif).toBeDefined();

    const { large, small } = await processAvatar(source);
    const [largeMeta, smallMeta] = await Promise.all([
      sharp(large).metadata(),
      sharp(small).metadata(),
    ]);
    expect(largeMeta).toMatchObject({ format: 'webp', width: 512, height: 512 });
    expect(smallMeta).toMatchObject({ format: 'webp', width: 128, height: 128 });
    expect(largeMeta.exif).toBeUndefined();
    expect(smallMeta.exif).toBeUndefined();
    expect(large.includes(Buffer.from('Secret Model 9'))).toBe(false);
  });

  it('center-crops non-square images', async () => {
    const { large } = await processAvatar(await png());
    expect(await sharp(large).metadata()).toMatchObject({ width: 512, height: 512 });
  });

  it('answers 415 for unsupported or undecodable files', async () => {
    await expect(processAvatar(Buffer.from('not an image at all'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
    const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    await expect(processAvatar(fakeJpeg)).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });
});
