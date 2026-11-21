#!/usr/bin/env bash
# =====================================================================================================
# deploy/scripts/setup-env.sh: creates the production env file ONCE on the server, plus the host data
# folders the stack mounts. The checkout is root-owned, so run it with sudo:
#
#     cd /var/www/zuvo && sudo bash deploy/scripts/setup-env.sh
#
# What it does (nothing else: it never starts or stops containers and never prints a secret):
#   1. Data folders: /var/data/zuvo/db (999 = mongodb), /redis (999:1000 = redis), /uploads (1000 = node)
#      and /var/backups/zuvo (root, 700).
#   2. deploy/.env.prod (chmod 600) with the fixed production values and freshly generated secrets:
#      AUTH_SECRET, MongoDB root + app passwords, the replica-set key file, the Redis password and a
#      VAPID key pair (`node infra/scripts/gen-vapid.mjs`: plain Node, nothing installed).
#      You type only the SMTP password of nova@corremadvisory.com (hidden, never stored elsewhere).
#   3. A copy of the new file in /var/backups/zuvo/env/ (600). Keep one more copy OFF the server:
#      without it the database cannot be opened again.
#
# An existing deploy/.env.prod is NEVER overwritten (the script changes nothing and exits 0). If the
# database folder already holds data but the env file is missing, it stops: new passwords would not
# open that database (restore the env file from the backup instead).
# CI runs it with SMTP_PASS set and ZUVO_DATA_DIR / ZUVO_BACKUP_DIR pointing at temporary folders.
# =====================================================================================================
set -euo pipefail
umask 077

DATA_ROOT="${ZUVO_DATA_DIR:-/var/data/zuvo}"
BACKUP_ROOT="${ZUVO_BACKUP_DIR:-/var/backups/zuvo}"
PUBLIC_URL=https://zuvo.corremadvisory.com
SMTP_USER=nova@corremadvisory.com

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(dirname "$DEPLOY_DIR")"
ENV_FILE="$DEPLOY_DIR/.env.prod"

