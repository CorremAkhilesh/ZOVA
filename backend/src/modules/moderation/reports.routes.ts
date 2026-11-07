import {
  createReportBodySchema,
  createReportResponseSchema,
  reportDetailResponseSchema,
  reportListQuerySchema,
  reportListResponseSchema,
  reportParamsSchema,
  reportSummarySchema,
  resolveReportBodySchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUserId, requireAdmin, requireSession } from '../../auth/session.ts';
import { listReports, resolveReport, viewReport } from '../../moderation/admin-reports.service.ts';
import { createReport } from '../../moderation/reports.service.ts';
import { actorOf } from '../admin/admin.routes.ts';

/** Anyone signed in may report. */
export const reportsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.post(
    '/reports',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['reports'],
        summary: 'Report a person, messages or a group; optionally block the person too',
        body: createReportBodySchema,
        response: { 200: createReportResponseSchema },
      },
    },
    async (request) => createReport(app, currentUserId(request), request.body),
  );
};

/** Admin → Reports. Viewing evidence and resolving are both audited. */
export const adminReportsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireAdmin);

  app.get(
    '/admin/reports',
    {
      schema: {
        tags: ['admin'],
        querystring: reportListQuerySchema,
        response: { 200: reportListResponseSchema },
      },
    },
    async (request) => listReports(app, request.query),
  );

  app.get(
    '/admin/reports/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'A report with its evidence (audited)',
        params: reportParamsSchema,
        response: { 200: reportDetailResponseSchema },
      },
    },
    async (request) => ({ report: await viewReport(app, actorOf(request), request.params.id) }),
  );

  app.post(
    '/admin/reports/:id/resolve',
    {
      schema: {
        tags: ['admin'],
        summary: 'Resolve a report, optionally deactivating the person reported (audited)',
        params: reportParamsSchema,
        body: resolveReportBodySchema,
        response: { 200: z.object({ report: reportSummarySchema }) },
      },
    },
    async (request) => ({
      report: await resolveReport(app, actorOf(request), request.params.id, request.body),
    }),
  );
};
