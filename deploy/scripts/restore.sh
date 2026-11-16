#!/usr/bin/env bash
# =====================================================================================================
# deploy/scripts/restore.sh: restore a daily backup (deploy/scripts/backup.sh).
#
#   sudo bash deploy/scripts/restore.sh --test <YYYY-MM-DD>   SAFE restore test (monthly): loads the dump
#        into a throwaway database zuvo_restore_test, prints the document counts, checks the uploads
#        snapshot against its MANIFEST, then drops zuvo_restore_test. Users notice nothing.
#   sudo bash deploy/scripts/restore.sh <YYYY-MM-DD>          REAL restore: asks you to type
#        "RESTORE zuvo_prod", dumps the current database to /var/backups/zuvo/pre-restore/ first, stops
#        api + worker, replaces zuvo_prod and the uploads with the backup, then starts them again.
#
# Backups live in /var/backups/zuvo/daily/<day>/ (ls it to pick a day). Passwords never go on a
# command line: they are read inside the mongo container from its environment.
# =====================================================================================================
set -euo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

ZUVO_DIR="${ZUVO_DIR:-/var/www/zuvo}"
DATA_ROOT="${ZUVO_DATA_DIR:-/var/data/zuvo}"
BACKUP_ROOT="${ZUVO_BACKUP_DIR:-/var/backups/zuvo}"
TEST_DB=zuvo_restore_test

log() { printf '%s [zuvo-restore] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FAILED: $*"; exit 1; }
compose() { docker compose -p zuvo -f "$ZUVO_DIR/deploy/docker-compose.prod.yml" "$@"; }
usage() { echo "usage: restore.sh [--test] <YYYY-MM-DD>   (days: ls $BACKUP_ROOT/daily)" >&2; exit 2; }

mode=real
[ "${1:-}" = "--test" ] && { mode=test; shift; }
[ "$#" -eq 1 ] || usage
DAY="$1"
[[ "$DAY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || usage
[ "$(id -u)" -eq 0 ] || die "run it as root"
dir="$BACKUP_ROOT/daily/$DAY"
dump="$dir/zuvo_prod.archive.gz"
[ -s "$dump" ] || die "no backup at $dump"
gzip -t "$dump" || die "$dump is damaged"

# mongorestore inside the mongo container, archive on stdin. $1 = extra mongorestore arguments.
restore_into() {
  compose exec -T mongo sh -c '
    cfg="$(mktemp)"; trap "rm -f \"$cfg\"" EXIT
    printf "password: \"%s\"\n" "$MONGO_INITDB_ROOT_PASSWORD" > "$cfg"
    mongorestore --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin \
      --config "$cfg" --archive --gzip --drop --nsInclude "$MONGODB_DB.*" '"$1" < "$dump"
}

# Runs a mongosh snippet as root (credentials from the container environment).
mongo_eval() {
  compose exec -T mongo mongosh --quiet --norc --eval "
    db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
    $1"
}

counts() {
  mongo_eval "const d = db.getSiblingDB('$1');
    d.getCollectionNames().sort().forEach((c) => print(c + ' ' + d.getCollection(c).countDocuments()));"
}

if [ "$mode" = test ]; then
  log "restore TEST of $DAY into $TEST_DB (zuvo_prod is not touched)"
  restore_into "--nsFrom \"\$MONGODB_DB.*\" --nsTo \"$TEST_DB.*\"" || die "mongorestore failed"
  log "collections and documents in the restored copy:"
  counts "$TEST_DB"
  mongo_eval "db.getSiblingDB('$TEST_DB').dropDatabase()" > /dev/null
  log "dropped $TEST_DB"
  want="$(sed -n 's/^upload_files=//p' "$dir/MANIFEST")"
  have="$(find "$dir/uploads" -type f | wc -l)"
  [ "$want" = "$have" ] || die "uploads snapshot has $have files, MANIFEST says $want"
  log "uploads snapshot: $have files, matches MANIFEST"
  log "OK: restore test of $DAY passed"
  exit 0
fi

# --- Real restore -------------------------------------------------------------------------------------
echo "This REPLACES the live database zuvo_prod and all uploads with the backup of $DAY."
answer="${ZUVO_RESTORE_CONFIRM:-}"
if [ -z "$answer" ]; then
  [ -r /dev/tty ] || die "no terminal to confirm on"
  read -rp 'Type "RESTORE zuvo_prod" to continue: ' answer < /dev/tty
fi
[ "$answer" = "RESTORE zuvo_prod" ] || die "not confirmed; nothing changed"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
safety="$BACKUP_ROOT/pre-restore/$stamp"
install -d -m 0700 "$safety"
log "safety copy of the current state: $safety"
compose exec -T mongo sh -c '
  cfg="$(mktemp)"; trap "rm -f \"$cfg\"" EXIT
  printf "password: \"%s\"\n" "$MONGO_INITDB_ROOT_PASSWORD" > "$cfg"
  mongodump --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin \
    --config "$cfg" --db "$MONGODB_DB" --archive --gzip' > "$safety/zuvo_prod.archive.gz" \
  || die "could not dump the current database; nothing changed"
cp -a "$DATA_ROOT/uploads" "$safety/uploads" || die "could not copy the current uploads; nothing changed"

log "stopping api + worker"
compose stop api worker
restored=0
trap '[ "$restored" = 1 ] || log "RESTORE INCOMPLETE: the safety copy is in $safety"; compose start api worker || true' EXIT
restore_into "" || die "mongorestore failed"
rsync -a --delete "$dir/uploads/" "$DATA_ROOT/uploads/" || die "copying the uploads back failed"
chown -R 1000:1000 "$DATA_ROOT/uploads"
restored=1
log "restored database and uploads of $DAY; starting api + worker"
