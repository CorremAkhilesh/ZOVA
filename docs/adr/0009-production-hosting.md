# ADR 0009: Production hosting on the shared company server

**Status:** accepted (Step 21)

## Decision

Zuvo runs in production on the company's existing Ubuntu server, which already hosts other apps.

- **One origin, no staging.** `https://zuvo.corremadvisory.com` serves the app, `/v1` and
  `/socket.io`. There is no staging stack, and no `app.` / `api.` / `dev-app.` hosts.
- **Host Nginx, not Caddy.** The server's own Nginx (ports 80/443, certificates from Certbot) is the
  only public entry. It proxies `/` to the web container and `/v1` + `/socket.io` to the API, adds
  the app's security headers (`infra/nginx/security-headers.conf`) and serves HTTP/2. The site file
  is `deploy/nginx/zuvo.corremadvisory.com.conf`.
- **Own MongoDB in Docker, not Atlas, for production.** A `mongo:8.0` container (single-node
  replica set `rs0`, so transactions work; auth and a key file) holds `zuvo_prod`. Development keeps
  using Atlas (`zuvo_dev<N>`), and tests keep using `mongodb-memory-server`.
- **Own Redis in Docker** (password, `noeviction`, append-only file), never published.
- **Docker Compose project `zuvo`** (`deploy/docker-compose.prod.yml`): mongo, redis, a pre-deploy
  `backup` and a `migrate` (index sync) one-shot, api, worker, web. Only `127.0.0.1:7155` (web) and
  `127.0.0.1:7156` (API) are published. Data lives in host folders under `/var/data/zuvo`.
- **Deploys go through the server's `correm-deploy` script** (root-owned, run by the `deploy` user
  through sudo), the same as the other company apps: fetch the commit, build, start, health check,
  roll back to the previous commit on failure. GitHub Actions only calls it over SSH from `main`.

## Why

- The server and its rules already exist (a single Nginx on 80/443, `127.0.0.1`-only ports, bind
  mounts, the `correm-deploy` flow). A second proxy such as Caddy could not take 80/443 there.
- Data stays on company hardware, close to the media files. A database on the same machine removes
  the network round trip to Atlas on every query.
- One origin keeps cookies host-only and needs no CORS for the app.

## Consequences

- Backups are our job: a `mongodump` before every deploy, a daily dump + media snapshot
  (`deploy/scripts/backup.sh`, 14 days), and a tested restore (`docs/runbooks/backups.md`). A weekly
  copy off the server is still to be chosen.
- Memory and CPU limits on every container keep Zuvo from starving the other apps.
- Images are built on the server from the checked-out commit (no registry). A rollback rebuilds the
  previous commit, which is fast because Docker's layer cache still holds it.
