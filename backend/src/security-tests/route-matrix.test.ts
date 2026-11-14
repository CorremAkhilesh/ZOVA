import { readFileSync } from 'node:fs';
import { clientToServerEvents } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers, signIn } from '../../test/auth-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import { key, routeTable, sampleUrl, TEST_ONLY_ROUTES } from './route-table.ts';

/**
 * The security review's route matrix (docs/security-routes.md) is complete, and every route keeps
 * the basics: a session where one is required, the CSRF origin check, and validated ids.
 * A new route fails the first test until it is reviewed and listed in the matrix.
 */
const MATRIX = readFileSync(new URL('../../../docs/security-routes.md', import.meta.url), 'utf8');

interface Row {
  route: string;
  auth: string;
}
const rows: Row[] = [
  ...MATRIX.matchAll(/^\| `((?:GET|POST|PUT|PATCH|DELETE) \/[^`]*)` *\| ([^|]+)\|/gm),
].map((match) => ({ route: match[1] ?? '', auth: (match[2] ?? '').trim() }));
const events = [...MATRIX.matchAll(/^\| `([a-z]+:[a-z-]+)` *\|/gm)].map((match) => match[1]);
const authOf = new Map(rows.map((row) => [row.route, row.auth]));
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EVIL = 'https://evil.example';

/** Signing several people in through the real OTP flow is slow on a busy machine. */
const SETUP_TIMEOUT = 600_000;
let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
beforeAll(async () => {
  built = await buildTestApp();
}, SETUP_TIMEOUT);
afterAll(async () => {
  await built.cleanup();
});

const routes = () => routeTable(app()).filter((route) => !route.url.startsWith('/docs'));
const send = (method: string, url: string, extra: Record<string, string>) =>
  app().inject({
    method: method as 'GET',
    url,
    headers: extra,
    ...(UNSAFE.has(method) && method !== 'DELETE' ? { payload: {} } : {}),
  });

describe('route matrix', () => {
  it('lists every route exactly once, with a known auth level', () => {
    const registered = routes().map(key);
    const listed = rows.map((row) => row.route);
    expect(new Set(listed).size, 'a route is listed twice').toBe(listed.length);
    expect([...listed].sort()).toEqual([...registered].sort());
    const levels = new Set(['public', 'session', 'admin', 'session or signed link', 'test only']);
    expect(rows.filter((row) => !levels.has(row.auth))).toEqual([]);
    // Test-only routes are exactly the ones a production build must not have.
    expect(
      rows
        .filter((row) => row.auth === 'test only')
        .map((row) => row.route)
        .sort(),
    ).toEqual([...TEST_ONLY_ROUTES].sort());
  });

  it('lists every client → server socket event', () => {
    expect([...events].sort()).toEqual(Object.keys(clientToServerEvents).sort());
  });
});

describe('every route', () => {
  it('needs a session unless the matrix says it is public', async () => {
    const failures: string[] = [];
    for (const route of routes()) {
      const auth = authOf.get(key(route));
      if (auth === 'public' || auth === 'test only') continue;
      const response = await send(route.method, sampleUrl(route.url), headers());
      if (response.statusCode !== 401) failures.push(`${key(route)} → ${response.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('refuses a state change from another origin before anything else (CSRF)', async () => {
    const { cookie } = await signIn(app(), 'csrf-sweep@corremadvisory.com');
    const failures: string[] = [];
    for (const route of routes().filter((one) => UNSAFE.has(one.method))) {
      for (const extra of [{ origin: EVIL }, { 'sec-fetch-site': 'cross-site' }]) {
        const response = await send(route.method, sampleUrl(route.url), { cookie, ...extra });
        if (response.statusCode !== 403 || response.json().code !== 'FORBIDDEN') {
          failures.push(`${key(route)} ${JSON.stringify(extra)} → ${response.statusCode}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('rejects malformed ids without touching anything (400/404, admin routes 403)', async () => {
    const { cookie } = await signIn(app(), 'ids-sweep@corremadvisory.com');
    const failures: string[] = [];
    for (const route of routes().filter((one) => one.url.includes(':'))) {
      const url = route.url.replace(/:[A-Za-z]+/g, 'not-an-id!');
      const response = await send(route.method, url, headers(cookie));
      const allowed = authOf.get(key(route)) === 'admin' ? [403] : [400, 404];
      if (!allowed.includes(response.statusCode)) {
        failures.push(`${key(route)} → ${response.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
