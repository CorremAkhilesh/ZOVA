import {
  adminUserParamsSchema,
  adminUserStatusResponseSchema,
  objectIdSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { type AuthUserRecord, requireAdmin } from '../../auth/session.ts';
import { AppError } from '../../lib/errors.ts';

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  async function setStatus(adminId: string, rawId: string, status: 'active' | 'deactivated') {
    const parsed = objectIdSchema.safeParse(rawId);
    if (!parsed.success) throw new AppError('NOT_FOUND', 'User not found.');
    const id = parsed.data;
    if (status === 'deactivated' && id === adminId) {
      throw new AppError('CONFLICT', 'You cannot deactivate your own account.');
    }
    const context = await app.auth.$context;
    const existing = (await context.internalAdapter.findUserById(id)) as AuthUserRecord | null;
    if (!existing) throw new AppError('NOT_FOUND', 'User not found.');

    let revokedSessions = 0;
    if (status === 'deactivated') {
      // Revoke everywhere at once (database and Redis session cache), then block future logins.
      revokedSessions = (await context.internalAdapter.listSessions(id)).length;
      await context.internalAdapter.deleteUserSessions(id);
    }
    const user = (await context.internalAdapter.updateUser(id, { status })) as AuthUserRecord;
    app.log.info({ targetUserId: id, adminId, status, revokedSessions }, 'user status changed');
    return { user: { id: user.id, email: user.email, status }, revokedSessions };
  }

  const schema = (summary: string) => ({
    tags: ['admin'],
    summary,
    params: adminUserParamsSchema,
    response: { 200: adminUserStatusResponseSchema },
  });

  app.post(
    '/admin/users/:id/deactivate',
    { preHandler: requireAdmin, schema: schema('Deactivate a user and revoke all their sessions') },
    async (request) => setStatus(request.auth?.user.id ?? '', request.params.id, 'deactivated'),
  );

  app.post(
    '/admin/users/:id/reactivate',
    { preHandler: requireAdmin, schema: schema('Reactivate a deactivated user') },
    async (request) => setStatus(request.auth?.user.id ?? '', request.params.id, 'active'),
  );
};
