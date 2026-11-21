#!/usr/bin/env bash
# =====================================================================================================
# deploy/scripts/backup.sh: daily backup of Zuvo (root cron: deploy/cron/zuvo-backup).
#
#     sudo bash /var/www/zuvo/deploy/scripts/backup.sh
#
# Writes /var/backups/zuvo/daily/<YYYY-MM-DD>/ with:
#   zuvo_prod.archive.gz  mongodump of zuvo_prod (gzip archive; checked with `gzip -t`)
#   uploads/              the media folder; unchanged files are hard links to the day before (rsync
#                         --link-dest), so each day costs only what changed
#   env.prod              deploy/.env.prod (600): without it the database cannot be opened
#   MANIFEST              date, commit, sizes, file count
# Keeps 14 days (always at least the newest 3). From 80% disk usage it emails ADMIN_EMAILS.
# Read-only for the app: never stops a container, never touches /var/data except reading it.
# Exit 0 = backup complete. Anything else: look at /var/log/zuvo-backup.log.
# =====================================================================================================
set -euo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

ZUVO_DIR="${ZUVO_DIR:-/var/www/zuvo}"
DATA_ROOT="${ZUVO_DATA_DIR:-/var/data/zuvo}"
BACKUP_ROOT="${ZUVO_BACKUP_DIR:-/var/backups/zuvo}"
KEEP_DAYS="${ZUVO_BACKUP_KEEP_DAYS:-14}"
DAY="${ZUVO_BACKUP_DAY:-$(date -u +%F)}"

log() { printf '%s [zuvo-backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FAILED: $*"; exit 1; }
compose() { docker compose -p zuvo -f "$ZUVO_DIR/deploy/docker-compose.prod.yml" "$@"; }

[ "$(id -u)" -eq 0 ] || die "run it as root"
[[ "$DAY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "bad day $DAY"
exec 9> /run/lock/zuvo-backup.lock
flock -n 9 || die "another backup is running"

daily="$BACKUP_ROOT/daily"
dir="$daily/$DAY"
install -d -m 0700 "$BACKUP_ROOT" "$daily"
[ -e "$dir" ] && rm -rf "$dir.old" && mv "$dir" "$dir.old"   # a second run the same day replaces it
install -d -m 0700 "$dir"
log "start: $dir"

# --- MongoDB: the root password goes into a temp file inside the container, never on a command line --
compose exec -T mongo sh -c '
  cfg="$(mktemp)"; trap "rm -f \"$cfg\"" EXIT
  printf "password: \"%s\"\n" "$MONGO_INITDB_ROOT_PASSWORD" > "$cfg"
  mongodump --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin \
    --config "$cfg" --db "$MONGODB_DB" --archive --gzip' > "$dir/zuvo_prod.archive.gz.part" \
  || die "mongodump failed"
gzip -t "$dir/zuvo_prod.archive.gz.part" || die "the dump is not a valid gzip archive"
mv "$dir/zuvo_prod.archive.gz.part" "$dir/zuvo_prod.archive.gz"
log "database: $(du -h "$dir/zuvo_prod.archive.gz" | cut -f1)"

# --- Uploads: hard-linked daily snapshot -------------------------------------------------------------
prev="$(find "$daily" -mindepth 2 -maxdepth 2 -type d -name uploads -path '*/????-??-??/uploads' \
  ! -path "$dir/uploads" | sort | tail -n 1)"
if command -v rsync > /dev/null; then
  rsync -a --delete ${prev:+--link-dest="$prev"} "$DATA_ROOT/uploads/" "$dir/uploads/" \
    || die "copying the uploads failed"
else
  cp -a "$DATA_ROOT/uploads" "$dir/uploads" || die "copying the uploads failed"
fi
files="$(find "$dir/uploads" -type f | wc -l)"
log "uploads: $files files"

# --- Env file + manifest ------------------------------------------------------------------------------
install -m 0600 "$ZUVO_DIR/deploy/.env.prod" "$dir/env.prod"
commit="$(git -c safe.directory="$ZUVO_DIR" -C "$ZUVO_DIR" rev-parse HEAD 2> /dev/null || echo unknown)"
{
  echo "day=$DAY"
  echo "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit=$commit"
  echo "database_bytes=$(stat -c %s "$dir/zuvo_prod.archive.gz")"
  echo "upload_files=$files"
} > "$dir/MANIFEST"
rm -rf "$dir.old"

# --- Retention: KEEP_DAYS days, never fewer than the newest 3 -----------------------------------------
cutoff="$(date -u -d "$DAY - $((KEEP_DAYS - 1)) days" +%F)"
find "$daily" -mindepth 1 -maxdepth 1 -type d -name '????-??-??' | sort -r | tail -n +4 \
  | while read -r old; do
      if [[ "$(basename "$old")" < "$cutoff" ]]; then rm -rf "$old" && log "removed $(basename "$old")"; fi
    done

# --- Disk usage: email the admins from 80% (the API refuses uploads at 85%) ---------------------------
read -r percent free_kib < <(df -Pk "$DATA_ROOT" | awk 'NR==2 { sub("%", "", $5); print $5, $4 }')
log "disk: ${percent}% used on $DATA_ROOT"
if [ "$percent" -ge 80 ]; then
  log "WARNING: disk ${percent}% full"
  free_gib="$(awk -v k="$free_kib" 'BEGIN { printf "%.1f", k / 1048576 }')"
  compose exec -T api node dist/scripts/disk-alert.js --percent "$percent" --free-gib "$free_gib" \
    --path "$DATA_ROOT" || log "WARNING: the disk alert email could not be sent"
fi
# Admin → Dashboard shows when the last backup finished well.
compose exec -T api node dist/scripts/backup-done.js --files "$files" \
  || log "WARNING: the backup could not be recorded for the dashboard"
log "OK: $dir"
