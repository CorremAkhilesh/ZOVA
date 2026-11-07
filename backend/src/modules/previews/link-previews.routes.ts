import {
  linkPreviewBodySchema,
  linkPreviewImageParamsSchema,
  linkPreviewResponseSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { lookupPreview, previewImage } from '../../previews/link-previews.service.ts';

/** Link previews: our server fetches the page once; nobody's app ever contacts the site. */
export const linkPreviewsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.post(
    '/link-previews',
    {
      schema: {
        tags: ['link-previews'],
        summary: 'Preview a link while typing (rate-limited per person)',
        body: linkPreviewBodySchema,
        response: { 200: linkPreviewResponseSchema },
      },
    },
    async (request) => lookupPreview(app, currentUserId(request), request.body.url),
  );

  app.get(
    '/link-previews/images/:id',
    {
      schema: {
        tags: ['link-previews'],
        summary: 'A preview picture, resized by our server (signed-in users only)',
        params: linkPreviewImageParamsSchema,
      },
    },
    async (request, reply) => {
      const image = await previewImage(app, request.params.id);
      reply
        .header('cache-control', 'private, max-age=86400, immutable')
        .header('x-content-type-options', 'nosniff');
      return reply.type('image/webp').send(await app.storage.read(image.storageKey));
    },
  );
};
