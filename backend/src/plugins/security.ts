import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.ts';

interface SecurityOptions {
  env: Pick<Env, 'NODE_ENV' | 'CORS_ORIGINS'>;
}

/** Request id echo, CORS allow-list and security headers. */
async function security(app: FastifyInstance, { env }: SecurityOptions) {
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 600,
  });

  await app.register(helmet, {
    // The API serves JSON only; the API docs UI (non-production) needs inline scripts.
    contentSecurityPolicy: env.NODE_ENV === 'production',
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
}

export const securityPlugin = fp(security, { name: 'security', fastify: '5.x' });
