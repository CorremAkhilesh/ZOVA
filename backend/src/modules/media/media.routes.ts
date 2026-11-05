import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  chatParamsSchema,
  completeUploadResponseSchema,
  createUploadBodySchema,
  galleryQuerySchema,
  galleryResponseSchema,
  MEDIA_LINK_TTL_SECONDS,
  mediaLinkQuerySchema,
  mediaLinkResponseSchema,
  POSTER_MAX_BYTES,
  UPLOAD_CHUNK_MAX_BYTES,
  uploadParamsSchema,
  uploadStateSchema,
} from '@zuvo/protocol';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { chatModels } from '../../chats/chats.service.ts';
import { chatGallery } from '../../chats/messages.service.ts';
import type { MediaDoc } from '../../db/chat-models.ts';
import { AppError } from '../../lib/errors.ts';
import { parseRange, setFileHeaders } from '../../media/http.ts';
import {
  appendChunk,
  cancelUpload,
  completeUpload,
  createUpload,
  requireReadable,
  setPoster,
  uploadState,
} from '../../media/media.service.ts';
import { StorageError } from '../../storage/driver.ts';

/** A gallery can ask for many thumbnails at once; each is one small read. */
const CONTENT_RATE_LIMIT = { max: 3000, timeWindow: '1 minute' };
/** A large file is hundreds of chunks, and a whole office can share one address. */
export const CHUNK_RATE_LIMIT = { max: 1200, timeWindow: '1 minute' };

const contentQuerySchema = z.object({
  variant: z.enum(['full', 'thumb']).default('full'),
  download: z.enum(['1']).optional(),
  exp: z.coerce.number().int().optional(),
  sig: z.string().optional(),
});

