import {
  chatParamsSchema,
  disappearingResponseSchema,
  setDisappearingBodySchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { setDisappearing } from '../../chats/disappearing.service.ts';

const LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };

/** Disappearing messages: the chat's timer for new messages, the same for every member. */
export const disappearingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.put(
    '/chats/:id/disappearing',
    {
      config: LIMIT,
      schema: {
        tags: ['chats'],
        summary: 'Set how long new messages in this chat last (off, 24h, 7d, 90d)',
        params: chatParamsSchema,
        body: setDisappearingBodySchema,
        response: { 200: disappearingResponseSchema },
      },
    },
    async (request) =>
      setDisappearing(app, currentUserId(request), request.params.id, request.body.timer),
  );
};