die() { echo "setup-env: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run it as root: cd /var/www/zuvo && sudo bash deploy/scripts/setup-env.sh"
command -v openssl > /dev/null || die "openssl is not installed"
command -v node > /dev/null || die "node is not installed (used only for the VAPID key pair)"

# --- 1. Data folders (always safe: never deletes or empties anything) ------------------------------
install -d -m 0755 "$DATA_ROOT"
install -d -o 999 -g 999 -m 0700 "$DATA_ROOT/db"
install -d -o 999 -g 1000 -m 0700 "$DATA_ROOT/redis"
install -d -o 1000 -g 1000 -m 0750 "$DATA_ROOT/uploads"
install -d -o root -g root -m 0700 "$BACKUP_ROOT" "$BACKUP_ROOT/env"
echo "data folders: $DATA_ROOT/{db,redis,uploads}, backups: $BACKUP_ROOT"

# --- Never overwrite ---------------------------------------------------------------------------------
if [ -e "$ENV_FILE" ]; then
  chmod 600 "$ENV_FILE"
  echo "deploy/.env.prod already exists: kept unchanged (nothing new was generated)."
  exit 0
fi
if [ -n "$(ls -A "$DATA_ROOT/db" 2> /dev/null)" ]; then
  die "$DATA_ROOT/db already has MongoDB data but deploy/.env.prod is missing: new passwords would not open it. Restore it from $BACKUP_ROOT/env/ instead."
fi

# --- 2. The SMTP password (typed, hidden) ------------------------------------------------------------
if [ -z "${SMTP_PASS:-}" ]; then
  [ -r /dev/tty ] || die "no terminal to ask for the SMTP password"
  read -rsp "SMTP password for $SMTP_USER (hidden): " SMTP_PASS < /dev/tty; echo
  read -rsp "Type it again: " again < /dev/tty; echo
  [ "$SMTP_PASS" = "$again" ] || die "the two passwords differ; nothing was written"
  unset again
fi
[ -n "$SMTP_PASS" ] || die "the SMTP password is empty; nothing was written"
case "$SMTP_PASS" in *$'\n'*|*\"*|*\'*|*\\*|*'$'*|*'`'*) die "the SMTP password contains a quote, backslash, \$ or backtick; change it in Hostinger first" ;; esac

# --- Generate ----------------------------------------------------------------------------------------
hex() { openssl rand -hex "$1"; }
AUTH_SECRET="$(hex 32)"
ROOT_PASSWORD="$(hex 32)"
APP_PASSWORD="$(hex 32)"
REDIS_PASSWORD="$(hex 32)"
KEYFILE="$(openssl rand -base64 756 | tr -d '\r\n')"
VAPID="$(node "$REPO_DIR/infra/scripts/gen-vapid.mjs")"
VAPID_PUBLIC_KEY="$(printf '%s\n' "$VAPID" | sed -n 's/^VAPID_PUBLIC_KEY=//p')"
VAPID_PRIVATE_KEY="$(printf '%s\n' "$VAPID" | sed -n 's/^VAPID_PRIVATE_KEY=//p')"
unset VAPID
[ "${#AUTH_SECRET}" -eq 64 ] && [ "${#APP_PASSWORD}" -eq 64 ] && [ "${#KEYFILE}" -ge 1000 ] \
  && [ "${#KEYFILE}" -le 1024 ] && [ "${#VAPID_PUBLIC_KEY}" -eq 87 ] && [ "${#VAPID_PRIVATE_KEY}" -eq 43 ] \
  && [ "$ROOT_PASSWORD" != "$APP_PASSWORD" ] || die "the generated values do not look right; nothing was written"

tmp="$(mktemp "$DEPLOY_DIR/.env.prod.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
cat > "$tmp" << EOF
# Zuvo production (deploy/docker-compose.prod.yml). Written by deploy/scripts/setup-env.sh on $(date -u +%Y-%m-%d).
# Never commit, never paste anywhere. Changing a password here does NOT change it in an existing database.
NODE_ENV=production
APP_URL=$PUBLIC_URL
API_URL=$PUBLIC_URL
CORS_ORIGINS=$PUBLIC_URL
ALLOWED_EMAIL_DOMAINS=corremadvisory.com
ADMIN_EMAILS=novaadmin@corremadvisory.com
AUTH_SECRET=$AUTH_SECRET
OTP_IP_LIMIT_PER_HOUR=30
SOCKET_HANDSHAKES_PER_MINUTE=600
MEDIA_MAX_FILE_MB=1024
MEDIA_USER_QUOTA_MB=3072
STORAGE_GUARD_PERCENT=85
VOICE_MAX_SECONDS=900
LOG_LEVEL=info

MONGODB_DB=zuvo_prod
MONGODB_URI=mongodb://zuvo:$APP_PASSWORD@mongo:27017/zuvo_prod?replicaSet=rs0&authSource=zuvo_prod
MONGO_INITDB_ROOT_USERNAME=root
MONGO_INITDB_ROOT_PASSWORD=$ROOT_PASSWORD
MONGO_KEYFILE=$KEYFILE
ZUVO_DB_USER=zuvo
ZUVO_DB_PASSWORD=$APP_PASSWORD

REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_URL=redis://:$REDIS_PASSWORD@redis:6379

SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
MAIL_FROM=$SMTP_USER

VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY
VAPID_SUBJECT=mailto:$SMTP_USER
EOF
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT
unset AUTH_SECRET ROOT_PASSWORD APP_PASSWORD REDIS_PASSWORD KEYFILE VAPID_PRIVATE_KEY SMTP_PASS

copy="$BACKUP_ROOT/env/env.prod.$(date -u +%Y%m%dT%H%M%SZ)"
install -m 0600 "$ENV_FILE" "$copy"
echo "created deploy/.env.prod (chmod 600; secrets generated, not shown). Copy: $copy"
echo "APP_URL=$PUBLIC_URL  MONGODB_DB=zuvo_prod  ADMIN_EMAILS=novaadmin@corremadvisory.com"
echo "KEEP A COPY OFF THIS SERVER: without it the database cannot be opened."
echo "next: sudo /usr/local/bin/correm-deploy zuvo <40-hex sha>"
