import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processPoster } from './process-image.ts';

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>',
);

const picture = (format: 'jpeg' | 'png' | 'webp' | 'tiff') =>
  sharp({ create: { width: 32, height: 24, channels: 3, background: '#4f46e5' } })
    .toFormat(format)
    .toBuffer();

describe('processPoster', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'accepts a %s frame and re-encodes it',
    async (format) => {
      const { thumbnail, placeholder } = await processPoster(await picture(format));
      expect((await sharp(thumbnail).metadata()).format).toBe('webp');
      expect(placeholder).toMatch(/^data:image\/webp;base64,/);
    },
  );

  // The poster comes from the browser (canvas → JPEG), but anyone can call the API: like every other
  // picture it must pass the magic-byte allow-list before a decoder sees it, not "whatever sharp reads".
  it.each([
    ['SVG', async () => SVG],
    ['TIFF', () => picture('tiff')],
  ])('refuses %s, which sharp could decode', async (_name, bytes) => {
    await expect(processPoster(await bytes())).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });
});
