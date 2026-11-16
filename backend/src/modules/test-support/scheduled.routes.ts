import { objectIdSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { oid } from '../../chats/chats.service.ts';
import { scheduledModels } from '../../chats/scheduled.service.ts';
import { sweepScheduled } from '../../chats/scheduled-runner.ts';

/**
 * TEST ONLY: makes my waiting scheduled messages in a chat due now and runs the sweep once, so E2E
 * need not wait for the clock (the timer itself has backend tests). Registered only when
 * NODE_ENV=test — never in development or production.
 */
export const scheduledTestRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);
  app.post(
    '/test/run-scheduled',
    {
      schema: {
        hide: true,
        body: z.object({ chatId: objectIdSchema }),
        response: { 200: z.object({ sent: z.number().int() }) },
      },
    },
    async (request) => {
      const now = new Date();
      // Index: { userId, status, sendAt }.
      const due = await scheduledModels(app).Scheduled.updateMany(
        {
          userId: oid(currentUserId(request)),
          status: 'pending',
          chatId: oid(request.body.chatId),
        },
        { $set: { sendAt: new Date(now.getTime() - 1000), updatedAt: now } },
      );
      if (due.modifiedCount === 0) return { sent: 0 };
      await sweepScheduled(app);
      return { sent: due.modifiedCount };
    },
  );
};
