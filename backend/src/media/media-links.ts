import { createHmac, timingSafeEqual } from 'node:crypto';
import { MEDIA_LINK_TTL_SECONDS } from '@zuvo/protocol';
import { AppError } from '../lib/errors.ts';

/**
 * What a signed link is for. `full` and `thumb` come from GET /v1/media/:id/link; `once` only from
 * opening a view-once message, and is the one kind of link that serves a view-once file.
 */
export type LinkPurpose = 'full' | 'thumb' | 'once';

export function signMediaLink(
  secret: string,
  id: string,
  purpose: LinkPurpose,
  download: boolean,
  expires: number,
): string {
  return createHmac('sha256', `media-link:${secret}`)
    .update(`${id}.${purpose}.${download ? 1 : 0}.${expires}`)
    .digest('base64url');
}

export function validMediaLink(
  secret: string,
  link: { id: string; purpose: LinkPurpose; download: boolean; expires: number; sig: string },
): boolean {
  const expected = Buffer.from(
    signMediaLink(secret, link.id, link.purpose, link.download, link.expires),
  );
  const given = Buffer.from(link.sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * The query of a signed content request: a valid, unexpired signature for exactly this file, variant
 * and purpose. A `once` link serves the full file only. Says whether it is a view-once link.
 */
export function assertSignedLink(
  secret: string,
  id: string,
  query: {
    variant: 'full' | 'thumb';
    download?: '1' | undefined;
    exp?: number | undefined;
    sig: string;
    once?: '1' | undefined;
  },
): { once: boolean } {
  const once = query.once === '1';
  const expires = query.exp ?? 0;
  const valid =
    (!once || query.variant === 'full') &&
    validMediaLink(secret, {
      id,
      purpose: once ? 'once' : query.variant,
      download: query.download === '1',
      expires,
      sig: query.sig,
    });
  if (!valid) throw new AppError('MEDIA_LINK_INVALID', 'This link is not valid.');
  if (expires * 1000 < Date.now()) {
    throw new AppError('MEDIA_LINK_INVALID', 'This link has expired.');
  }
  return { once };
}

/** A link to the whole file, valid for MEDIA_LINK_TTL_SECONDS. */
export function mediaLink(
  secret: string,
  id: string,
  options: { download?: boolean; once?: boolean } = {},
  now = Date.now(),
) {
  const download = options.download === true;
  const expires = Math.floor(now / 1000) + MEDIA_LINK_TTL_SECONDS;
  const search = new URLSearchParams({
    exp: String(expires),
    sig: signMediaLink(secret, id, options.once ? 'once' : 'full', download, expires),
    ...(download ? { download: '1' } : {}),
    ...(options.once ? { once: '1' } : {}),
  });
  return {
    url: `/v1/media/${id}/content?${search}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}
