import {
  adminReasonBodySchema,
  adminSecurityResponseSchema,
  adminUnlockResponseSchema,
  adminUserParamsSchema,
  auditFilterSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Types } from 'mongoose';
import { audit } from '../../admin/admin.service.ts';
import { auditCsv } from '../../admin/audit-log.ts';
import { adminSecurity, unlockEmail } from '../../admin/security.ts';
import { requireAdmin } from '../../auth/session.ts';
import { actorOf } from './admin.routes.ts';

/** Admin → Security (sessions, locks, wrong codes) and the audit log as CSV. Audited. */
export const adminSecurityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireAdmin);

  app.get(
    '/admin/security',
    {
      schema: {
        tags: ['admin'],
        summary: 'Signed-in devices, emails locked for the day, recent wrong codes (masked IPs)',
        response: { 200: adminSecurityResponseSchema },
      },
    },
    async () => adminSecurity(app),
  );

  app.post(
    '/admin/security/locks/:id/unlock',
    {
      schema: {
        tags: ['admin'],
        summary: 'End an email’s sign-in lock now',
        params: adminUserParamsSchema,
        body: adminReasonBodySchema,
        response: { 200: adminUnlockResponseSchema },
      },
    },
    async (request) => unlockEmail(app, actorOf(request), request.params.id, request.body.reason),
  );

  app.get(
    '/admin/audit-log/export',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'The filtered audit log as CSV (at most 10,000 rows)',
        querystring: auditFilterSchema,
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const csv = await auditCsv(app, request.query);
      await audit(
        app,
        actor,
        'audit.export',
        { _id: new Types.ObjectId(actor.id), email: actor.email },
        { details: { action: request.query.action ?? null } },
      );
      const day = new Date().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="audit-log-${day}.csv"`)
        .header('cache-control', 'no-store')
        .send(csv);
    },
  );
};
