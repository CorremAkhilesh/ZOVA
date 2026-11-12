import {
  createScheduledBodySchema,
  okResponseSchema,
  scheduledListQuerySchema,
  scheduledListResponseSchema,
  scheduledParamsSchema,
  scheduledResponseSchema,
  updateScheduledBodySchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import {
  createScheduled,
  deleteScheduled,
  listScheduled,
  noJobs,
  updateScheduled,
} from '../../chats/scheduled.service.ts';
import {
  type ScheduledRunner,
  sendScheduledNow,
  startScheduledRunner,
} from '../../chats/scheduled-runner.ts';

const LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } };

/**
 * My scheduled messages, sent at their time even while I am offline. The runner starts with the
 * app (it needs Socket.IO, so it lives in the API process) and stops with it.
 */
export const scheduledRoutes: FastifyPluginAsyncZod = async (app) => {
  let runner: ScheduledRunner | null = null;
  const jobs = () => runner?.jobs ?? noJobs;
  app.addHook('onReady', async () => {
    runner = startScheduledRunner(app);
  });
  app.addHook('onClose', async () => {
    await runner?.close();
    runner = null;
  });
  app.addHook('onRequest', requireSession);

  app.post(
    '/me/scheduled',
    {
      config: LIMIT,
      schema: {
        tags: ['messages'],
        summary: 'Schedule a message (text, or a finished upload with a caption)',
        body: createScheduledBodySchema,
        response: { 200: scheduledResponseSchema },
      },
    },
    async (request) => ({
      item: await createScheduled(app, currentUserId(request), request.body, jobs()),
    }),
  );

  app.get(
    '/me/scheduled',
    {
      schema: {
        tags: ['messages'],
        summary: 'My scheduled messages still waiting or failed, soonest first',
        querystring: scheduledListQuerySchema,
        response: { 200: scheduledListResponseSchema },
      },
    },
    async (request) => ({
      items: await listScheduled(app, currentUserId(request), request.query.chatId),
    }),
  );

  app.patch(
    '/me/scheduled/:id',
    {
      config: LIMIT,
      schema: {
        tags: ['messages'],
        summary: 'Change the text or time of a waiting scheduled message',
        params: scheduledParamsSchema,
        body: updateScheduledBodySchema,
        response: { 200: scheduledResponseSchema },
      },
    },
    async (request) => ({
      item: await updateScheduled(
        app,
        currentUserId(request),
        request.params.id,
        request.body,
        jobs(),
      ),
    }),
  );

  app.post(
    '/me/scheduled/:id/send-now',
    {
      config: LIMIT,
      schema: {
        tags: ['messages'],
        summary: 'Send a waiting (or failed) scheduled message right away',
        params: scheduledParamsSchema,
        response: { 200: scheduledResponseSchema },
      },
    },
    async (request) => ({
      item: await sendScheduledNow(app, currentUserId(request), request.params.id, jobs()),
    }),
  );

  app.delete(
    '/me/scheduled/:id',
    {
      config: LIMIT,
      schema: {
        tags: ['messages'],
        summary: 'Cancel a waiting scheduled message, or remove a failed one',
        params: scheduledParamsSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      await deleteScheduled(app, currentUserId(request), request.params.id, jobs());
      return { ok: true as const };
    },
  );
};
