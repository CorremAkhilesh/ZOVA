import { messageSearchQuerySchema, messageSearchResponseSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { searchMessages } from '../../search/message-search.service.ts';

/** Message search: only what this person may see, newest first. People search is /users/search. */
export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get(
    '/search/messages',
    {
      schema: {
        tags: ['search'],
        summary: 'Search my messages, in all chats or one, by words and/or kind',
        querystring: messageSearchQuerySchema,
        response: { 200: messageSearchResponseSchema },
      },
    },
    async (request) => searchMessages(app, currentUserId(request), request.query),
  );
};
