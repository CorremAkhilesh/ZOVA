import { pushPayloadSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import type { MemoryPushSender } from '../../push/sender.ts';
import { usersModel } from '../../users/user-record.ts';

const recordedPushSchema = z.object({
  sessionId: z.string(),
  endpoint: z.string(),
  payload: pushPayloadSchema,
  urgency: z.enum(['normal', 'high']),
  ttlSeconds: z.number(),
  at: z.string(),
});

/**
 * TEST ONLY: the pushes the in-memory sender "sent", so tests and E2E can check notifications
 * without a push service. Registered only when NODE_ENV=test — never in development or production.
 */
export function pushOutboxRoutes(sender: MemoryPushSender): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/test/push/outbox',
      {
        schema: {
          hide: true,
          querystring: z.object({ email: z.email() }),
          response: { 200: z.object({ pushes: z.array(recordedPushSchema) }) },
        },
      },
      async (request) => {
        const user = await usersModel(app)
          .findOne({ email: request.query.email.toLowerCase() })
          .select({ _id: 1 })
          .lean();
        if (!user) throw new AppError('NOT_FOUND', 'No such user.');
        const userId = user._id.toString();
        return {
          pushes: sender.sent
            .filter((push) => push.userId === userId)
            .map((push) => ({
              sessionId: push.sessionId,
              endpoint: push.endpoint,
              payload: push.payload,
              urgency: push.options.urgency,
              ttlSeconds: push.options.ttlSeconds,
              at: push.at,
            })),
        };
      },
    );

    app.delete(
      '/test/push/outbox',
      { schema: { hide: true, response: { 200: z.object({ cleared: z.literal(true) }) } } },
      async () => {
        sender.clear();
        return { cleared: true as const };
      },
    );
  };
}
