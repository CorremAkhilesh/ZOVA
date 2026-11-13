import { Readable } from 'node:stream';
import type { LinkPreview } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { isDuplicateKey } from '../chats/chats.service.ts';
import { type LinkPreviewDoc, registerLinkPreviewModels } from '../db/link-preview-models.ts';
import { AppError } from '../lib/errors.ts';
import { fetchPreview, fetchPreviewImage } from '../link-preview/index.ts';
import type { SafeFetchOptions } from '../link-preview/types.ts';
import { linkKey, linksIn, normalizeUrl } from './link-text.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** How previews are fetched. Tests and the E2E server point it at a local site. */
    linkPreviewOptions: SafeFetchOptions;
  }
}

export const PREVIEW_CACHE_MS = 24 * 3_600_000;
export const FAILURE_CACHE_MS = 3_600_000;
/** Per person: enough for typing several links, not for crawling. */
export const PREVIEW_LIMIT = { max: 30, windowSeconds: 60 };

const models = (app: FastifyInstance) => registerLinkPreviewModels(app.mongo);
const unavailable = () => new AppError('PREVIEW_UNAVAILABLE', 'There is no preview for this link.');

async function assertPreviewLimit(app: FastifyInstance, userId: string) {
  const key = `zuvo:rate:preview:${userId}`;
  if ((await app.counterStore.increment(key, PREVIEW_LIMIT.windowSeconds)) > PREVIEW_LIMIT.max) {
    throw new AppError('RATE_LIMITED', 'Too many link previews. Try again in a minute.', {
      retryAfterSeconds: Math.max(1, await app.counterStore.ttl(key)),
    });
  }
}

/** Downloads, resizes and keeps the picture. No picture is better than failing the preview. */
async function storeImage(app: FastifyInstance, imageUrl: string) {
  const image = await fetchPreviewImage(imageUrl, app.linkPreviewOptions);
  if (!image.ok) return null;
  const { key } = await app.storage.save(Readable.from([image.bytes]));
  const doc = await models(app).LinkPreviewImage.create({
    storageKey: key,
    width: image.width,
    height: image.height,
  });
  return { id: doc._id.toString(), width: image.width, height: image.height };
}

async function fetchFresh(app: FastifyInstance, url: string) {
  const page = await fetchPreview(url, app.linkPreviewOptions);
  if (!page.ok) {
    app.log.info({ reason: page.reason }, 'no link preview');
    return { preview: null, failure: page.reason };
  }
  const preview: LinkPreview = {
    url: page.url,
    title: page.title,
    description: page.description,
    siteName: page.siteName,
    image: page.imageUrl ? await storeImage(app, page.imageUrl) : null,
  };
  return { preview, failure: null };
}

/** A preview for the sender: from the cache when someone looked it up lately, else fetched now. */
export async function lookupPreview(app: FastifyInstance, userId: string, raw: string) {
  await assertPreviewLimit(app, userId);
  const url = normalizeUrl(raw);
  if (!url) throw unavailable();
  const key = linkKey(url);
  const { LinkPreview } = models(app);
  let doc = (await LinkPreview.findOne({
    key,
    expiresAt: { $gt: new Date() },
  }).lean()) as LinkPreviewDoc | null;
  if (!doc) {
    const fresh = await fetchFresh(app, url);
    const life = fresh.preview ? PREVIEW_CACHE_MS : FAILURE_CACHE_MS;
    const update = { $set: { requestUrl: url, ...fresh, expiresAt: new Date(Date.now() + life) } };
    try {
      doc = (await LinkPreview.findOneAndUpdate({ key }, update, {
        upsert: true,
        returnDocument: 'after',
      }).lean()) as LinkPreviewDoc | null;
    } catch (error) {
      // Someone else stored it a moment ago.
      if (!isDuplicateKey(error)) throw error;
      doc = (await LinkPreview.findOne({ key }).lean()) as LinkPreviewDoc | null;
    }
  }
  if (!doc?.preview) throw unavailable();
  return { id: doc._id.toString(), preview: doc.preview };
}

/**
 * The preview a message may carry: only one looked up for a link that is in its text. Anything
 * else (unknown, expired, or for another link) is simply left off; the message still goes.
 */
export async function previewForMessage(
  app: FastifyInstance,
  previewId: string | undefined,
  text: string | null | undefined,
): Promise<LinkPreview | null> {
  if (!previewId || !Types.ObjectId.isValid(previewId)) return null;
  const doc = (await models(app).LinkPreview.findById(previewId).lean()) as LinkPreviewDoc | null;
  if (!doc?.preview) return null;
  return linksIn(text).some((url) => linkKey(url) === doc.key) ? doc.preview : null;
}

/** What a new message stores about links: whether it has one, and the preview it carries. */
export async function linkFields(
  app: FastifyInstance,
  previewId: string | undefined,
  text: string | null | undefined,
) {
  const linkPreview = await previewForMessage(app, previewId, text);
  return {
    ...(linksIn(text).length > 0 ? { hasLink: true } : {}),
    ...(linkPreview ? { linkPreview } : {}),
  };
}

/** The stored picture of a preview, for the image route. */
export async function previewImage(app: FastifyInstance, id: string) {
  const doc = await models(app).LinkPreviewImage.findById(id).lean();
  if (!doc) throw new AppError('NOT_FOUND', 'Image not found.');
  return doc;
}
