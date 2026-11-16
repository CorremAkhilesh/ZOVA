/**
 * HTTP security headers: the ONE source of truth (docs/security.md §Transport and headers).
 *
 * - The API sets `apiSecurityHeaders` on every response (backend/src/plugins/security.ts).
 * - `vite dev` and `vite preview` send `appSecurityHeaders` (frontend/vite.config.ts), so E2E runs
 *   the app under the real CSP.
 * - In production the static app is served by Nginx, which includes
 *   infra/nginx/security-headers.conf — generated from this file by `pnpm security:nginx`, never
 *   edited by hand (a test fails when it is out of date).
 */

export type HeaderMap = Readonly<Record<string, string>>;
export type CspDirectives = Readonly<Record<string, readonly string[]>>;

export interface SecurityHeaderOptions {
  /** Served over HTTPS in production: adds HSTS and `upgrade-insecure-requests`. */
  production: boolean;
}

export interface AppHeaderOptions extends SecurityHeaderOptions {
  /**
   * The Vite dev server only: its React Refresh preamble is an inline script. Never set for a
   * build — `vite preview` and Nginx serve the strict policy.
   */
  devServer?: boolean;
}

/**
 * What the web app really loads.
 * - Scripts: only our own files. No inline scripts (the pre-paint theme script is
 *   public/theme-init.js), no eval.
 * - Styles: our CSS files plus `'unsafe-inline'`, because Radix (react-remove-scroll), Sonner and
 *   react-easy-crop inject `<style>` elements at runtime. Inline styles cannot run script; React
 *   escapes all user text, so CSS injection needs an HTML injection first, which script-src blocks.
 * - Images: our files, `blob:` (local previews before upload, view-once files) and `data:` (blur
 *   placeholders and SVG wallpaper patterns). Media: our files and `blob:` (voice recordings).
 * - Connections: same origin only. CSP3 `'self'` also matches ws:/wss: to the same host, which is
 *   what Socket.IO uses. Link previews and their pictures are fetched by our server, never by the app.
 */
const APP_DIRECTIVES: CspDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'blob:', 'data:'],
  'media-src': ["'self'", 'blob:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  'frame-src': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};

/** The API returns JSON and files, never pages: nothing may load, run or frame. */
const API_DIRECTIVES: CspDirectives = {
  'default-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
};

/** Powerful features: only the microphone and camera (voice notes, photos, later calls). */
const PERMISSIONS_POLICY: Readonly<Record<string, string>> = {
  microphone: '(self)',
  camera: '(self)',
  'display-capture': '()',
  geolocation: '()',
  payment: '()',
  usb: '()',
  serial: '()',
  hid: '()',
  midi: '()',
  accelerometer: '()',
  gyroscope: '()',
  magnetometer: '()',
  'xr-spatial-tracking': '()',
  'publickey-credentials-get': '(self)',
  fullscreen: '(self)',
  'picture-in-picture': '(self)',
  'screen-wake-lock': '(self)',
};

/** Two years. Only ever sent by HTTPS deployments; no `preload` (that is a separate, sticky decision). */
export const HSTS_VALUE = 'max-age=63072000; includeSubDomains';

export function serializeCsp(directives: CspDirectives, production: boolean): string {
  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (production) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

export function appCsp({ production, devServer = false }: AppHeaderOptions): string {
  if (!devServer) return serializeCsp(APP_DIRECTIVES, production);
  const scripts = [...(APP_DIRECTIVES['script-src'] ?? []), "'unsafe-inline'"];
  return serializeCsp({ ...APP_DIRECTIVES, 'script-src': scripts }, production);
}

export const apiCsp = ({ production }: SecurityHeaderOptions): string =>
  serializeCsp(API_DIRECTIVES, production);

export const permissionsPolicy = (): string =>
  Object.entries(PERMISSIONS_POLICY)
    .map(([feature, allow]) => `${feature}=${allow}`)
    .join(', ');

function commonHeaders(production: boolean): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': permissionsPolicy(),
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Everything (app, API, media) is same-origin behind Nginx; no other site may embed our bytes.
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'X-Permitted-Cross-Domain-Policies': 'none',
    ...(production ? { 'Strict-Transport-Security': HSTS_VALUE } : {}),
  };
}

/** Headers for the web app's pages and static files. */
export function appSecurityHeaders(options: AppHeaderOptions): HeaderMap {
  return { 'Content-Security-Policy': appCsp(options), ...commonHeaders(options.production) };
}

/** Headers for every API response. A route may set a stricter CSP of its own (media files). */
export function apiSecurityHeaders({ production }: SecurityHeaderOptions): HeaderMap {
  return { 'Content-Security-Policy': apiCsp({ production }), ...commonHeaders(production) };
}
