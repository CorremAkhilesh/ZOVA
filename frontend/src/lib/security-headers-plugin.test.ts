import type { IncomingMessage, ServerResponse } from 'node:http';
import { appCsp } from '@zuvo/config';
import type { PreviewServer, ViteDevServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { isApiPath, securityHeaders } from './security-headers-plugin.ts';

type Handler = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

/** Runs the middleware the plugin installs and returns the headers it set. */
function headersFor(hook: 'configureServer' | 'configurePreviewServer', url: string) {
  let handler: Handler | undefined;
  const server = { middlewares: { use: (fn: Handler) => (handler = fn) } };
  const plugin = securityHeaders();
  if (hook === 'configureServer') {
    (plugin.configureServer as (s: ViteDevServer) => void)(server as unknown as ViteDevServer);
  } else {
    (plugin.configurePreviewServer as (s: PreviewServer) => void)(
      server as unknown as PreviewServer,
    );
  }
  const set = new Map<string, string>();
  const response = { setHeader: (name: string, value: string) => set.set(name, value) };
  const next = vi.fn();
  handler?.({ url } as IncomingMessage, response as unknown as ServerResponse, next);
  expect(next).toHaveBeenCalledOnce();
  return set;
}

describe('securityHeaders (Vite plugin)', () => {
  it('serves the strict production CSP from vite preview, without HTTPS-only parts', () => {
    const headers = headersFor('configurePreviewServer', '/chats');
    expect(headers.get('Content-Security-Policy')).toBe(appCsp({ production: false }));
    expect(headers.get('Content-Security-Policy')).toContain("script-src 'self';");
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.has('Strict-Transport-Security')).toBe(false);
  });

  it('lets only the dev server run the React Refresh inline preamble', () => {
    const headers = headersFor('configureServer', '/');
    expect(headers.get('Content-Security-Policy')).toContain("script-src 'self' 'unsafe-inline'");
  });

  it('leaves proxied API responses to the API', () => {
    expect(headersFor('configurePreviewServer', '/v1/auth/me').size).toBe(0);
    expect(headersFor('configurePreviewServer', '/socket.io/?EIO=4').size).toBe(0);
  });

  it('recognises API paths', () => {
    expect(isApiPath('/v1/config')).toBe(true);
    expect(isApiPath('/v1')).toBe(false);
    expect(isApiPath('/v1x')).toBe(false);
    expect(isApiPath(undefined)).toBe(false);
  });
});
