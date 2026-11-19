import {
  adminPushQuerySchema,
  adminPushResponseSchema,
  remindBodySchema,
  remindResponseSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAdmin } from '../../auth/session.ts';
import { adminPushOverview } from '../../push/admin-overview.ts';
import { remindUsers } from '../../push/remind.ts';
import { actorOf } from './admin.routes.ts';

/** Admin → Notifications: who gets notified on which devices, and a reminder for the others. */
export const adminNotificationsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireAdmin);

  app.get(
    '/admin/notifications',
    {
      schema: {
        tags: ['admin'],
        summary: 'Active people, their devices, and whether push is on for each',
        querystring: adminPushQuerySchema,
        response: { 200: adminPushResponseSchema },
      },
    },
    async (request) => adminPushOverview(app, request.query.limit, request.query.cursor),
  );

  app.post(
    '/admin/notifications/remind',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'Message the chosen people: install the app and turn notifications on',
        body: remindBodySchema,
        response: { 200: remindResponseSchema },
      },
    },
    async (request) => ({
      sent: await remindUsers(app, actorOf(request), request.body.userIds),
    }),
  );
};
