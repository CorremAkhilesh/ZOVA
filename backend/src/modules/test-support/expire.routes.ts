import { objectIdSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { chatModels, oid } from '../../chats/chats.service.ts';

/**
 * TEST ONLY: makes a chat's disappearing messages due now and runs the expiry sweep once, so E2E
 * need not wait a day. Registered only when NODE_ENV=test — never in development or production.
 */
export const expireTestRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/test/expire-messages',
    {
      schema: {
        hide: true,
        body: z.object({ chatId: objectIdSchema }),
        response: { 200: z.object({ expired: z.number().int() }) },
      },
    },
    async (request) => {
      const past = new Date(Date.now() - 1000);
      await chatModels(app).Message.updateMany(
        { chatId: oid(request.body.chatId), expiresAt: { $type: 'date' } },
        { $set: { expiresAt: past } },
      );
      const result = await app.expirySweep.run();
      return { expired: result.messages };
    },
  );
};
