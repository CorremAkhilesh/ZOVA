#!/bin/sh
# One-shot `backup` service (deploy/docker-compose.prod.yml), runs inside the mongo:8.0 image on every
# deploy and rollback, BEFORE `migrate` syncs indexes and before the new API starts.
# Writes /backups/predeploy/zuvo-<UTC time>.archive.gz (= /var/backups/zuvo/predeploy on the host)
# and keeps the newest 10. The root password goes in a temporary config file, never on a command line.
set -eu
umask 077
dir=/backups/predeploy
mkdir -p "$dir"
cfg="$(mktemp)"
trap 'rm -f "$cfg"' EXIT
printf 'password: "%s"\n' "$MONGO_INITDB_ROOT_PASSWORD" > "$cfg"
out="$dir/zuvo-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"
mongodump --quiet --host mongo:27017 --username "$MONGO_INITDB_ROOT_USERNAME" \
  --authenticationDatabase admin --config "$cfg" --db "$MONGODB_DB" --archive="$out.part" --gzip
mv "$out.part" "$out"
echo "predeploy backup: $out ($(du -h "$out" | cut -f1))"
# Keep the newest 10 (names sort by time).
ls -1 "$dir"/zuvo-*.archive.gz | sort -r | tail -n +11 | while read -r old; do rm -f "$old"; done
