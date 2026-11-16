import type { FastifyInstance } from 'fastify';

/** One registered route, as `METHOD /path` (HEAD and the CORS preflight left out). */
export interface RouteEntry {
  method: string;
  url: string;
}

const LINE = /^((?:│ {3}| {4})*)(?:├── |└── )(.*?)(?: \(([A-Z, ]+)\))?$/;

/**
 * Every route of a built app, read from Fastify's route tree (`printRoutes`): each line is a path
 * segment, nested under its parent by indentation, with the methods that end there.
 */
export function routeTable(app: FastifyInstance): RouteEntry[] {
  const tree = app.printRoutes({ commonPrefix: false, includeHooks: false });
  const stack: string[] = [];
  const routes: RouteEntry[] = [];
  for (const line of tree.split('\n')) {
    const match = LINE.exec(line);
    if (!match) continue;
    const depth = (match[1] ?? '').length / 4;
    stack.length = depth;
    stack.push(match[2] ?? '');
    const url = stack.join('');
    for (const method of (match[3] ?? '').split(', ')) {
      if (!method || method === 'HEAD' || method === 'OPTIONS') continue;
      routes.push({ method, url });
    }
  }
  return routes.sort((a, b) => key(a).localeCompare(key(b)));
}

export const key = (route: RouteEntry) => `${route.method} ${route.url}`;

/** A concrete URL for a route: each `:param` becomes a well-formed id nobody owns. */
export function sampleUrl(url: string): string {
  return url.replace(/:([A-Za-z]+)/g, (_, name: string) => SAMPLE_PARAMS[name] ?? SAMPLE_ID);
}

const SAMPLE_ID = '0123456789abcdef01234567';
const SAMPLE_PARAMS: Record<string, string> = {
  // Invite codes are 16–64 URL-safe characters; every other id is an ObjectId.
  code: 'AbCdEfGhIjKlMnOpQr',
};

/** Routes registered only when NODE_ENV=test (E2E and test helpers). Never in production. */
export const TEST_ONLY_ROUTES = [
  'GET /v1/test/outbox/latest',
  'POST /v1/test/reset-otp-limits',
  'POST /v1/test/promote',
  'POST /v1/test/seed-messages',
  'POST /v1/test/expire-messages',
  'POST /v1/test/run-scheduled',
  'GET /v1/test/push/outbox',
  'DELETE /v1/test/push/outbox',
] as const;
