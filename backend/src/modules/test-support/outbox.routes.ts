import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import type { MemoryMailer } from '../../mail/memory-mailer.ts';

/**
 * TEST ONLY: lets E2E tests read the latest email (and so the OTP) sent to an address.
 * Registered only when NODE_ENV=test with the in-memory mailer — never in development or production.
 */
export function outboxRoutes(mailer: MemoryMailer): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/test/outbox/latest',
      {
        schema: {
          hide: true,
          querystring: z.object({ to: z.email() }),
          response: { 200: z.object({ subject: z.string(), text: z.string() }) },
        },
      },
      async (request) => {
        const message = mailer.lastTo(request.query.to);
        if (!message) throw new AppError('NOT_FOUND', 'No email for that address yet.');
        return { subject: message.subject, text: message.text };
      },
    );
  };
}
