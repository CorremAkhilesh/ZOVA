import { createHash } from 'node:crypto';

/** http(s) URLs and bare www. addresses, as people type them. Only for finding, never for fetching. */
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/giu;
const TRAILING = /[.,!?:;'"»”’)\]}]+$/u;

/** The links in a message, as absolute http(s) URLs, trailing punctuation trimmed. */
export function linksIn(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(LINK)].flatMap((match) => {
    let raw = match[0];
    // Keep a closing parenthesis that has its opening one inside the link (Wikipedia style).
    while (TRAILING.test(raw)) {
      const last = raw.at(-1);
      if (last === ')' && raw.split('(').length > raw.split(')').length - 1) break;
      raw = raw.slice(0, -1);
    }
    const url = /^www\./i.test(raw) ? `https://${raw}` : raw;
    const normalized = normalizeUrl(url);
    return normalized ? [normalized] : [];
  });
}

export const hasLink = (text: string | null | undefined) => linksIn(text).length > 0;

/** One spelling per page: http(s) only, no fragment, the URL parser's canonical form. */
export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** The cache key of a normalised URL. */
export const linkKey = (normalized: string) =>
  createHash('sha256').update(normalized).digest('hex');
