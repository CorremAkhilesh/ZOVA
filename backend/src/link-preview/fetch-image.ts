import sharp, { type Metadata } from 'sharp';
import { safeFetch } from './safe-fetch.ts';
import {
  failure,
  type ImageFailure,
  type PreviewImageResult,
  type SafeFetchOptions,
} from './types.ts';

export const PREVIEW_IMAGE_LIMITS = {
  /** Download cap. */
  maxBytes: 5 * 1024 * 1024,
  /** Decompression-bomb guard: width × height. */
  maxPixels: 40_000_000,
  /** Output fits inside this box (never enlarged). */
  maxSide: 600,
  webpQuality: 80,
} as const;

export type PreviewImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';

const AVIF_BRANDS = new Set(['avif', 'avis']);

/** Identifies an allowed image by its first bytes (never by Content-Type or file name). */
export function sniffImageFormat(bytes: Uint8Array): PreviewImageFormat | null {
  const ascii = (start: number, end: number) =>
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString('latin1', start, end);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length >= 8 && ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'gif';
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp' && AVIF_BRANDS.has(ascii(8, 12))) return 'avif';
  return null;
}

/** sharp reports AVIF as `heif` with AV1 compression. */
function formatMatches(sniffed: PreviewImageFormat, metadata: Metadata): boolean {
  if (sniffed === 'avif') return metadata.format === 'heif' && metadata.compression === 'av1';
  return metadata.format === sniffed;
}

/**
 * Decodes, checks and re-encodes a downloaded preview image: allowed formats only (checked by
 * magic bytes and by sharp's decoder), at most 40 MP, first frame only, auto-rotated, resized
 * to fit 600 × 600 without enlarging, all metadata stripped, WebP output.
 */
export async function processPreviewImage(input: Buffer): Promise<PreviewImageResult> {
  const sniffed = sniffImageFormat(input);
  if (!sniffed) return failure('not_image', 'Not a JPEG, PNG, WebP, GIF or AVIF image');
  const decoderOptions = {
    failOn: 'error',
    limitInputPixels: PREVIEW_IMAGE_LIMITS.maxPixels,
    pages: 1,
  } as const;
  try {
    // Reading the header decodes no pixels, so the size is checked here with a clear reason;
    // the decode below still enforces limitInputPixels.
    const metadata = await sharp(input, { ...decoderOptions, limitInputPixels: false }).metadata();
    if (!formatMatches(sniffed, metadata)) {
      return failure('not_image', 'Image format does not match its content');
    }
    const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
    if (pixels === 0 || pixels > PREVIEW_IMAGE_LIMITS.maxPixels) {
      return failure('too_large', `Image has ${pixels} pixels`);
    }
    const { data, info } = await sharp(input, decoderOptions)
      .rotate()
      .resize(PREVIEW_IMAGE_LIMITS.maxSide, PREVIEW_IMAGE_LIMITS.maxSide, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: PREVIEW_IMAGE_LIMITS.webpQuality })
      .toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      bytes: data,
      width: info.width,
      height: info.height,
      contentType: 'image/webp',
    };
  } catch {
    return failure('not_image', 'The image could not be decoded');
  }
}

/**
 * Downloads an og:image URL with every `safeFetch` SSRF rule (5 MB cap by default) and
 * returns it as a small WebP. The Content-Type header is ignored: the bytes decide.
 */
export async function fetchPreviewImage(
  imageUrl: string,
  options: SafeFetchOptions = {},
): Promise<PreviewImageResult> {
  const response = await safeFetch(imageUrl, {
    maxBytes: PREVIEW_IMAGE_LIMITS.maxBytes,
    ...options,
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1',
  });
  if (!response.ok) {
    const { reason } = response;
    // No acceptContentType is passed, so 'content_type' cannot happen; map it defensively.
    const mapped: ImageFailure['reason'] = reason === 'content_type' ? 'not_image' : reason;
    return failure(mapped, response.message, response.status);
  }
  return processPreviewImage(response.body);
}
