import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import type { MemoryMailer } from '../../mail/memory-mailer.ts';
import { usersModel } from '../../users/user-record.ts';

/**
 * TEST ONLY: lets E2E tests read the latest email (and so the OTP) sent to an address,
 * lift OTP resend limits and promote an account to admin.
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

    // Lifts the 60 s resend cooldown so E2E can sign the same account in on a second device.
    app.post(
      '/test/reset-otp-limits',
      {
        schema: {
          hide: true,
          body: z.object({ email: z.email() }),
          response: { 200: z.object({ reset: z.literal(true) }) },
        },
      },
      async (request) => {
        await app.otpThrottle.resetEmail(request.body.email.toLowerCase());
        return { reset: true as const };
      },
    );

    // Makes an existing account an admin, so E2E can exercise the admin screens.
    app.post(
      '/test/promote',
      {
        schema: {
          hide: true,
          body: z.object({ email: z.email() }),
          response: { 200: z.object({ promoted: z.boolean() }) },
        },
      },
      async (request) => {
        const result = await usersModel(app).updateOne(
          { email: request.body.email.toLowerCase() },
          { $set: { role: 'admin' } },
        );
        return { promoted: result.matchedCount === 1 };
      },
    );
  };
}
