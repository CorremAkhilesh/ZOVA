import { quietHoursResponseSchema, quietHoursSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { quietHoursFor, setQuietHours } from '../../settings/quiet-hours.service.ts';

const tags = ['settings'];

/** Do Not Disturb, kept on the server so notifications follow it on every device. */
export const quietHoursRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get(
    '/me/quiet-hours',
    { schema: { tags, response: { 200: quietHoursResponseSchema } } },
    async (request) => ({ quietHours: await quietHoursFor(app, currentUserId(request)) }),
  );

  app.put(
    '/me/quiet-hours',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Replace my quiet hours (Do Not Disturb)',
        body: quietHoursSchema,
        response: { 200: quietHoursResponseSchema },
      },
    },
    async (request) => ({
      quietHours: await setQuietHours(app, currentUserId(request), request.body),
    }),
  );
};
