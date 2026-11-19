# Nginx: security headers

Production runs on a shared company server behind Nginx + Certbot (HTTP/2). The host Nginx proxies
the app to the web container and `/v1` + `/socket.io` to the API, all on one origin.

The security headers are part of the app, not of the server config:

| Responses                 | Who sets the headers                                                  |
| ------------------------- | --------------------------------------------------------------------- |
| `/v1/*` (API, media)      | The API itself, on every response (`backend/src/plugins/security.ts`) |
| `/socket.io/*`            | Not needed: no documents, only Socket.IO frames                       |
| Everything else (the app) | `security-headers.conf` in this folder, included by Nginx             |

`security-headers.conf` is **generated** from `shared/config/src/security-headers.ts`, the single
source of truth also used by the API and by `vite dev` / `vite preview`:

```sh
pnpm security:nginx   # rewrite security-headers.conf after changing a header, then commit it
```

A backend test fails while the file is out of date. Never edit it by hand, and never add the same
headers anywhere else in the Nginx config.

## Including it

The production site file is [`deploy/nginx/zuvo.corremadvisory.com.conf`](../../deploy/nginx/zuvo.corremadvisory.com.conf):
`/` goes to the web container (`127.0.0.1:7155`), `/v1/` and `/socket.io/` to the API (`127.0.0.1:7156`).
It includes this file as `/etc/nginx/snippets/zuvo-security-headers.conf` in every app location.
Install and update steps: `docs/runbooks/first-deploy.md` step 5. CI runs that exact site file in
`nginx:1.24` and checks the headers (`deploy/ci/nginx-smoke.sh`).

Things to know:

- **`add_header` is not inherited** into a `location` that has an `add_header` of its own. That is
  why the snippet is included in _every_ app location, not once at `server` level.
- Do not `include` it in `/v1/` or `/socket.io/`: the API's own headers (a stricter CSP, and the
  media files' sandbox CSP) would be duplicated, and browsers apply _both_ CSPs.
- `Strict-Transport-Security` is in the snippet; serve the app only over HTTPS (Certbot redirects
  port 80). The API sends HSTS itself in production.
- The values (final CSP, Permissions-Policy, …) and the reasoning are in `docs/security.md`.
