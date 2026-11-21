import {
  adminDeleteGroupBodySchema,
  adminDeleteGroupResponseSchema,
  adminGroupResponseSchema,
  adminGroupsQuerySchema,
  adminGroupsResponseSchema,
  adminReasonBodySchema,
  adminUserParamsSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { archiveGroup, deleteGroup, listGroups, restoreGroup } from '../../admin/groups.ts';
import { requireAdmin } from '../../auth/session.ts';
import { actorOf } from './admin.routes.ts';

/** Admin → Groups: list, archive (read only), restore, delete for everyone. Audited. */
export const adminGroupsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireAdmin);

  app.get(
    '/admin/groups',
    {
      schema: {
        tags: ['admin'],
        summary: 'Every group: size, admins, owner, activity and storage (never its messages)',
        querystring: adminGroupsQuerySchema,
        response: { 200: adminGroupsResponseSchema },
      },
    },
    async (request) => listGroups(app, request.query),
  );

  const action = (summary: string) => ({
    schema: {
      tags: ['admin'],
      summary,
      params: adminUserParamsSchema,
      body: adminReasonBodySchema,
      response: { 200: adminGroupResponseSchema },
    },
  });

  app.post(
    '/admin/groups/:id/archive',
    action('Archive a group: readable and leavable, nothing else'),
    async (request) => ({
      group: await archiveGroup(app, actorOf(request), request.params.id, request.body.reason),
    }),
  );

  app.post('/admin/groups/:id/restore', action('Undo an archive'), async (request) => ({
    group: await restoreGroup(app, actorOf(request), request.params.id, request.body.reason),
  }));

  app.post(
    '/admin/groups/:id/delete',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'Delete a group for everyone (its name typed again)',
        params: adminUserParamsSchema,
        body: adminDeleteGroupBodySchema,
        response: { 200: adminDeleteGroupResponseSchema },
      },
    },
    async (request) =>
      deleteGroup(
        app,
        actorOf(request),
        request.params.id,
        request.body.confirmName,
        request.body.reason,
      ),
  );
};
