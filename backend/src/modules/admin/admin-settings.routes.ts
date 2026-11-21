import { adminSettingsBodySchema, adminSettingsResponseSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAdmin } from '../../auth/session.ts';
import { adminSettings, updateSettings } from '../../settings/admin-settings.ts';
import { actorOf } from './admin.routes.ts';

/** Admin → Settings: organization settings over the env defaults. Every change is audited. */
export const adminSettingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireAdmin);

  app.get(
    '/admin/settings',
    {
      schema: {
        tags: ['admin'],
        summary: 'What applies now, the defaults, and which settings an admin changed',
        response: { 200: adminSettingsResponseSchema },
      },
    },
    async () => adminSettings(app),
  );

  app.put(
    '/admin/settings',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'Change settings (or put them back to the default), with a reason',
        body: adminSettingsBodySchema,
        response: { 200: adminSettingsResponseSchema },
      },
    },
    async (request) => updateSettings(app, actorOf(request), request.body),
  );
};
