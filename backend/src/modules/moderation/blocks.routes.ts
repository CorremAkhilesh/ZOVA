import {
  blockedContactsResponseSchema,
  blockParamsSchema,
  blockResponseSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { blockUser, listBlocked, unblockUser } from '../../moderation/blocks.service.ts';

const LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };

/** Blocking: mine alone. The other person is not told. */
export const blocksRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get(
    '/me/blocks',
    {
      schema: {
        tags: ['blocks'],
        summary: 'Everyone I blocked, newest first',
        response: { 200: blockedContactsResponseSchema },
      },
    },
    async (request) => ({ items: await listBlocked(app, currentUserId(request)) }),
  );

  app.put(
    '/me/blocks/:userId',
    {
      config: LIMIT,
      schema: {
        tags: ['blocks'],
        summary: 'Block someone: no messages either way in our chat, and no presence or photo',
        params: blockParamsSchema,
        response: { 200: blockResponseSchema },
      },
    },
    async (request) => blockUser(app, currentUserId(request), request.params.userId),
  );

  app.delete(
    '/me/blocks/:userId',
    {
      config: LIMIT,
      schema: {
        tags: ['blocks'],
        summary: 'Unblock someone',
        params: blockParamsSchema,
        response: { 200: blockResponseSchema },
      },
    },
    async (request) => unblockUser(app, currentUserId(request), request.params.userId),
  );
};
