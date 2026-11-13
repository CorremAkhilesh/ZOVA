import {
  adminRoleBodySchema,
  adminUserParamsSchema,
  adminUserResponseSchema,
  adminUserStatusResponseSchema,
  adminUsersQuerySchema,
  adminUsersResponseSchema,
  auditLogResponseSchema,
  cursorPageQuerySchema,
} from '@zuvo/protocol';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { type Actor, listAudit, listUsers, setRole } from '../../admin/admin.service.ts';
import { setUserStatus } from '../../admin/user-status.ts';
import { requireAdmin } from '../../auth/session.ts';
import { AppError } from '../../lib/errors.ts';

export function actorOf(request: FastifyRequest): Actor {
  if (!request.auth) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  return {
    id: request.auth.user.id,
    email: request.auth.user.email,
    ipAddress: request.ip ?? null,
  };
}

/** Admin-only: users (search, status, role) and the audit log. Every change is audited. */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  // onRequest: authentication is decided before any body is parsed or validated (401 before 400).
  app.addHook('onRequest', requireAdmin);

  const setStatus = (actor: Actor, id: string, status: 'active' | 'deactivated') =>
    setUserStatus(app, actor, id, status);

  app.get(
    '/admin/users',
    {
      schema: {
        tags: ['admin'],
        querystring: adminUsersQuerySchema,
        response: { 200: adminUsersResponseSchema },
      },
    },
    async (request) => listUsers(app, request.query.q, request.query.limit, request.query.cursor),
  );

  const statusSchema = (summary: string) => ({
    tags: ['admin'],
    summary,
    params: adminUserParamsSchema,
    response: { 200: adminUserStatusResponseSchema },
  });

  app.post(
    '/admin/users/:id/deactivate',
    { schema: statusSchema('Deactivate a user and revoke all their sessions') },
    async (request) => setStatus(actorOf(request), request.params.id, 'deactivated'),
  );

  app.post(
    '/admin/users/:id/reactivate',
    { schema: statusSchema('Reactivate a deactivated user') },
    async (request) => setStatus(actorOf(request), request.params.id, 'active'),
  );

  app.put(
    '/admin/users/:id/role',
    {
      schema: {
        tags: ['admin'],
        summary: 'Promote to admin or demote to user (never yourself, never the last admin)',
        params: adminUserParamsSchema,
        body: adminRoleBodySchema,
        response: { 200: adminUserResponseSchema },
      },
    },
    async (request) => ({
      user: await setRole(app, actorOf(request), request.params.id, request.body.role),
    }),
  );

  app.get(
    '/admin/audit-log',
    {
      schema: {
        tags: ['admin'],
        querystring: cursorPageQuerySchema,
        response: { 200: auditLogResponseSchema },
      },
    },
    async (request) => listAudit(app, request.query.limit, request.query.cursor),
  );
};
