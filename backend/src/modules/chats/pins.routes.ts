import { messageParamsSchema, pinMessageBodySchema, pinsResponseSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { pinMessage, unpinMessage } from '../../chats/pins.service.ts';

const LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };

/** Pinned messages: for everyone in the chat, for 24 hours, 7 days or 30 days. */
export const pinsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.put(
    '/chats/:id/messages/:messageId/pin',
    {
      config: LIMIT,
      schema: {
        tags: ['messages'],
        summary: 'Pin a message for everyone (at most 3; a fourth replaces the oldest)',
        params: messageParamsSchema,
        body: pinMessageBodySchema,
        response: { 200: pinsResponseSchema },
      },
    },
    async (request) =>
      pinMessage(
        app,
        currentUserId(request),
        request.params.id,
        request.params.messageId,
        request.body.duration,
      ),
  );

  app.delete(
    '/chats/:id/messages/:messageId/pin',
    {
      config: LIMIT,
      schema: {
        tags: ['messages'],
        summary: 'Unpin a message',
        params: messageParamsSchema,
        response: { 200: pinsResponseSchema },
      },
    },
    async (request) =>
      unpinMessage(app, currentUserId(request), request.params.id, request.params.messageId),
  );
};
