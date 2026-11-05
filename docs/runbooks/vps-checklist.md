# VPS checklist

Do these when setting up the VPS, and check them again before a production deploy.

## Caddy

- **Large files.** Uploads reach the API as chunks of at most 8 MB on `/v1/uploads/*`, and downloads as
  long streaming responses on `/v1/media/*`. Caddy has no body limit or response timeout by default.
  If a `request_body max_size` or any `reverse_proxy` timeout is added, keep these working:
  - `/v1/uploads/*`: bodies of at least 8 MB, and at least 10 minutes for one chunk on a slow link.
  - `POST /v1/uploads/:id/complete`: can take minutes on a 1 GB file, because it hashes and copies it.
  - `/v1/media/*`: a 1 GB download can run for hours, so no total-time limit. Keep range requests working.
- **WebSockets.** Proxy `/socket.io` on the app domain and confirm that a real connection upgrades.
- **Content security policy.** Allow `blob:` for images and media: unsent files preview from blob URLs.
- **Microphone.** Voice notes need HTTPS, which browsers require for the microphone. If a
  `Permissions-Policy` header is added, it must allow `microphone=(self)`, or recording fails as "blocked".

## Disk

- **Room for 1 GB files and their backups.** The media volume needs room for the files people send, the
  database dumps, and however many daily media backups are kept. Backups on the same disk count too.
- **New uploads stop at 90% used.** Anyone sending a file then gets "The server is low on storage", and
  files already sent keep working. Admin → Users shows how much each person stores.
- **Finishing a file briefly needs its size twice,** once in `.uploads/` and once in storage. The 10%
  kept free covers this on a disk of 20 GB or more; on a smaller one, lower `MEDIA_MAX_FILE_MB`.
- **Alert email at 80% disk use.** Required by the project brief, and not built yet.

## Environment

- `MEDIA_MAX_FILE_MB` in `/srv/zuvo/*.env`. Leaving it out means 1024 (1 GB).
- `VOICE_MAX_SECONDS` in the same files. Leaving it out means 900 (15 minutes).
- `MEDIA_STORAGE_PATH`: `/srv/zuvo/staging/media` or `/srv/zuvo/prod/media`, on a Docker volume.

## Deploy

- Run `pnpm --filter @zuvo/backend db:sync-indexes`. Production never builds indexes on app start.
- Run the worker as well as the API: it cleans up unattached uploads every hour.
- Back up the media folder daily along with the database.
