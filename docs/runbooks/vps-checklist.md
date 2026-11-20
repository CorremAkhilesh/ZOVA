# Server checklist

Check these on the production server (host Nginx + Docker Compose, `docs/adr/0009-production-hosting.md`)
after setting it up and after any change to the Nginx site or the compose file. The setup itself:
`docs/runbooks/first-deploy.md`.

## Nginx (`deploy/nginx/zuvo.corremadvisory.com.conf`)

- **Large files.** Uploads reach the API as chunks of at most 8 MB on `/v1/uploads/*`; downloads are
  long streaming responses on `/v1/media/*`. The site file keeps these working:
  - `/v1/uploads/*`: `client_max_body_size 12m`, 15 minutes per chunk, request buffering off.
  - `POST /v1/uploads/:id/complete`: can take minutes on a 1 GB file (hash + copy): 15-minute timeout.
  - `/v1/media/*`: buffering off and a 1-hour idle timeout; range requests pass through.
- **WebSockets.** `/socket.io/` upgrades (`Upgrade`/`Connection` headers, 1-hour timeouts). CI checks a
  real `101 Switching Protocols` through this exact file.
- **Headers.** The app's locations include `/etc/nginx/snippets/zuvo-security-headers.conf` (a copy of
  `infra/nginx/security-headers.conf`); `/v1/` and `/socket.io/` must not (the API sends its own).
  The CSP allows `blob:` for images and media (unsent files preview from blob URLs), and
  `Permissions-Policy` allows `microphone=(self)` (voice notes).
- **Client IP.** `X-Forwarded-For` is set to `$remote_addr` (not appended), so rate limits see the
  real client and a client cannot fake one.

## Disk

- **Room for 1 GB files and their backups.** `/var/data/zuvo/uploads` holds what people send;
  `/var/backups/zuvo` holds the dumps and hard-linked daily media snapshots (same disk).
- **New uploads stop at 85% used** ("The server is low on storage"); files already sent keep working.
  Admin → Users shows how much each person stores.
- **Finishing a file briefly needs its size twice** (`.uploads/` and storage); the 10% kept free covers
  it on any disk over 20 GB.
- **Alert email at 80%:** the daily backup runs `disk-alert`, which emails every `ADMIN_EMAILS` address.

## Environment (`/var/www/zuvo/deploy/.env.prod`)

- `MEDIA_MAX_FILE_MB=1024`, `VOICE_MAX_SECONDS=900`. `MEDIA_STORAGE_PATH`, `HOST`, `PORT` and
  `NODE_ENV` are set by the compose file (`/data/uploads` = `/var/data/zuvo/uploads`).
- `MAIL_FROM` equals `SMTP_USER` (the API refuses to start otherwise).

## Deploy

- `correm-deploy zuvo <sha>` runs the pre-deploy dump and `db:sync-indexes --expect-db zuvo_prod`
  (the `backup` and `migrate` services) before the new API starts. Production never builds indexes
  on app start.
- The `worker` runs next to the API: it sends email and push, and cleans up unattached uploads hourly.
- Daily database + media backups: `docs/runbooks/backups.md`.
