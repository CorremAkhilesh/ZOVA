# The host Nginx site file

`deploy/nginx/zuvo.corremadvisory.com.conf` is the source of truth. The server uses a **copy**,
`/etc/nginx/sites-available/zuvo.corremadvisory.com`, and **a deploy never updates it**:
`correm-deploy` builds and starts containers only, and must not touch the shared Nginx.

So a fix to the site file reaches production only when the owner installs it by hand. In November
2026 the repo was fixed but the server still had `location /v1/uploads/`, which made Nginx answer
`POST /v1/uploads` with its own 301. Browsers retried that as a `GET` without the body, and no photo
or file could be sent until the copy on the server was changed.

## How drift is caught

- **Every deploy** (`.github/workflows/deploy.yml`, last step) runs `deploy/ci/live-routes.sh`
  against `https://zuvo.corremadvisory.com`. Signed out, each critical route must reach the API
  (its own status and `x-request-id` header), never an Nginx redirect or error page: `/v1/ready`,
  `POST /v1/uploads`, an upload's `GET`/`PATCH`/`complete`, `/v1/media/…/link`, `/v1/chats`,
  `/v1/auth/me`, and the Socket.IO handshake. A red step there means the server's site file differs
  from the repo's.
- **CI** ("Production stack (Docker)" → `nginx-smoke.sh`) runs the same check on the repo's site
  file in a real `nginx:1.24`, and proves it would catch the November drift: it fails on a copy with
  `location /v1/uploads/`. `upload-smoke.sh` then sends a real photo through it.
- **By hand**, any time (read-only):

  ```bash
  sudo diff -u /etc/nginx/sites-available/zuvo.corremadvisory.com /var/www/zuvo/deploy/nginx/zuvo.corremadvisory.com.conf
  ```

  `/var/www/zuvo` is at the deployed commit, so no output means the server runs the repo's file.
  Lines Certbot added (if any) show up here too; they are expected.

## Changing the site file

1. Change `deploy/nginx/zuvo.corremadvisory.com.conf` on `dev`. CI runs it in `nginx:1.24` with a
   self-signed certificate and checks HTTP/2, headers, caching, WebSocket, every route and a real
   upload. Merge to `main` as usual; the deploy puts the new file in `/var/www/zuvo`.
2. On the server (PuTTY), install it, with a dated backup, and reload only if `nginx -t` passes:

   ```bash
   SITE=/etc/nginx/sites-available/zuvo.corremadvisory.com; BAK=/var/backups/zuvo/nginx/zuvo.corremadvisory.com.bak-$(date +%Y%m%d-%H%M%S); \
   sudo install -d -m 700 /var/backups/zuvo/nginx && sudo cp -a "$SITE" "$BAK" && echo "backup: $BAK" && \
   sudo diff -u "$SITE" /var/www/zuvo/deploy/nginx/zuvo.corremadvisory.com.conf; \
   sudo cp /var/www/zuvo/deploy/nginx/zuvo.corremadvisory.com.conf "$SITE" && \
   sudo nginx -t && sudo systemctl reload nginx && \
   bash /var/www/zuvo/deploy/ci/live-routes.sh https://zuvo.corremadvisory.com
   ```

   Read the `diff` before it is applied: it shows exactly what changes. The last line must be
   `Nginx routes OK on https://zuvo.corremadvisory.com`.
3. If `nginx -t` fails or the site misbehaves, put the backup back:

   ```bash
   SITE=/etc/nginx/sites-available/zuvo.corremadvisory.com; BAK=$(sudo ls -1t /var/backups/zuvo/nginx/ | head -n 1); \
   [ -n "$BAK" ] && sudo cp -a "/var/backups/zuvo/nginx/$BAK" "$SITE" && sudo nginx -t && sudo systemctl reload nginx && echo "restored $BAK"
   ```

Never edit other sites, `nginx.conf`, or the shared security-headers snippet for a Zuvo change.
