import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchPreviewImage, processPreviewImage, sniffImageFormat } from './fetch-image.ts';
import { localOptions, startServer, type TestServer } from './test-server.ts';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function image(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 79, g: 70, b: 229 } } });
}

async function serve(body: Buffer, contentType: string) {
  server = await startServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(body);
  });
  return server;
}

describe('fetchPreviewImage', () => {
  it('resizes a large PNG to fit 600 px and returns WebP', async () => {
    const png = await image(1600, 900).png().toBuffer();
    const s = await serve(png, 'image/png');
    const result = await fetchPreviewImage(s.url('/a.png'), localOptions());
    if (!result.ok) throw new Error(result.message);
    expect(result).toMatchObject({ width: 600, height: 338, contentType: 'image/webp' });
    const meta = await sharp(result.bytes).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 600, height: 338 });
    expect(s.lastHeaders()?.accept).toContain('image/webp');
  });

  it('strips metadata and never enlarges a small JPEG', async () => {
    const jpeg = await image(120, 80)
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-gps-owner' } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const s = await serve(jpeg, 'application/octet-stream');
    const result = await fetchPreviewImage(s.url('/a.jpg'), localOptions());
    if (!result.ok) throw new Error(result.message);
    expect(result).toMatchObject({ width: 120, height: 80 });
    const meta = await sharp(result.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(result.bytes.includes('secret-gps-owner')).toBe(false);
  });

  it('accepts WebP and GIF (first frame) as well', async () => {
    for (const [bytes, type] of [
      [await image(700, 700).webp().toBuffer(), 'image/webp'],
      [await image(50, 40).gif().toBuffer(), 'image/gif'],
    ] as const) {
      const s = await serve(bytes, type);
      const result = await fetchPreviewImage(s.url('/i'), localOptions());
      expect(result).toMatchObject({ ok: true, contentType: 'image/webp' });
      await s.close();
      server = undefined;
    }
  });

  it('rejects text served as image/png', async () => {
    const s = await serve(Buffer.from('<html>not an image</html>'), 'image/png');
    const result = await fetchPreviewImage(s.url('/fake.png'), localOptions());
    expect(result).toMatchObject({ ok: false, reason: 'not_image' });
  });

  it('rejects an SVG even though sharp could render it', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    const s = await serve(svg, 'image/svg+xml');
    expect(await fetchPreviewImage(s.url('/i.svg'), localOptions())).toMatchObject({
      reason: 'not_image',
    });
  });

  it('rejects a download over 5 MB', async () => {
    const s = await serve(Buffer.alloc(6 * 1024 * 1024, 0xff), 'image/jpeg');
    expect(await fetchPreviewImage(s.url('/huge.jpg'), localOptions())).toMatchObject({
      ok: false,
      reason: 'too_large',
    });
  });

  it('applies the SSRF rules (default policy blocks loopback)', async () => {
    const s = await serve(await image(10, 10).png().toBuffer(), 'image/png');
    expect(await fetchPreviewImage(`http://127.0.0.1:${s.port}/a.png`)).toMatchObject({
      reason: 'blocked',
    });
    expect(s.connections()).toBe(0);
    expect(await fetchPreviewImage('file:///etc/passwd')).toMatchObject({ reason: 'invalid_url' });
  });
});

describe('processPreviewImage', () => {
  it('rejects images with too many pixels (decompression bomb)', async () => {
    // 8000 × 8000 = 64 MP, over the 40 MP limit, yet a tiny PNG.
    const bomb = await image(8000, 8000).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    expect(await processPreviewImage(bomb)).toMatchObject({ ok: false, reason: 'too_large' });
  });

  it('rejects truncated image data', async () => {
    const png = await image(200, 200).png().toBuffer();
    expect(await processPreviewImage(png.subarray(0, 60))).toMatchObject({ reason: 'not_image' });
  });

  it('rejects bytes whose decoded format differs from the signature', async () => {
    // GIF signature followed by PNG data: sharp decodes it as something other than GIF.
    const png = await image(10, 10).png().toBuffer();
    const result = await processPreviewImage(Buffer.concat([Buffer.from('GIF89a'), png]));
    expect(result).toMatchObject({ ok: false, reason: 'not_image' });
  });

  it('sniffs only allowed formats', () => {
    const avif = Buffer.from('\0\0\0\x1cftypavif\0\0\0\0', 'latin1');
    expect(sniffImageFormat(avif)).toBe('avif');
    expect(sniffImageFormat(Buffer.from('\0\0\0\x18ftypheic', 'latin1'))).toBeNull();
    expect(sniffImageFormat(Buffer.from('GIF87a......'))).toBe('gif');
    expect(sniffImageFormat(Buffer.from('BM......'))).toBeNull();
    expect(sniffImageFormat(Buffer.alloc(0))).toBeNull();
  });
});
