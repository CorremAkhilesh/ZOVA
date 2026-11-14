import { describe, expect, it } from 'vitest';
import { nginxSecurityHeaders } from './nginx-snippet.ts';
import {
  apiSecurityHeaders,
  appCsp,
  appSecurityHeaders,
  HSTS_VALUE,
  permissionsPolicy,
} from './security-headers.ts';

/** The directive's sources, e.g. `script-src` → ["'self'"]. */
function directive(csp: string, name: string): string[] | undefined {
  const found = csp
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name);
  return found?.slice(1);
}

describe('app CSP', () => {
  const csp = appCsp({ production: true });

  it('runs only our own scripts: no inline script, no eval', () => {
    expect(directive(csp, 'script-src')).toEqual(["'self'"]);
    expect(csp).not.toContain('unsafe-eval');
  });

  it('cannot be framed, has no plugins and keeps base and forms on our origin', () => {
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
  });

  it('allows blob: only for images and media, and talks only to its own origin', () => {
    expect(directive(csp, 'img-src')).toEqual(["'self'", 'blob:', 'data:']);
    expect(directive(csp, 'media-src')).toEqual(["'self'", 'blob:']);
    expect(directive(csp, 'connect-src')).toEqual(["'self'"]);
    expect(directive(csp, 'worker-src')).toEqual(["'self'"]);
    expect(directive(csp, 'manifest-src')).toEqual(["'self'"]);
  });

  it('upgrades insecure requests only in production', () => {
    expect(directive(csp, 'upgrade-insecure-requests')).toEqual([]);
    expect(appCsp({ production: false })).not.toContain('upgrade-insecure-requests');
  });

  it('relaxes script-src only for the Vite dev server', () => {
    expect(directive(appCsp({ production: false, devServer: true }), 'script-src')).toEqual([
      "'self'",
      "'unsafe-inline'",
    ]);
  });
});

describe('security headers', () => {
  it('sends HSTS only in production', () => {
    expect(appSecurityHeaders({ production: true })['Strict-Transport-Security']).toBe(HSTS_VALUE);
    expect(appSecurityHeaders({ production: false })).not.toHaveProperty(
      'Strict-Transport-Security',
    );
    expect(apiSecurityHeaders({ production: false })).not.toHaveProperty(
      'Strict-Transport-Security',
    );
  });

  it('allows the microphone and camera to our origin only, and nothing else powerful', () => {
    const policy = permissionsPolicy();
    expect(policy).toContain('microphone=(self)');
    expect(policy).toContain('camera=(self)');
    expect(policy).toContain('geolocation=()');
    expect(policy).toContain('payment=()');
  });

  it('gives the API a CSP that loads nothing', () => {
    const csp = apiSecurityHeaders({ production: true })['Content-Security-Policy'] ?? '';
    expect(directive(csp, 'default-src')).toEqual(["'none'"]);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
  });

  it('isolates the app and the API from other origins', () => {
    for (const headers of [
      appSecurityHeaders({ production: true }),
      apiSecurityHeaders({ production: true }),
    ]) {
      expect(headers).toMatchObject({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
    }
  });
});

describe('Nginx snippet', () => {
  it('sets every production app header with `always`', () => {
    const snippet = nginxSecurityHeaders();
    for (const [name, value] of Object.entries(appSecurityHeaders({ production: true }))) {
      expect(snippet).toContain(`add_header ${name} "${value}" always;`);
    }
  });
});