export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
  /** The whole file or the requested range, with the headers that go with each. */
  async function sendBytes(
    request: FastifyRequest,
    reply: FastifyReply,
    key: string,
    size: number,
  ) {
    const range = parseRange(request.headers.range, size);
    if (range && (range.start >= size || range.start > range.end)) {
      reply.header('Content-Range', `bytes */${size}`);
      return reply.code(416).send();
    }
    try {
      if (!range) {
        reply.header('Content-Length', size);
        return reply.send(await app.storage.read(key));
      }
      reply
        .code(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
        .header('Content-Length', range.end - range.start + 1);
      return reply.send(await app.storage.read(key, range));
    } catch (error) {
      if (error instanceof StorageError && error.code === 'NOT_FOUND') {
        throw new AppError('MEDIA_NOT_FOUND', 'This file is not available here.');
      }
      throw error;
    }
  }

  const secret = app.env.AUTH_SECRET;
  const sign = (id: string, variant: string, download: boolean, expires: number) =>
    createHmac('sha256', `media-link:${secret}`)
      .update(`${id}.${variant}.${download ? 1 : 0}.${expires}`)
      .digest('base64url');

  // Chunks arrive as a stream, written to disk as they come instead of held in memory.
  app.addContentTypeParser('application/offset+octet-stream', (_request, payload, done) =>
    done(null, payload),
  );
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: POSTER_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  await app.register(async (scope) => {
    const authed = scope.withTypeProvider<ZodTypeProvider>();
    authed.addHook('onRequest', requireSession);

    authed.post(
      '/uploads',
      {
        schema: {
          tags: ['media'],
          summary: 'Start an upload',
          body: createUploadBodySchema,
          response: { 200: uploadStateSchema },
        },
      },
      (request) => createUpload(app, currentUserId(request), request.body),
    );
    authed.get(
      '/uploads/:id',
      {
        schema: {
          tags: ['media'],
          summary: 'How much of an upload the server has',
          params: uploadParamsSchema,
          response: { 200: uploadStateSchema },
        },
      },
      (request) => uploadState(app, currentUserId(request), request.params.id),
    );
    authed.patch(
      '/uploads/:id',
      {
        bodyLimit: UPLOAD_CHUNK_MAX_BYTES,
        config: { rateLimit: CHUNK_RATE_LIMIT },
        schema: {
          tags: ['media'],
          summary: 'Send the next chunk, from the offset in the upload-offset header',
          params: uploadParamsSchema,
          headers: z.object({ 'upload-offset': z.coerce.number().int().nonnegative() }),
          response: { 200: uploadStateSchema },
        },
      },
      (request) =>
        appendChunk(
          app,
          currentUserId(request),
          request.params.id,
          Number(request.headers['upload-offset']),
          request.body as Readable,
        ),
    );
    authed.put(
      '/uploads/:id/poster',
      {
        schema: {
          tags: ['media'],
          summary: 'Set the poster image of a video',
          params: uploadParamsSchema,
        },
      },
      async (request) => {
        await setPoster(app, currentUserId(request), request.params.id, request.body as Buffer);
        return { ok: true };
      },
    );
    authed.post(
      '/uploads/:id/complete',
      {
        schema: {
          tags: ['media'],
          summary: 'Check and process a fully uploaded file',
          params: uploadParamsSchema,
          response: { 200: completeUploadResponseSchema },
        },
      },
      async (request) => ({
        media: await completeUpload(app, currentUserId(request), request.params.id),
      }),
    );
    authed.delete(
      '/uploads/:id',
      {
        schema: { tags: ['media'], summary: 'Cancel an upload', params: uploadParamsSchema },
      },
      async (request) => {
        await cancelUpload(app, currentUserId(request), request.params.id);
        return { ok: true };
      },
    );

    authed.get(
      '/media/:id/link',
      {
        schema: {
          tags: ['media'],
          summary: 'A signed link to a file, valid for 15 minutes',
          params: uploadParamsSchema,
          querystring: mediaLinkQuerySchema,
          response: { 200: mediaLinkResponseSchema },
        },
      },
      async (request) => {
        const { id } = request.params;
        await requireReadable(app, id, currentUserId(request));
        const download = request.query.download === true;
        const expires = Math.floor(Date.now() / 1000) + MEDIA_LINK_TTL_SECONDS;
        const search = new URLSearchParams({
          exp: String(expires),
          sig: sign(id, 'full', download, expires),
          ...(download ? { download: '1' } : {}),
        });
        return {
          url: `/v1/media/${id}/content?${search}`,
          expiresAt: new Date(expires * 1000).toISOString(),
        };
      },
    );

    authed.get(
      '/chats/:id/media',
      {
        schema: {
          tags: ['media'],
          summary: 'A chat’s photos and videos, or its documents, newest first',
          params: chatParamsSchema,
          querystring: galleryQuerySchema,
          response: { 200: galleryResponseSchema },
        },
      },
      (request) => chatGallery(app, currentUserId(request), request.params.id, request.query),
    );
  });

  /** A signed link stands in for the session; without one, the session and membership decide. */
  async function authorize(
    request: FastifyRequest,
    id: string,
    query: z.infer<typeof contentQuerySchema>,
  ): Promise<MediaDoc> {
    if (query.sig === undefined) {
      await requireSession(request);
      return requireReadable(app, id, currentUserId(request));
    }
    const expected = Buffer.from(sign(id, query.variant, query.download === '1', query.exp ?? 0));
    const given = Buffer.from(query.sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new AppError('MEDIA_LINK_INVALID', 'This link is not valid.');
    }
    if ((query.exp ?? 0) * 1000 < Date.now()) {
      throw new AppError('MEDIA_LINK_INVALID', 'This link has expired.');
    }
    const doc = await chatModels(app).Media.findById(id).lean();
    if (!doc) throw new AppError('NOT_FOUND', 'Media not found.');
    return doc;
  }

  app.get(
    '/media/:id/content',
    {
      config: { rateLimit: CONTENT_RATE_LIMIT },
      schema: {
        tags: ['media'],
        summary: 'The file. Supports byte ranges',
        params: uploadParamsSchema,
        querystring: contentQuerySchema,
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { query } = request;
      const doc = await authorize(request, id, query);
      const thumbnail = query.variant === 'thumb';
      const key = thumbnail ? doc.thumbnailKey : doc.storageKey;
      const info = key ? await app.storage.stat(key) : null;
      if (!key || !info) {
        throw new AppError('MEDIA_NOT_FOUND', 'This file is not available here.');
      }
      setFileHeaders(reply, doc, thumbnail, query.download === '1');
      return sendBytes(request, reply, key, info.size);
    },
  );
};
