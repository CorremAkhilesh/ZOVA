import { readFile } from 'node:fs/promises';
import { apiSecurityHeaders, NGINX_SNIPPET_PATH, nginxSecurityHeaders } from '@zuvo/config';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../test/helpers.ts';
import { securityPlugin } from './security.ts';

const lower = (headers: Record<string, string>) =>
  Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));

async function bareApp(nodeEnv: 'development' | 'production') {
  const app = Fastify();
  await app.register(securityPlugin, {
    env: { NODE_ENV: nodeEnv, CORS_ORIGINS: ['http://localhost:5173'] },
  });
  app.get('/v1/thing', async () => ({ ok: true }));
  app.get('/v1/file', async (_request, reply) =>
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox").send('bytes'),
  );
  app.get('/docs', async (_request, reply) => reply.type('text/html').send('<p>docs</p>'));
  await app.ready();
  return app;
}

describe('security headers on API responses', () => {
  it('sends every header from @zuvo/config, without HSTS outside production', async () => {
    const app = await bareApp('development');
    const response = await app.inject({ method: 'GET', url: '/v1/thing' });
    expect(response.headers).toMatchObject(lower(apiSecurityHeaders({ production: false })));
    expect(response.headers).not.toHaveProperty('strict-transport-security');
    await app.close();
  });

  it('adds HSTS and upgrade-insecure-requests in production', async () => {
    const app = await bareApp('production');
    const response = await app.inject({ method: 'GET', url: '/v1/thing' });
    expect(response.headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains',
    );
    expect(response.headers['content-security-policy']).toContain('upgrade-insecure-requests');
    await app.close();
  });

  it('also covers errors (404)', async () => {
    const app = await bareApp('development');
    const response = await app.inject({ method: 'GET', url: '/v1/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-frame-options']).toBe('DENY');
    await app.close();
  });

  it("keeps a route's own stricter CSP (media files are sandboxed)", async () => {
    const app = await bareApp('development');
    const response = await app.inject({ method: 'GET', url: '/v1/file' });
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('leaves the non-production API docs page without a CSP, but with the other headers', async () => {
    const app = await bareApp('development');
    const response = await app.inject({ method: 'GET', url: '/docs' });
    expect(response.headers).not.toHaveProperty('content-security-policy');
    expect(response.headers['x-frame-options']).toBe('DENY');
    await app.close();
  });
});

describe('security headers on the real app', () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  beforeAll(async () => {
    ctx = await buildTestApp();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  it.each([
    ['public', '/v1/health'],
    ['unauthenticated', '/v1/auth/me'],
  ])('are on a %s response', async (_kind, url) => {
    const response = await ctx.app.inject({ method: 'GET', url });
    expect(response.headers).toMatchObject(lower(apiSecurityHeaders({ production: false })));
  });
});

describe('Nginx snippet', () => {
  it('is up to date with @zuvo/config (run `pnpm security:nginx`)', async () => {
    const onDisk = await readFile(
      new URL(`../../../${NGINX_SNIPPET_PATH}`, import.meta.url),
      'utf8',
    );
    expect(onDisk.replaceAll('\r\n', '\n')).toBe(nginxSecurityHeaders());
  });
});
