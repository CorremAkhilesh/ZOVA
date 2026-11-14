import type { FastifyReply } from 'fastify';
import type { MediaDoc } from '../db/chat-models.ts';

const IMMUTABLE = 'private, max-age=31536000, immutable';

/** A correct `filename*`, plus a plain fallback with nothing that could break out of the header. */
function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const plain = name.replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'file';
  return `${type}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Never sniffed, documents never shown inline, and cached for good: content never changes. */
export function setFileHeaders(
  reply: FastifyReply,
  doc: MediaDoc,
  thumbnail: boolean,
  download: boolean,
) {
  const inline = thumbnail || (doc.kind !== 'document' && !download);
  reply
    .header('Content-Type', thumbnail ? 'image/webp' : doc.mime)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', doc.name))
    .header('Content-Security-Policy', "default-src 'none'; sandbox; frame-ancestors 'none'")
    .header('Cache-Control', IMMUTABLE)
    .header('Accept-Ranges', 'bytes');
  if (doc.sha256 && !thumbnail) reply.header('ETag', `"${doc.sha256}"`);
}

/** `bytes=a-b`, `bytes=a-` and `bytes=-n`. Anything else is answered with the whole file. */
export function parseRange(header: string | undefined, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const last = Math.min(Number(match[2]), size);
    return { start: size - last, end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  return { start, end };
}
