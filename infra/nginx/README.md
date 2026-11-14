# Nginx: security headers

Production runs on a shared company server behind Nginx + Certbot (HTTP/2). Nginx serves the built
web app (`frontend/dist`) and proxies `/v1` and `/socket.io` to the API on the same origin.

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

Copy (or symlink) the file to the server, e.g. `/etc/nginx/snippets/zuvo-security-headers.conf`, then:

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name app.zuvo.corremadvisory.com;
    # ssl_certificate … (Certbot)

    root /srv/zuvo/prod/web;   # frontend/dist

    # The API sets its own security headers: forward them, add nothing.
    location /v1/ {
        proxy_pass http://127.0.0.1:4000;   # the API's PORT
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 12m;   # largest request: an 8 MB upload chunk or a 10 MB wallpaper
    }
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;   # the API's PORT
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # The app: static files with the app's security headers.
    location / {
        include /etc/nginx/snippets/zuvo-security-headers.conf;
        try_files $uri /index.html;
    }
    location = /sw.js {
        include /etc/nginx/snippets/zuvo-security-headers.conf;
        add_header Cache-Control "no-cache" always;
    }
    location /assets/ {
        include /etc/nginx/snippets/zuvo-security-headers.conf;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }
}
```

Things to know:

- **`add_header` is not inherited** into a `location` that has an `add_header` of its own. That is
  why the snippet is included in _every_ app location, not once at `server` level.
- Do not `include` it in `/v1/` or `/socket.io/`: the API's own headers (a stricter CSP, and the
  media files' sandbox CSP) would be duplicated, and browsers apply _both_ CSPs.
- `Strict-Transport-Security` is in the snippet; serve the app only over HTTPS (Certbot redirects
  port 80). The API sends HSTS itself in production.
- The values (final CSP, Permissions-Policy, …) and the reasoning are in `docs/security.md`.
