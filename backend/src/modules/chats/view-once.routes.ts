import { messageParamsSchema, viewOnceOpenResponseSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { openViewOnce } from '../../chats/view-once.service.ts';

const LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };

/** View once: a photo or video each recipient may open one time. */
export const viewOnceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.post(
    '/chats/:id/messages/:messageId/view-once',
    {
      config: LIMIT,
      schema: {
        tags: ['messages'],
        summary: 'Open a view-once photo or video: one short-lived link, once (then 410)',
        params: messageParamsSchema,
        response: { 200: viewOnceOpenResponseSchema },
      },
    },
    async (request) =>
      openViewOnce(app, currentUserId(request), request.params.id, request.params.messageId),
  );
};
