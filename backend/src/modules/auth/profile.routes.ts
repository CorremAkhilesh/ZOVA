import { updateProfileBodySchema, updateProfileResponseSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { type AuthUserRecord, requireSession, toSessionUser } from '../../auth/session.ts';

export const profileRoutes: FastifyPluginAsyncZod = async (app) => {
  app.patch(
    '/me/profile',
    {
      preHandler: requireSession,
      schema: {
        tags: ['profile'],
        summary: 'Update the signed-in user’s display name',
        body: updateProfileBodySchema,
        response: { 200: updateProfileResponseSchema },
      },
    },
    async (request) => {
      const userId = request.auth?.user.id ?? '';
      const context = await app.auth.$context;
      const { displayName } = request.body;
      const user = await context.internalAdapter.updateUser(userId, {
        displayName,
        name: displayName,
      });
      return { user: toSessionUser(user as AuthUserRecord) };
    },
  );
};
