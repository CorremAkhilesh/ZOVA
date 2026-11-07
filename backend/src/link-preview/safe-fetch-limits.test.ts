import type { ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { safeFetch } from './safe-fetch.ts';
import {
  fakeResolver,
  localOptions,
  sendHtml,
  startServer,
  type TestServer,
} from './test-server.ts';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function redirect(response: ServerResponse, location: string, status = 302) {
  response.writeHead(status, { Location: location }).end();
}

describe('safeFetch — redirects', () => {
  /** Path → Location (null: a 302 without Location). */
  const redirects = (port: number): Record<string, string | null> => ({
    '/to-private': 'http://10.0.0.1/admin',
    '/to-metadata': 'http://169.254.169.254/latest/',
    '/to-localhost': `http://localhost:${port}/`,
    '/to-evil': 'http://evil.test/',
    '/to-ipv6-loopback': `http://[::1]:${port}/`,
    '/to-file': 'file:///etc/passwd',
    '/no-location': null,
    '/a/b/relative': '../target?x=1',
  });

  async function redirectServer() {
    server = await startServer((request, response) => {
      const url = request.url ?? '/';
      const hop = /^\/chain\/(\d+)$/.exec(url);
      const left = Number(hop?.[1] ?? 0);
      if (hop && left > 0) return redirect(response, `/chain/${left - 1}`);
      const location = redirects(server?.port ?? 0)[url];
      if (location === null) return response.writeHead(302).end();
      if (location !== undefined) return redirect(response, location, 301);
      sendHtml(response, `page ${url}`);
    });
    return server;
  }

  const options = () =>
    localOptions({
      resolve: fakeResolver({ 'site.test': ['127.0.0.1'], 'evil.test': ['192.168.0.10'] }),
    });

  it('follows up to 3 redirects and reports the final URL', async () => {
    const s = await redirectServer();
    const result = await safeFetch(s.url('/chain/3'), options());
    expect(result).toMatchObject({ ok: true, url: s.url('/chain/0') });
    expect(s.paths).toEqual(['/chain/3', '/chain/2', '/chain/1', '/chain/0']);
  });

  it('stops a chain longer than 3 with too_many_redirects', async () => {
    const s = await redirectServer();
    const result = await safeFetch(s.url('/chain/4'), options());
    expect(result).toMatchObject({ ok: false, reason: 'too_many_redirects' });
    expect(s.paths).toHaveLength(4);
  });

  it('honours a custom redirect limit', async () => {
    const s = await redirectServer();
    const none = await safeFetch(s.url('/chain/1'), { ...options(), maxRedirects: 0 });
    expect(none).toMatchObject({ ok: false, reason: 'too_many_redirects' });
  });

  it('resolves a relative Location against the current URL', async () => {
    const s = await redirectServer();
    const result = await safeFetch(s.url('/a/b/relative'), options());
    expect(result).toMatchObject({ ok: true, url: s.url('/a/target?x=1') });
  });

  it.each([
    ['/to-private', 'blocked'],
    ['/to-metadata', 'blocked'],
    ['/to-localhost', 'blocked'],
    ['/to-evil', 'blocked'],
    ['/to-ipv6-loopback', 'blocked'],
    ['/to-file', 'invalid_url'],
    ['/no-location', 'http_error'],
  ])('re-checks every hop: %s → %s', async (path, reason) => {
    const s = await redirectServer();
    const result = await safeFetch(s.url(path), options());
    expect(result).toMatchObject({ ok: false, reason });
    expect(s.paths).toEqual([path]);
  });
});

/** Streams `total` bytes in 64 KB chunks; resolves `aborted` with true if the client hung up. */
function streamingServer(total: number, headers: Record<string, string | number>) {
  let aborted: (value: boolean) => void = () => {};
  const done = new Promise<boolean>((resolve) => {
    aborted = resolve;
  });
  const start = startServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', ...headers });
    let sent = 0;
    const chunk = Buffer.alloc(64 * 1024, 'a');
    const pump = () => {
      while (sent < total) {
        sent += chunk.length;
        if (!response.write(chunk)) return void response.once('drain', pump);
      }
      response.end();
    };
    response.on('close', () => aborted(!response.writableFinished));
    pump();
  });
  return { start, aborted: done };
}

describe('safeFetch — size limit', () => {
  it('aborts a body that grows past the limit without Content-Length', async () => {
    const big = streamingServer(20 * 1024 * 1024, {});
    server = await big.start;
    const result = await safeFetch(server.url('/'), localOptions({ maxBytes: 256 * 1024 }));
    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
    expect(await big.aborted).toBe(true);
  });

  it('refuses early when Content-Length is over the limit', async () => {
    const big = streamingServer(4 * 1024 * 1024, { 'Content-Length': 4 * 1024 * 1024 });
    server = await big.start;
    const result = await safeFetch(server.url('/'), localOptions());
    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
    expect(await big.aborted).toBe(true);
  });

  it('counts decompressed bytes (gzip bomb)', async () => {
    const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024));
    server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
      response.end(bomb);
    });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const result = await safeFetch(server.url('/'), localOptions());
    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
  });

  it('accepts a body exactly at the limit', async () => {
    server = await startServer((_request, response) => sendHtml(response, 'x'.repeat(1000)));
    const result = await safeFetch(server.url('/'), localOptions({ maxBytes: 1000 }));
    expect(result).toMatchObject({ ok: true });
  });
});

describe('safeFetch — timeouts', () => {
  it('times out a server that never answers', async () => {
    server = await startServer(() => {});
    const started = Date.now();
    const result = await safeFetch(server.url('/'), localOptions({ timeoutMs: 300 }));
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('times out a body that never finishes', async () => {
    server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.write('<html><head><title>Slow');
    });
    const started = Date.now();
    const result = await safeFetch(server.url('/'), localOptions({ timeoutMs: 300 }));
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('times out a DNS lookup that hangs', async () => {
    const resolve = () => new Promise<string[]>(() => {});
    const result = await safeFetch('http://slow-dns.test/', { resolve, timeoutMs: 200 });
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });
});
