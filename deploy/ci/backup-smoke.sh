#!/usr/bin/env bash
# CI only: the daily backup, the restore TEST and a REAL restore against the running stack
# (prod-smoke.sh). Proves the scripts in docs/runbooks/first-deploy.md work. sudo -E bash deploy/ci/backup-smoke.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ZUVO_DATA_DIR:?}" "${ZUVO_BACKUP_DIR:?}"
export ZUVO_DIR="$PWD"
compose() { docker compose -p zuvo -f deploy/docker-compose.prod.yml "$@"; }
fail() { echo "::error title=Backup/restore::$*"; exit 1; }
mongo_eval() {
  compose exec -T mongo mongosh --quiet --norc --eval "
    db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
    $1"
}

echo "--- marker document + upload file"
mongo_eval "db.getSiblingDB('zuvo_prod').ci_restore_marker.insertOne({ at: new Date() })" > /dev/null
install -d -o 1000 -g 1000 "$ZUVO_DATA_DIR/uploads/ab"
echo "ci upload" > "$ZUVO_DATA_DIR/uploads/ab/ci-file" && chown 1000:1000 "$ZUVO_DATA_DIR/uploads/ab/ci-file"

echo "--- daily backup"
bash deploy/scripts/backup.sh
day="$(date -u +%F)"
dir="$ZUVO_BACKUP_DIR/daily/$day"
[ -s "$dir/zuvo_prod.archive.gz" ] && [ -f "$dir/uploads/ab/ci-file" ] && [ -f "$dir/env.prod" ] \
  || fail "the backup is incomplete"
grep -q '^upload_files=1$' "$dir/MANIFEST" || fail "MANIFEST must count 1 upload"
bash deploy/scripts/backup.sh > /dev/null   # a second run the same day replaces it
[ ! -e "$dir.old" ] || fail "a second backup left $dir.old behind"

echo "--- retention: 14 days, but never fewer than the newest 3 (fake old snapshots)"
for d in 2020-01-01 2020-01-02 2020-01-03 2020-01-04; do install -d "$ZUVO_BACKUP_DIR/daily/$d"; done
bash deploy/scripts/backup.sh > /dev/null
[ ! -e "$ZUVO_BACKUP_DIR/daily/2020-01-02" ] || fail "retention kept a day older than 14 days"
[ -d "$ZUVO_BACKUP_DIR/daily/2020-01-03" ] || fail "retention must keep the newest 3"
[ -f "$dir/uploads/ab/ci-file" ] || fail "an old snapshot without uploads broke the copy"

echo "--- restore TEST (zuvo_prod untouched)"
out="$(bash deploy/scripts/restore.sh --test "$day")"
echo "$out"
grep -q '^ci_restore_marker 1$' <<< "$out" || fail "the restored copy lacks the marker"
grep -q 'OK: restore test' <<< "$out" || fail "the restore test did not pass"
mongo_eval "print(db.getSiblingDB('admin').adminCommand({ listDatabases: 1 }).databases.map((d) => d.name).join(','))" \
  | grep >/dev/null zuvo_restore_test && fail "zuvo_restore_test was not dropped"

echo "--- REAL restore"
mongo_eval "db.getSiblingDB('zuvo_prod').ci_restore_marker.insertOne({ after: true })" > /dev/null
rm -f "$ZUVO_DATA_DIR/uploads/ab/ci-file"
ZUVO_RESTORE_CONFIRM="RESTORE zuvo_prod" bash deploy/scripts/restore.sh "$day"
[ "$(mongo_eval "print(db.getSiblingDB('zuvo_prod').ci_restore_marker.countDocuments())")" = 1 ] \
  || fail "the real restore did not bring back the backup's data"
[ -f "$ZUVO_DATA_DIR/uploads/ab/ci-file" ] || fail "the real restore did not bring back the uploads"
for attempt in $(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:7148/v1/ready && break
  [ "$attempt" = 30 ] && fail "the API did not come back after the restore"
  sleep 2
done
echo "backup + restore OK"
