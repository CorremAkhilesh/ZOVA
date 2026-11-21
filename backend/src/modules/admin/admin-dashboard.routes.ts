import { adminDashboardSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { adminDashboard } from '../../admin/dashboard.service.ts';
import { requireAdmin } from '../../auth/session.ts';

/** Admin → Dashboard: people, activity, storage and health. Counts only, never content. */
export const adminDashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireAdmin);

  app.get(
    '/admin/dashboard',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'Counts for the admin dashboard (cached for a minute)',
        response: { 200: adminDashboardSchema },
      },
    },
    async () => adminDashboard(app),
  );
};
