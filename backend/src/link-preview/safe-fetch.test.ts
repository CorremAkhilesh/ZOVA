import { gzipSync } from 'node:zlib';
import { brand } from '@zuvo/config';
import { afterEach, describe, expect, it } from 'vitest';
import { pinnedLookup } from './http-request.ts';
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

async function okServer() {
  server = await startServer((_request, response) => sendHtml(response, '<title>Hi</title>'));
  return server;
}

describe('safeFetch — URL checks', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/file',
    'data:text/html,<title>x</title>',
    'javascript:alert(1)',
    'gopher://example.com:70/1',
    'ws://example.com/',
    'not a url',
    `https://example.com/${'a'.repeat(2100)}`,
  ])('rejects %s as invalid_url', async (url) => {
    const result = await safeFetch(url, { resolve: fakeResolver({}) });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_url' });
  });

  it('rejects credentials in the URL', async () => {
    for (const url of ['http://user:pass@example.com/', 'http://user@example.com/']) {
      expect(await safeFetch(url)).toMatchObject({ ok: false, reason: 'invalid_url' });
    }
  });

  it('rejects well-known non-web ports by default, and allows a custom port policy', async () => {
    expect(await safeFetch('http://example.com:25/')).toMatchObject({ reason: 'invalid_url' });
    const s = await okServer();
    const strict = await safeFetch(s.url('/'), localOptions({ isAllowedPort: (p) => p === 443 }));
    expect(strict).toMatchObject({ ok: false, reason: 'invalid_url' });
  });

  it.each([
    'http://localhost/',
    'http://LOCALHOST./',
    'http://admin.localhost/',
    'http://printer.local/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://intranet/',
  ])('blocks the local host name %s without resolving it', async (url) => {
    const resolve = fakeResolver({});
    expect(await safeFetch(url, { resolve })).toMatchObject({ ok: false, reason: 'blocked' });
    expect(resolve.calls).toEqual([]);
  });

  it.each([
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://127.1/',
    'http://0/',
    'http://10.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
  ])('blocks the IP literal %s (any notation)', async (url) => {
    const resolve = fakeResolver({});
    expect(await safeFetch(url, { resolve })).toMatchObject({ ok: false, reason: 'blocked' });
    expect(resolve.calls).toEqual([]);
  });
});

describe('safeFetch — default policy blocks loopback', () => {
  it('never connects to a local server by IP literal', async () => {
    const s = await okServer();
    const result = await safeFetch(`http://127.0.0.1:${s.port}/`);
    expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    expect(s.connections()).toBe(0);
  });

  it('never connects when a public-looking name resolves to loopback', async () => {
    const s = await okServer();
    const resolve = fakeResolver({ 'site.test': ['127.0.0.1'] });
    expect(await safeFetch(s.url('/'), { resolve })).toMatchObject({ reason: 'blocked' });
    expect(s.connections()).toBe(0);
  });

  it('refuses a host when any one of its addresses is private', async () => {
    const s = await okServer();
    const resolve = fakeResolver({ 'site.test': ['8.8.8.8', '10.0.0.5', '2606:4700::1'] });
    const result = await safeFetch(s.url('/'), { resolve });
    expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    expect(s.connections()).toBe(0);
  });

  it('reports a failed DNS lookup as network', async () => {
    const result = await safeFetch('http://nowhere.test/', { resolve: fakeResolver({}) });
    expect(result).toMatchObject({ ok: false, reason: 'network' });
  });
});

describe('safeFetch — DNS rebinding', () => {
  it('connects to the address that was checked, never re-resolving the name', async () => {
    const s = await okServer();
    let calls = 0;
    // First answer passes the check; any later answer (the rebinding) is a private address.
    const resolve = async () => (++calls === 1 ? ['127.0.0.1'] : ['10.0.0.1']);
    const result = await safeFetch(s.url('/'), localOptions({ resolve }));
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(calls).toBe(1);
    expect(s.connections()).toBe(1);
  });

  it('pins the socket lookup to the checked address whatever hostname is asked', async () => {
    const lookup = pinnedLookup('93.184.216.34', 4);
    const single = await new Promise<unknown[]>((resolve) =>
      lookup('attacker.test', {}, (...args) => resolve(args)),
    );
    expect(single).toEqual([null, '93.184.216.34', 4]);
    const all = await new Promise<unknown[]>((resolve) =>
      lookup('attacker.test', { all: true }, (...args) => resolve(args)),
    );
    expect(all).toEqual([null, [{ address: '93.184.216.34', family: 4 }]]);
  });
});

describe('safeFetch — requests', () => {
  it('sends the brand User-Agent, Accept and the original Host header', async () => {
    const s = await okServer();
    const result = await safeFetch(s.url('/page'), localOptions());
    expect(result).toMatchObject({ ok: true, url: s.url('/page'), mimeType: 'text/html' });
    const headers = s.lastHeaders();
    expect(headers?.['user-agent']).toContain(`${brand.name}LinkPreview/1.0`);
    expect(headers?.accept).toBe('text/html,application/xhtml+xml');
    expect(headers?.host).toBe(`site.test:${s.port}`);
  });

  it('reports 404 and 500 as http_error with the status', async () => {
    server = await startServer((request, response) => {
      response.writeHead(request.url === '/missing' ? 404 : 500).end('nope');
    });
    const missing = await safeFetch(server.url('/missing'), localOptions());
    expect(missing).toMatchObject({ ok: false, reason: 'http_error', status: 404 });
    const broken = await safeFetch(server.url('/boom'), localOptions());
    expect(broken).toMatchObject({ ok: false, reason: 'http_error', status: 500 });
  });

  it('refuses a content type the caller does not accept, before reading the body', async () => {
    const s = await okServer();
    const result = await safeFetch(
      s.url('/'),
      localOptions({ acceptContentType: (type) => type === 'application/json' }),
    );
    expect(result).toMatchObject({ ok: false, reason: 'content_type' });
  });

  it('decompresses gzip bodies', async () => {
    server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
      response.end(gzipSync('<title>Zipped</title>'));
    });
    const result = await safeFetch(server.url('/'), localOptions());
    expect(result.ok && result.body.toString()).toBe('<title>Zipped</title>');
  });

  it('refuses an unknown content encoding', async () => {
    server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'zstd-ish' });
      response.end('???');
    });
    expect(await safeFetch(server.url('/'), localOptions())).toMatchObject({ reason: 'network' });
  });

  it('reports a refused connection as network', async () => {
    const s = await okServer();
    const { port } = s;
    await s.close();
    server = undefined;
    const result = await safeFetch(`http://site.test:${port}/`, localOptions());
    expect(result).toMatchObject({ ok: false, reason: 'network' });
  });

  it('reports a cancelled request as network', async () => {
    const s = await okServer();
    const controller = new AbortController();
    controller.abort();
    const result = await safeFetch(s.url('/'), localOptions({ signal: controller.signal }));
    expect(result).toMatchObject({ ok: false, reason: 'network' });
  });
});
