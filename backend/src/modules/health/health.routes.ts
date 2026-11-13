import { healthResponseSchema, readyResponseSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { APP_VERSION } from '../../lib/version.ts';
import { checkReadiness } from './readiness.ts';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness: the process is up',
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      version: APP_VERSION,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }),
  );

  app.get(
    '/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness: MongoDB, Redis and media storage are usable',
        response: { 200: readyResponseSchema, 503: readyResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await checkReadiness({
        mongo: app.mongo,
        redis: app.redis,
        storage: app.storage,
        logger: request.log,
      });
      return reply.status(result.status === 'ready' ? 200 : 503).send(result);
    },
  );
};
