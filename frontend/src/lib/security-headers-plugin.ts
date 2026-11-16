import type { IncomingMessage, ServerResponse } from 'node:http';
import { appSecurityHeaders, type HeaderMap } from '@zuvo/config';
import type { Plugin } from 'vite';

/** Proxied to the API, which sets its own (stricter) headers. */
const API_PATHS = ['/v1/', '/socket.io/'];

export const isApiPath = (url: string | undefined) =>
  API_PATHS.some((prefix) => (url ?? '').startsWith(prefix));

function middleware(headers: HeaderMap) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!isApiPath(request.url)) {
      for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    }
    next();
  };
}

/**
 * Sends the app's security headers (@zuvo/config, the same source as the Nginx snippet) from
 * `vite preview` — the exact production policy minus HSTS/upgrade-insecure-requests, which need
 * HTTPS — so E2E runs the built app under the real CSP. `vite dev` adds only what React Refresh
 * needs (an inline preamble script). Read by vite.config.ts in Node; never part of the bundle.
 */
export function securityHeaders(): Plugin {
  return {
    name: 'zuvo-security-headers',
    configureServer(server) {
      server.middlewares.use(
        middleware(appSecurityHeaders({ production: false, devServer: true })),
      );
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(appSecurityHeaders({ production: false })));
    },
  };
}
