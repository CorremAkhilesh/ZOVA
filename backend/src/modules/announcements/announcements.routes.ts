import {
  adminAnnouncementResponseSchema,
  adminAnnouncementsQuerySchema,
  adminAnnouncementsResponseSchema,
  adminReasonBodySchema,
  adminUserParamsSchema,
  announcementBannersResponseSchema,
  createAnnouncementBodySchema,
  okResponseSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  bannersFor,
  createAnnouncement,
  dismissBanner,
  endAnnouncement,
  listAnnouncements,
} from '../../admin/announcements.ts';
import { currentUserId, requireAdmin, requireSession } from '../../auth/session.ts';
import { actorOf } from '../admin/admin.routes.ts';

/** Banners for me now, and closing one. */
export const announcementsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get(
    '/announcements',
    {
      schema: {
        tags: ['announcements'],
        summary: 'Banners from the admins for me now (not closed)',
        response: { 200: announcementBannersResponseSchema },
      },
    },
    async (request) => bannersFor(app, currentUserId(request)),
  );

  app.post(
    '/announcements/:id/dismiss',
    {
      schema: {
        tags: ['announcements'],
        summary: 'Close a banner on every device of mine',
        params: adminUserParamsSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (request) => dismissBanner(app, currentUserId(request), request.params.id),
  );
};

/** Admin → Announcements: make one, list them, end a banner early. Audited. */
export const adminAnnouncementsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireAdmin);

  app.get(
    '/admin/announcements',
    {
      schema: {
        tags: ['admin'],
        querystring: adminAnnouncementsQuerySchema,
        response: { 200: adminAnnouncementsResponseSchema },
      },
    },
    async (request) => listAnnouncements(app, request.query.limit, request.query.cursor),
  );

  app.post(
    '/admin/announcements',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'Announce to everyone or chosen people: a banner and/or a chat message',
        body: createAnnouncementBodySchema,
        response: { 200: adminAnnouncementResponseSchema },
      },
    },
    async (request) => ({
      announcement: await createAnnouncement(app, actorOf(request), request.body),
    }),
  );

  app.post(
    '/admin/announcements/:id/end',
    {
      schema: {
        tags: ['admin'],
        summary: 'Take a banner down for everyone now',
        params: adminUserParamsSchema,
        body: adminReasonBodySchema,
        response: { 200: adminAnnouncementResponseSchema },
      },
    },
    async (request) => ({
      announcement: await endAnnouncement(
        app,
        actorOf(request),
        request.params.id,
        request.body.reason,
      ),
    }),
  );
};
