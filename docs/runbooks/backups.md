# Backups and restore (production)

Everything here runs on the server as root. CI runs the same scripts against a throwaway copy of the
production stack on every push (job "Production stack (Docker)", `deploy/ci/backup-smoke.sh`).

## What is backed up, when, where

| Backup          | When                                         | Where (`/var/backups/zuvo/…`)          | Kept           |
| --------------- | -------------------------------------------- | -------------------------------------- | -------------- |
| Pre-deploy dump | every deploy and rollback, before index sync | `predeploy/zuvo-<UTC time>.archive.gz` | newest 10      |
| Daily           | 02:30 (`/etc/cron.d/zuvo-backup`)            | `daily/<YYYY-MM-DD>/`                  | 14 days (≥ 3)  |
| Env file        | once, by `setup-env.sh`; and in every daily  | `env/`, `daily/<day>/env.prod`         | forever / 14 d |

A daily folder holds `zuvo_prod.archive.gz` (gzip `mongodump` archive, tested with `gzip -t`),
`uploads/` (the media folder; unchanged files are hard links to the day before, so a day costs
only what changed), `env.prod` and `MANIFEST`. Log: `/var/log/zuvo-backup.log`.

From 80% disk usage the daily run emails every `ADMIN_EMAILS` address (`disk-alert`). At 90% the API
refuses new uploads (`507 STORAGE_FULL`).

## Restore test (monthly, safe while people use the app)

```bash
ls /var/backups/zuvo/daily/
sudo bash /var/www/zuvo/deploy/scripts/restore.sh --test <YYYY-MM-DD>
```

It loads the dump into a throwaway database `zuvo_restore_test`, prints every collection with its
document count (compare with what you expect: users, chats, messages), checks that the uploads
snapshot has as many files as its `MANIFEST` says, and drops `zuvo_restore_test`. Last line:
`OK: restore test of <day> passed`. `zuvo_prod` and the running app are not touched.

## Real restore (data loss or corruption only)

```bash
sudo bash /var/www/zuvo/deploy/scripts/restore.sh <YYYY-MM-DD>
```

1. Asks you to type `RESTORE zuvo_prod`.
2. Saves the current database and uploads to `pre-restore/<time>/` (so the restore can be undone).
3. Stops `api` and `worker` (the app shows "reconnecting"), replaces `zuvo_prod` (`mongorestore
   --drop`) and the uploads, then starts them again.

Everything written after the backup's day is lost (the pre-restore copy still has it). If the
server itself is lost: new server → `first-deploy.md` steps 1–2 → put the backup's `env.prod` at
`/var/www/zuvo/deploy/.env.prod` (600) **before** step 3 (setup-env then keeps it) → step 4 →
restore the newest daily backup.

## Weekly copy off the server (to choose; not built yet)

All backups are on the same disk as the data: a disk failure or a lost server takes both. Options:

| Option                                           | How                                                                                      | Cost / notes                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **restic → S3-compatible storage** (recommended) | weekly `restic backup /var/backups/zuvo/daily/<newest>` to Cloudflare R2 or Backblaze B2 | encrypted, deduplicated, cheap (≈ a few $/month for 100 GB); needs one bucket key on the server |
| rclone → company Google Drive / OneDrive         | `rclone copy` with an `rclone crypt` remote                                              | no new vendor; quotas and API limits on large media                                             |
| Pull from another company machine                | that machine runs `rsync -a` over SSH from a read-only backup user                       | the server holds no outside credentials; needs a 2nd machine                                    |
| Manual                                           | download the newest daily folder weekly (WinSCP)                                         | free; depends on someone remembering                                                            |

Whichever is chosen: encrypt before it leaves the server, test a restore from the copy, and keep
the env file copy separate from the data copy.
