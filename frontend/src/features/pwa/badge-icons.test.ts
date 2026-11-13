import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_BADGE, NOTIFICATION_ICON } from '@/sw/push/notification';
import { BADGE_ICONS, ICONS_DIR } from '../../../pwa/assets';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public');
const publicFile = (path: string) => readFileSync(resolve(publicDir, path));

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** The compressed image data: every IDAT chunk, inflated. */
function imageData(png: Buffer): Buffer {
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') {
      idat.push(png.subarray(at + 8, at + 8 + length));
    }
    at += length + 12;
  }
  return inflateSync(Buffer.concat(idat));
}

/** Undoes one scanline's filter (PNG spec, section 9), given the row above (zeros for the first). */
function unfilter(filter: number, line: Uint8Array, above: Uint8Array): Uint8Array {
  const out = new Uint8Array(line.length);
  for (let x = 0; x < line.length; x++) {
    const left = x >= 4 ? (out[x - 4] ?? 0) : 0;
    const up = above[x] ?? 0;
    const upLeft = x >= 4 ? (above[x - 4] ?? 0) : 0;
    const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter] ?? 0;
    out[x] = ((line[x] ?? 0) + predicted) & 0xff;
  }
  return out;
}

/** A minimal decoder for 8-bit RGBA, non-interlaced PNGs (what the icons script writes). */
function decodeRgba(png: Buffer) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24]).toBe(8); // bit depth
  expect(png[25]).toBe(6); // colour type: RGBA
  const raw = imageData(png);
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  let above: Uint8Array = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    above = unfilter(raw[start] ?? 0, raw.subarray(start + 1, start + 1 + stride), above);
    pixels.set(above, y * stride);
  }
  return { width, height, pixels };
}

/** Pixels fully clear and fully opaque; fails on any visible pixel that is not white. */
function countWhiteGlyph(pixels: Uint8Array) {
  let opaque = 0;
  let clear = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] ?? 0;
    if (alpha === 0) clear++;
    if (alpha === 255) opaque++;
    // Android draws only the alpha channel: every visible pixel is white.
    if (alpha > 0) expect(Math.min(...pixels.subarray(i, i + 3))).toBeGreaterThan(240);
  }
  return { opaque, clear };
}

describe('notification badge icons', () => {
  it('uses a badge, not the colour icon, for the notification badge', () => {
    expect(NOTIFICATION_BADGE).not.toBe(NOTIFICATION_ICON);
    expect(BADGE_ICONS.map((b) => `/${ICONS_DIR}/${b.file}`)).toContain(NOTIFICATION_BADGE);
  });

  it.each(BADGE_ICONS)('$file is a white glyph on transparency', ({ file, size }) => {
    const { width, height, pixels } = decodeRgba(publicFile(`${ICONS_DIR}/${file}`));
    expect([width, height]).toEqual([size, size]);
    const { opaque, clear } = countWhiteGlyph(pixels);
    expect(opaque).toBeGreaterThan(size * 2);
    expect(clear).toBeGreaterThan((size * size) / 2);
  });
});
