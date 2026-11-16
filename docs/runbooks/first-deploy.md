# First production deploy (shared company server)

> **Status:** first production deploy done on 2026-11-16; Steps 1–8 verified. The backup cron runs
> at 02:30 server time (UTC), which is 08:00 IST.

The owner runs these steps once, by hand, over SSH (PuTTY). After that every merge into `main`
deploys by itself (`.github/workflows/deploy.yml`). Design: `docs/adr/0009-production-hosting.md`.

> **This repository is public.** This guide uses placeholders: `<SERVER_IP>`, `<SSH_PORT>`,
> `<ADMIN_USER>` (your sudo login), `<HOST_KEY_FINGERPRINT>`. The real values and the exact commands
> are in the git-ignored `SERVER_STEPS.local.md` on the owner's machine. Never put IPs, user names or
> key fingerprints in tracked files.

| What              | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| URL               | `https://zuvo.corremadvisory.com` (DNS already points at the server)       |
| Ports (127.0.0.1) | `7147` web, `7148` API: free in the server's port plan                     |
| Code              | `/var/www/zuvo` (root-owned git checkout of `CorremAkhilesh/ZOVA`)         |
| Env file          | `/var/www/zuvo/deploy/.env.prod` (600, from `deploy/scripts/setup-env.sh`) |
| Data              | `/var/data/zuvo/db` (999), `/redis` (999:1000), `/uploads` (1000)          |
| Backups           | `/var/backups/zuvo/{predeploy,daily,env}`                                  |
| Compose project   | `zuvo`: mongo, redis, backup, migrate, api, worker, web                    |
| Deploy script     | `/usr/local/bin/correm-deploy zuvo <sha>` (shared by the company's apps)   |

**Never:** touch other sites, containers, databases or ports; `docker compose down -v`;
`docker image prune`; run the repo's dev setup on the server; paste a password into a command.

## 1. Read-only checks (change nothing)

| Check                 | Command                                                                                 | Expected                        |
| --------------------- | --------------------------------------------------------------------------------------- | ------------------------------- |
| Ports free            | `sudo ss -ltnH '( sport = :7147 or sport = :7148 )' \| wc -l`                           | `0`                             |
| Disk                  | `df -h /var /var/lib/docker`                                                            | enough free space (media grows) |
| Docker                | `sudo docker version --format '{{.Server.Version}}'; sudo docker compose version`       | a version each                  |
| Nginx                 | `nginx -v; sudo nginx -t`                                                               | `nginx/1.24…`, `syntax is ok`   |
| Certbot files         | `ls /etc/letsencrypt/options-ssl-nginx.conf /etc/letsencrypt/ssl-dhparams.pem`          | both listed                     |
| Deploy script         | `ls -l /usr/local/bin/correm-deploy; sudo /usr/local/bin/correm-deploy 2>&1 \| tail -1` | `root root`, the app list       |
| deploy user + sudoers | `id deploy; sudo cat /etc/sudoers.d/correm-deploy \| tail -1`                           | uid, the one NOPASSWD line      |
| DNS                   | `getent hosts zuvo.corremadvisory.com`                                                  | `<SERVER_IP>`                   |
| Nothing of Zuvo yet   | `ls -d /var/www/zuvo /var/data/zuvo /etc/nginx/sites-available/zuvo* 2>&1`              | three "No such file" lines      |
| Host tools            | `node -v; rsync --version \| head -1; openssl version`                                  | a version each                  |

## 2. Folders, read-only deploy key, clone, and `zuvo` in correm-deploy

1. A root-owned SSH key that can only **read** this repository: `ssh-keygen -t ed25519` into
   `/root/.ssh/zuvo_deploy` (no passphrase), then add its public key in GitHub → ZOVA → Settings →
   Deploy keys → **Add deploy key**, title `server (read-only)`, **"Allow write access" OFF**.
2. A host alias in `/root/.ssh/config`: `Host github-zuvo` → `HostName github.com`, `User git`,
   `IdentityFile /root/.ssh/zuvo_deploy`, `IdentitiesOnly yes`. Check:
   `sudo git ls-remote git@github-zuvo:CorremAkhilesh/ZOVA.git refs/heads/dev`.
3. Clone: `sudo git clone git@github-zuvo:CorremAkhilesh/ZOVA.git /var/www/zuvo` (root-owned).
4. Add `zuvo` to `/usr/local/bin/correm-deploy` (back up the old one first). The whole change is
   2 changed lines (the app lists) and 3 new lines before the `*)` case:

   ```bash
     zuvo)        PROJECT=zuvo;            FE_PORT=7147; GW_PORT=7148; GW_HEALTH=/v1/ready   # Zuvo (not part of the suite)
                  DIR=/var/www/zuvo
                  REMOTE=git@github-zuvo:CorremAkhilesh/ZOVA.git ;;
   ```

   Nothing else changes: the sudoers line, the other apps and the script's checks stay as they are.
   Its port guard then allows only `127.0.0.1:7147/7148` for Zuvo. Copy the same lines into the
   company's source copy of the script (`correm-platform`, `deploy/server/correm-deploy`) later.

## 3. Env file (once)

```bash
cd /var/www/zuvo && sudo bash deploy/scripts/setup-env.sh
```

Type the SMTP password of `nova@corremadvisory.com` twice (hidden). Everything else is fixed or
generated (`AUTH_SECRET`, MongoDB root + app passwords, the key file, the Redis password, the VAPID
pair). A copy goes to `/var/backups/zuvo/env/`; keep one more copy **off the server**. Running it
again changes nothing.

## 4. First deploy (the same script CI will call)

```bash
sudo /usr/local/bin/correm-deploy zuvo <40-hex sha of dev or main>
```

The first build takes 5–10 minutes. Last line: `==== OK: zuvo is at <sha> and healthy`. Check
`sudo docker compose -p zuvo -f /var/www/zuvo/deploy/docker-compose.prod.yml ps` (all `Up`, mongo,
redis, api and web `healthy`; backup and migrate `Exited (0)`), `curl -s 127.0.0.1:7148/v1/ready`
(`"status":"ready"`) and `curl -s 127.0.0.1:7147/health` (`ok`). Logs:
`sudo tail -n 80 /var/log/correm-deploy/zuvo.log`.

## 5. Nginx site + certificate

1. Headers snippet: `sudo install -m 644 /var/www/zuvo/infra/nginx/security-headers.conf /etc/nginx/snippets/zuvo-security-headers.conf`
2. Certificate first (the site file needs it): `sudo certbot certonly --nginx -d zuvo.corremadvisory.com`
3. Site: `sudo install -m 644 /var/www/zuvo/deploy/nginx/zuvo.corremadvisory.com.conf /etc/nginx/sites-available/zuvo.corremadvisory.com`,
   symlink it into `sites-enabled`, then **`sudo nginx -t`** and only then `sudo systemctl reload nginx`.
4. Check: `curl -sI https://zuvo.corremadvisory.com/ | head -1` → `HTTP/2 200`;
   `sudo certbot renew --dry-run --cert-name zuvo.corremadvisory.com` → success.

Undo (only Zuvo's files): remove the two `zuvo.corremadvisory.com` files from `sites-enabled` and
`sites-available`, `nginx -t`, reload. When `security-headers.conf` changes in the repo, copy it
again and `nginx -t` + reload.

## 6. GitHub: secrets and the Actions key

1. A key pair only for this repo's Actions. Public key → `/home/deploy/.ssh/authorized_keys` with the
   `restrict` option. Private key → GitHub secret `VPS_SSH_KEY`, then delete every local copy.
2. GitHub → ZOVA → Settings → Environments → **production** (created by the first deploy run, or
   create it) → Deployment branches: **main** only. Add the secrets there:
   `VPS_HOST` (`<SERVER_IP>`), `VPS_USER` (`deploy`), `VPS_SSH_PORT` (`<SSH_PORT>`), `VPS_SSH_KEY`,
   `VPS_KNOWN_HOSTS` (`ssh-keyscan -p <SSH_PORT> -t ed25519 <SERVER_IP>`; its fingerprint must be
   `<HOST_KEY_FINGERPRINT>`).
3. Until all five exist, the deploy job skips with a notice. After that, every merge to `main` runs
   CI, then `correm-deploy zuvo <sha>`, then `https://zuvo.corremadvisory.com/v1/ready`, then checks
   that `https://zuvo.corremadvisory.com/v1/health` names that commit (`"commit": "<short sha>"`).

## 7. Backups

`sudo install -m 644 /var/www/zuvo/deploy/cron/zuvo-backup /etc/cron.d/zuvo-backup` (daily 02:30),
run it once by hand (`sudo bash /var/www/zuvo/deploy/scripts/backup.sh` → `OK:`), then the restore
test (`sudo bash /var/www/zuvo/deploy/scripts/restore.sh --test <day>` → `OK: restore test`).
Details, the real restore and the off-server options: `docs/runbooks/backups.md`.

## 8. Final checks (browser)

1. Sign in at `https://zuvo.corremadvisory.com` as `novaadmin@corremadvisory.com` (OTP email
   arrives; Settings shows the admin screens).
2. A second `@corremadvisory.com` account in another browser; chat both ways (ticks, typing).
3. Send a photo, a 50 MB video and a voice note; play the video and seek.
4. Allow notifications (install the app on a phone), close it, send a message from the other
   account: the push arrives.
5. `sudo docker stats --no-stream $(sudo docker ps -q --filter label=com.docker.compose.project=zuvo)`:
   every container under its limit.

## Day to day

| Task                 | How                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| Deploy               | merge `dev` → `main` (only when the owner says so)                                                   |
| Deploy log           | `sudo tail -n 80 /var/log/correm-deploy/zuvo.log`                                                    |
| App logs             | `sudo docker compose -p zuvo -f /var/www/zuvo/deploy/docker-compose.prod.yml logs --tail 100 api`    |
| Emergency admin role | `sudo docker compose -p zuvo -f … exec api node dist/scripts/admin-role.js --email <e> --role admin` |
| Disk space           | backup emails the admins from 80%; uploads stop at 90%. `df -h /var`, `du -sh /var/data/zuvo/*`      |
| Reboot               | every service is `unless-stopped` and comes back by itself                                           |
