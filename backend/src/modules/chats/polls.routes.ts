import { messageParamsSchema, pollMessageResponseSchema, votePollBodySchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { closePoll, votePoll } from '../../chats/polls.service.ts';

const LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } };

/** Voting in a poll, and closing one. Everyone who can see the poll sees who voted for what. */
export const pollsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.put(
    '/chats/:id/messages/:messageId/vote',
    {
      config: LIMIT,
      schema: {
        tags: ['messages'],
        summary: 'Vote in a poll: my whole choice, replacing the last; none removes my vote',
        params: messageParamsSchema,
        body: votePollBodySchema,
        response: { 200: pollMessageResponseSchema },
      },
    },
    async (request) =>
      votePoll(
        app,
        currentUserId(request),
        request.params.id,
        request.params.messageId,
        request.body.optionIds,
      ),
  );

  app.post(
    '/chats/:id/messages/:messageId/close-poll',
    {
      config: LIMIT,
      schema: {
        tags: ['messages'],
        summary: 'Close my poll: no more votes',
        params: messageParamsSchema,
        response: { 200: pollMessageResponseSchema },
      },
    },
    async (request) =>
      closePoll(app, currentUserId(request), request.params.id, request.params.messageId),
  );
};
