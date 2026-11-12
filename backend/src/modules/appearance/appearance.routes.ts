import {
  appearanceResponseSchema,
  chatParamsSchema,
  chatResponseSchema,
  chatWallpaperBodySchema,
  objectIdSchema,
  updateAppearanceBodySchema,
  WALLPAPER_MAX_BYTES,
  wallpaperImageResponseSchema,
  wallpaperImagesResponseSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getAppearance,
  setChatWallpaper,
  updateAppearance,
} from '../../appearance/appearance.service.ts';
import {
  addWallpaper,
  deleteWallpaper,
  listWallpapers,
  requireMyWallpaper,
} from '../../appearance/wallpapers.service.ts';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { AppError } from '../../lib/errors.ts';
import { StorageError } from '../../storage/driver.ts';

const tags = ['appearance'];
const LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };
const imageParams = z.object({ id: objectIdSchema });
const MAX_MB = WALLPAPER_MAX_BYTES / 1024 / 1024;

/** Accent colour, wallpapers and dimming: mine alone, on every device of mine. */
export const appearanceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);
  const me = currentUserId;

  app.get(
    '/me/appearance',
    { schema: { tags, response: { 200: appearanceResponseSchema } } },
    async (request) => ({ appearance: await getAppearance(app, me(request)) }),
  );

  app.patch(
    '/me/appearance',
    {
      config: LIMIT,
      schema: {
        tags,
        summary: 'Change accent, default wallpaper and/or dimming',
        body: updateAppearanceBodySchema,
        response: { 200: appearanceResponseSchema },
      },
    },
    async (request) => ({ appearance: await updateAppearance(app, me(request), request.body) }),
  );

  app.put(
    '/chats/:id/wallpaper',
    {
      config: LIMIT,
      schema: {
        tags,
        summary: "This chat's own wallpaper, for me only (null: my default)",
        params: chatParamsSchema,
        body: chatWallpaperBodySchema,
        response: { 200: chatResponseSchema },
      },
    },
    async (request) => ({
      chat: await setChatWallpaper(app, me(request), request.params.id, request.body.wallpaper),
    }),
  );

  app.get(
    '/me/wallpapers',
    { schema: { tags, response: { 200: wallpaperImagesResponseSchema } } },
    async (request) => ({ images: await listWallpapers(app, me(request)) }),
  );

  app.post(
    '/me/wallpapers',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: `Upload a wallpaper picture (multipart field "file", ≤ ${MAX_MB} MB)`,
        response: { 200: wallpaperImageResponseSchema },
      },
    },
    async (request) => {
      // Larger than the avatar default set in app.ts, for this route only.
      const file = await request.file({ limits: { fileSize: WALLPAPER_MAX_BYTES, files: 1 } });
      if (!file) throw new AppError('BAD_REQUEST', 'Attach a picture in the "file" field.');
      const bytes = await file.toBuffer().catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new AppError('PAYLOAD_TOO_LARGE', `Pictures can be at most ${MAX_MB} MB.`);
        }
        throw error;
      });
      return { image: await addWallpaper(app, me(request), bytes) };
    },
  );

  app.get(
    '/me/wallpapers/:id',
    { schema: { tags, summary: 'One of my wallpaper pictures (WebP)', params: imageParams } },
    async (request, reply) => {
      const doc = await requireMyWallpaper(app, me(request), request.params.id);
      const stream = await app.storage.read(doc.key).catch((error: unknown) => {
        // Another environment's file (shared dev database): a placeholder, never a crash.
        if (error instanceof StorageError) throw new AppError('NOT_FOUND', 'Media not available.');
        throw error;
      });
      return reply
        .type('image/webp')
        .header('cache-control', 'private, max-age=31536000, immutable')
        .header('vary', 'Cookie')
        .header('x-content-type-options', 'nosniff')
        .send(stream);
    },
  );

  app.delete(
    '/me/wallpapers/:id',
    { schema: { tags, params: imageParams, response: { 200: wallpaperImagesResponseSchema } } },
    async (request) => {
      await deleteWallpaper(app, me(request), request.params.id);
      return { images: await listWallpapers(app, me(request)) };
    },
  );
};
