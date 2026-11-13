import { chatParamsSchema, draftResponseSchema, putDraftBodySchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { saveDraft } from '../../chats/drafts.service.ts';

/** My drafts, on every device of mine. Nobody else ever sees them. */
export const draftsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.put(
    '/chats/:id/draft',
    {
      schema: {
        tags: ['chats'],
        summary: 'Save my unsent text here (last write wins); empty text and no reply clears it',
        params: chatParamsSchema,
        body: putDraftBodySchema,
        response: { 200: draftResponseSchema },
      },
    },
    async (request) => saveDraft(app, currentUserId(request), request.params.id, request.body),
  );
};
