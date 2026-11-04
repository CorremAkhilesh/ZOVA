import { randomBytes } from 'node:crypto';
import { objectIdSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sendMessage } from '../../chats/messages.service.ts';
import { AppError } from '../../lib/errors.ts';
import type { MemoryMailer } from '../../mail/memory-mailer.ts';
import { usersModel } from '../../users/user-record.ts';

const uuidv7 = () => {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(0, 3)}-a${random.slice(3, 6)}-${random.slice(6, 18)}`;
};

/**
 * TEST ONLY: lets E2E tests read the latest email (and so the OTP) sent to an address,
 * lift OTP resend limits, promote an account to admin and fill a chat with messages.
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

    // A long chat for E2E, past the socket's rate limit. "seeded 1", "seeded 2"… from one member.
    app.post(
      '/test/seed-messages',
      {
        schema: {
          hide: true,
          body: z.object({
            chatId: objectIdSchema,
            email: z.email(),
            count: z.number().int().min(1).max(500),
          }),
          response: { 200: z.object({ seeded: z.number() }) },
        },
      },
      async (request) => {
        const { chatId, email, count } = request.body;
        const sender = await usersModel(app).findOne({ email: email.toLowerCase() }).lean();
        if (!sender) throw new AppError('NOT_FOUND', 'No such user.');
        for (let n = 1; n <= count; n++) {
          await sendMessage(app, {
            userId: String(sender._id),
            chatId,
            clientMsgId: uuidv7(),
            text: `seeded ${n}`,
          });
        }
        return { seeded: count };
      },
    );
  };
}
