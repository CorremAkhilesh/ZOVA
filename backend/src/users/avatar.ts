import sharp from 'sharp';
import { AppError } from '../lib/errors.ts';

export type ImageType = 'jpeg' | 'png' | 'webp' | 'heic';

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** Identifies the image by its first bytes (magic numbers) — never by name or declared type. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  if (bytes.length >= 8 && ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(8, 12))) return 'heic';
  return null;
}

export const AVATAR_SIZES = { large: 512, small: 128 } as const;

/**
 * Auto-rotates from EXIF, then re-encodes without any metadata (EXIF/GPS removed — sharp drops
 * metadata unless asked to keep it), center-crops to a square and produces 512 px and 128 px WebP.
 */
export async function processAvatar(input: Uint8Array): Promise<{ large: Buffer; small: Buffer }> {
  const type = detectImageType(input);
  if (!type) throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Use a JPEG, PNG, WebP or HEIC photo.');
  try {
    const oriented = await sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate()
      .toBuffer();
    const render = (size: number) =>
      sharp(oriented)
        .resize(size, size, { fit: 'cover', position: 'centre' })
        .webp({ quality: 85 })
        .toBuffer();
    const [large, small] = await Promise.all([
      render(AVATAR_SIZES.large),
      render(AVATAR_SIZES.small),
    ]);
    return { large, small };
  } catch {
    // Standard sharp builds cannot decode HEIC (HEVC); the app converts photos before upload.
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      type === 'heic'
        ? 'This HEIC photo could not be read. Choose the photo again from the app, or use JPEG.'
        : 'This image could not be read. Try another photo.',
    );
  }
}
