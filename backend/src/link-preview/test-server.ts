import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ResolveHost, SafeFetchOptions } from './types.ts';

/** Test-only helpers: a local HTTP server and options that let safeFetch reach it. */

export interface TestServer {
  port: number;
  /** URL on the fake public host `site.test`, which the test resolver maps to 127.0.0.1. */
  url: (path: string) => string;
  /** TCP connections accepted so far. */
  connections: () => number;
  /** Paths requested so far. */
  paths: string[];
  /** User-Agent / Host headers of the last request. */
  lastHeaders: () => IncomingMessage['headers'] | null;
  close: () => Promise<void>;
}

export type Handler = (request: IncomingMessage, response: ServerResponse) => void;

export async function startServer(handler: Handler): Promise<TestServer> {
  let connections = 0;
  let lastHeaders: IncomingMessage['headers'] | null = null;
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? '');
    lastHeaders = request.headers;
    handler(request, response);
  });
  server.on('connection', () => {
    connections++;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    url: (path) => `http://site.test:${port}${path}`,
    connections: () => connections,
    paths,
    lastHeaders: () => lastHeaders,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Fake DNS: test host names → addresses. Unknown names fail like NXDOMAIN. */
export function fakeResolver(table: Record<string, string[]>): ResolveHost & {
  calls: string[];
} {
  const calls: string[] = [];
  const resolve = async (hostname: string) => {
    calls.push(hostname);
    const answer = table[hostname];
    if (!answer) throw new Error(`ENOTFOUND ${hostname}`);
    return answer;
  };
  return Object.assign(resolve, { calls });
}

/**
 * Options under which 127.0.0.1 (and only 127.0.0.1) counts as a public address, so tests can
 * talk to a local server. The default policy blocks it — see the safe-fetch tests.
 */
export function localOptions(extra: SafeFetchOptions = {}): SafeFetchOptions {
  return {
    resolve: fakeResolver({ 'site.test': ['127.0.0.1'] }),
    isAllowedAddress: (address) => address === '127.0.0.1',
    timeoutMs: 5_000,
    ...extra,
  };
}

export function sendHtml(response: ServerResponse, html: string | Buffer, contentType?: string) {
  response.writeHead(200, { 'Content-Type': contentType ?? 'text/html; charset=utf-8' });
  response.end(html);
}
