import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.ts';
import { AppError } from '../lib/errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Fetch Metadata values a browser sends for a request that another site started. */
const FOREIGN_SITES = new Set(['cross-site', 'same-site']);

interface OriginCheckOptions {
  env: Pick<Env, 'APP_URL' | 'CORS_ORIGINS'>;
}

/** The origins our own app runs on (the same list Better Auth and the socket handshake trust). */
export function allowedOrigins(env: Pick<Env, 'APP_URL' | 'CORS_ORIGINS'>): Set<string> {
  return new Set([env.APP_URL, ...env.CORS_ORIGINS].map((url) => new URL(url).origin));
}

/**
 * Whether a state-changing request may run. Browsers always send `Origin` on a cross-origin
 * POST/PUT/PATCH/DELETE (and modern ones on same-origin POSTs too), so:
 * - an `Origin` must be one of ours (`null`, from sandboxed frames or redirects, never is);
 * - without `Origin`, a browser's `Sec-Fetch-Site` must not say another site started it;
 * - with neither, it is not a browser (curl, health probes, server-to-server): no ambient
 *   cookies to abuse, so it is allowed and still needs a session like any other request.
 */
export function isAllowedOrigin(request: FastifyRequest, origins: Set<string>): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  const { origin } = request.headers;
  if (origin !== undefined) return origins.has(origin);
  const site = request.headers['sec-fetch-site'];
  return typeof site !== 'string' || !FOREIGN_SITES.has(site);
}

/**
 * CSRF defence for every state-changing route, not only Better Auth's: SameSite=Lax cookies are
 * still sent by sibling subdomains (same site), and CORS alone does not stop "simple" requests
 * such as a cross-site multipart form post. Runs before authentication, parsing and validation.
 */
async function originCheck(app: FastifyInstance, { env }: OriginCheckOptions) {
  const origins = allowedOrigins(env);
  app.addHook('onRequest', async (request) => {
    if (isAllowedOrigin(request, origins)) return;
    request.log.warn(
      { origin: request.headers.origin ?? null, site: request.headers['sec-fetch-site'] ?? null },
      'request refused: origin not allowed',
    );
    throw new AppError('FORBIDDEN', 'This request did not come from the app.');
  });
}

export const originCheckPlugin = fp(originCheck, { name: 'origin-check', fastify: '5.x' });
