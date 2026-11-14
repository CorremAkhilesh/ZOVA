import cors from '@fastify/cors';
import { apiSecurityHeaders } from '@zuvo/config';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.ts';

interface SecurityOptions {
  env: Pick<Env, 'NODE_ENV' | 'CORS_ORIGINS'>;
}

/** The API docs UI (non-production only) is a page with inline scripts: it keeps no CSP. */
const DOCS_PREFIX = '/docs';

/**
 * Request id echo, CORS allow-list and the security headers from @zuvo/config (one source of truth
 * shared with the web app and the Nginx snippet). A header a route already set wins: media files
 * send a stricter sandbox CSP of their own.
 */
async function security(app: FastifyInstance, { env }: SecurityOptions) {
  const production = env.NODE_ENV === 'production';
  const headers = Object.entries(apiSecurityHeaders({ production }));

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    const docs = !production && request.url.startsWith(DOCS_PREFIX);
    for (const [name, value] of headers) {
      if (docs && name === 'Content-Security-Policy') continue;
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 600,
  });
}

export const securityPlugin = fp(security, { name: 'security', fastify: '5.x' });
