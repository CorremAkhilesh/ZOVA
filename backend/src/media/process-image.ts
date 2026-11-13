import sharp from 'sharp';
import { AppError } from '../lib/errors.ts';

export const FULL_MAX_PX = 2560;
export const THUMBNAIL_MAX_PX = 320;
const PLACEHOLDER_PX = 16;
/** A guard against decompression bombs: a small file can decode to a huge picture. */
const MAX_INPUT_PIXELS = 100_000_000;

const pipeline = (input: string | Uint8Array) =>
  sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS });

const within = (size: number) => ({
  width: size,
  height: size,
  fit: 'inside' as const,
  withoutEnlargement: true,
});

async function toPlaceholder(input: string | Uint8Array): Promise<string> {
  const tiny = await pipeline(input)
    .rotate()
    .resize(within(PLACEHOLDER_PX))
    .webp({ quality: 30 })
    .toBuffer();
  return `data:image/webp;base64,${tiny.toString('base64')}`;
}

/**
 * Auto-rotates, then re-encodes as WebP, which drops EXIF and GPS: sharp keeps no metadata unless
 * asked to. WebP keeps PNG transparency.
 */
export async function processImage(path: string) {
  try {
    const full = await pipeline(path)
      .rotate()
      .resize(within(FULL_MAX_PX))
      .webp({ quality: 82 })
      .toBuffer({
        resolveWithObject: true,
      });
    const thumbnail = await pipeline(path)
      .rotate()
      .resize(within(THUMBNAIL_MAX_PX))
      .webp({ quality: 75 })
      .toBuffer();
    return {
      full: full.data,
      thumbnail,
      placeholder: await toPlaceholder(path),
      width: full.info.width,
      height: full.info.height,
    };
  } catch {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'This image could not be read.');
  }
}

/** A video's poster comes from the browser: it must really be a picture before we keep it. */
export async function processPoster(bytes: Uint8Array) {
  try {
    const thumbnail = await pipeline(bytes)
      .rotate()
      .resize(within(THUMBNAIL_MAX_PX))
      .webp({ quality: 75 })
      .toBuffer();
    return { thumbnail, placeholder: await toPlaceholder(bytes) };
  } catch {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'The video poster is not a valid image.');
  }
}
