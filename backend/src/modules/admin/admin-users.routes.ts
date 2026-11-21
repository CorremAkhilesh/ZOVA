import {
  adminBulkBodySchema,
  adminBulkResponseSchema,
  adminReasonBodySchema,
  adminSignOutResponseSchema,
  adminSuspendBodySchema,
  adminSuspendResponseSchema,
  adminUserDetailSchema,
  adminUserParamsSchema,
  adminUsersExportQuerySchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Types } from 'mongoose';
import { audit } from '../../admin/admin.service.ts';
import { suspendUser, unsuspendUser } from '../../admin/suspend.ts';
import { bulkAction, signOutEverywhere, userDetail } from '../../admin/user-actions.ts';
import { matchingRows, usersCsv } from '../../admin/users-list.ts';
import { requireAdmin } from '../../auth/session.ts';
import { actorOf } from './admin.routes.ts';

/** Admin → Users: one person's page, signing them out, bulk actions and the CSV. All audited. */
export const adminUsersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireAdmin);

  app.get(
    '/admin/users/export',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'The filtered list of people as CSV (no message or file content)',
        querystring: adminUsersExportQuerySchema,
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const rows = await matchingRows(app, request.query);
      await audit(
        app,
        actor,
        'users.export',
        { _id: new Types.ObjectId(actor.id), email: actor.email },
        {
          details: { count: rows.length, filter: request.query.filter, q: request.query.q || null },
        },
      );
      const day = new Date().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="people-${day}.csv"`)
        .header('cache-control', 'no-store')
        .send(usersCsv(rows));
    },
  );

  app.get(
    '/admin/users/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'One person: profile basics, devices and storage (metadata only)',
        params: adminUserParamsSchema,
        response: { 200: adminUserDetailSchema },
      },
    },
    async (request) => userDetail(app, request.params.id),
  );

  app.post(
    '/admin/users/:id/sign-out',
    {
      schema: {
        tags: ['admin'],
        summary: 'Sign a person out of every device now (they can sign in again)',
        params: adminUserParamsSchema,
        body: adminReasonBodySchema,
        response: { 200: adminSignOutResponseSchema },
      },
    },
    async (request) =>
      signOutEverywhere(app, actorOf(request), request.params.id, request.body.reason),
  );

  app.post(
    '/admin/users/:id/suspend',
    {
      schema: {
        tags: ['admin'],
        summary: 'Suspend until a date: signed out now, sign-in refused until then',
        params: adminUserParamsSchema,
        body: adminSuspendBodySchema,
        response: { 200: adminSuspendResponseSchema },
      },
    },
    async (request) =>
      suspendUser(
        app,
        actorOf(request),
        request.params.id,
        new Date(request.body.until),
        request.body.reason,
      ),
  );

  app.post(
    '/admin/users/:id/unsuspend',
    {
      schema: {
        tags: ['admin'],
        summary: 'End a suspension early',
        params: adminUserParamsSchema,
        body: adminReasonBodySchema,
        response: { 200: adminSuspendResponseSchema },
      },
    },
    async (request) => unsuspendUser(app, actorOf(request), request.params.id, request.body.reason),
  );

  app.post(
    '/admin/users/bulk',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'Deactivate, reactivate, sign out or set the storage limit of many people',
        body: adminBulkBodySchema,
        response: { 200: adminBulkResponseSchema },
      },
    },
    async (request) => bulkAction(app, actorOf(request), request.body),
  );
};
