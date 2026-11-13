/** How many leading bytes are searched for a `<meta charset>` declaration (as browsers do). */
const SNIFF_BYTES = 1024;

function supported(label: string | null | undefined): string | null {
  if (!label) return null;
  try {
    return new TextDecoder(label.trim()).encoding;
  } catch {
    return null;
  }
}

/** Finds `<meta charset=…>` or `<meta http-equiv="Content-Type" content="…; charset=…">`. */
export function sniffMetaCharset(body: Uint8Array): string | null {
  const head = Buffer.from(body.buffer, body.byteOffset, Math.min(body.length, SNIFF_BYTES))
    .toString('latin1')
    .toLowerCase();
  const direct = /<meta[^>]*?\bcharset\s*=\s*["']?\s*([a-z0-9_.:-]+)/.exec(head);
  return direct?.[1] ?? null;
}

function bomEncoding(body: Uint8Array): string | null {
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return 'utf-8';
  if (body[0] === 0xfe && body[1] === 0xff) return 'utf-16be';
  if (body[0] === 0xff && body[1] === 0xfe) return 'utf-16le';
  return null;
}

/**
 * Decodes an HTML body: byte-order mark first, then the Content-Type charset, then a
 * `<meta charset>` in the first 1 KB, else UTF-8. Unknown labels fall through to the next
 * source. Invalid byte sequences become U+FFFD (never throws).
 */
export function decodeHtml(body: Uint8Array, headerCharset: string | null): string {
  const encoding =
    bomEncoding(body) ?? supported(headerCharset) ?? supported(sniffMetaCharset(body)) ?? 'utf-8';
  return new TextDecoder(encoding).decode(body);
}
