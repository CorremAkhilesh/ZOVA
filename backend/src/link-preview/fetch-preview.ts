import { decodeHtml } from './charset.ts';
import { decodeEntities } from './entities.ts';
import { extractPageMeta, type PageMeta } from './html-meta.ts';
import { safeFetch } from './safe-fetch.ts';
import { MAX_URL_LENGTH } from './target.ts';
import {
  failure,
  type LinkPreview,
  type LinkPreviewResult,
  type PreviewFailure,
  type SafeFetchOptions,
} from './types.ts';

export const PREVIEW_LIMITS = { title: 200, description: 300, siteName: 100 } as const;

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/** C0/C1 controls, zero-width and bidi override/isolate characters, line/paragraph separators. */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

function withoutInvisible(text: string): string {
  return Array.from(text, (char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return INVISIBLE_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high)
      ? ' '
      : char;
  }).join('');
}

/**
 * Turns a raw attribute or title value into plain text: entities decoded once, anything that
 * looks like a tag removed, control characters dropped, whitespace collapsed, length capped
 * (by code points, so emoji are never cut in half). Empty → null.
 */
export function cleanText(raw: string | undefined | null, maxLength: number): string | null {
  if (raw === undefined || raw === null) return null;
  const text = withoutInvisible(decodeEntities(raw))
    .replace(/<\/?[a-zA-Z!][^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  const codePoints = Array.from(text);
  if (codePoints.length <= maxLength) return text;
  return `${codePoints
    .slice(0, maxLength - 1)
    .join('')
    .trimEnd()}…`;
}

/** Resolves a (possibly relative) URL against the page; only absolute http(s) URLs survive. */
export function absoluteHttpUrl(raw: string | undefined, base: string): string | null {
  if (!raw) return null;
  const value = decodeEntities(raw).trim();
  if (value === '') return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '') return null;
    return url.href.length <= MAX_URL_LENGTH ? url.href : null;
  } catch {
    return null;
  }
}

function first(meta: Map<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = meta.get(key);
    if (value !== undefined && value.trim() !== '') return value;
  }
  return undefined;
}

function hostnameLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

/** Builds the preview from parsed metadata. Exported for unit tests. */
export function buildPreview(page: PageMeta, finalUrl: string): LinkPreview | PreviewFailure {
  const { meta } = page;
  const title =
    cleanText(first(meta, ['og:title', 'twitter:title']), PREVIEW_LIMITS.title) ??
    cleanText(page.title, PREVIEW_LIMITS.title);
  const description = cleanText(
    first(meta, ['og:description', 'twitter:description', 'description']),
    PREVIEW_LIMITS.description,
  );
  if (title === null && description === null) {
    return failure('empty', 'The page has no title or description');
  }
  const siteName =
    cleanText(first(meta, ['og:site_name', 'application-name']), PREVIEW_LIMITS.siteName) ??
    cleanText(hostnameLabel(finalUrl), PREVIEW_LIMITS.siteName) ??
    '';
  const image = first(meta, [
    'og:image:secure_url',
    'og:image',
    'og:image:url',
    'twitter:image',
    'twitter:image:src',
  ]);
  return {
    ok: true,
    url: finalUrl,
    title,
    description,
    siteName,
    imageUrl: absoluteHttpUrl(image, finalUrl),
    canonicalUrl: absoluteHttpUrl(first(meta, ['og:url']), finalUrl),
  };
}

/**
 * Fetches an untrusted URL (all `safeFetch` SSRF rules apply) and extracts Open Graph /
 * Twitter card data. Output is plain text only — never HTML.
 */
export async function fetchPreview(
  url: string,
  options: SafeFetchOptions = {},
): Promise<LinkPreviewResult> {
  const response = await safeFetch(url, {
    ...options,
    acceptContentType: (mimeType) => mimeType !== null && HTML_TYPES.has(mimeType),
  });
  if (!response.ok) {
    const { reason } = response;
    if (reason === 'content_type') return failure('not_html', response.message);
    return failure(reason, response.message, response.status);
  }
  const html = decodeHtml(response.body, response.charset);
  return buildPreview(extractPageMeta(html), response.url);
}
