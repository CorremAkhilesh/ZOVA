#!/usr/bin/env bash
# CI only: a REAL photo upload against the running production stack (prod-smoke.sh), through the
# real host Nginx site file, the way the app sends one (deploy/ci/upload-smoke.mjs). Sign-in codes
# go to a capture SMTP server on the stack's private network instead of a mailbox. Afterwards the
# stack is put back as it was (SMTP settings, no extra containers).
# Run as root by the job ($AS_ROOT bash deploy/ci/run.sh deploy/ci/upload-smoke.sh).
set -euo pipefail
cd "$(dirname "$0")/../.."
compose() { docker compose -p zuvo -f deploy/docker-compose.prod.yml "$@"; }
fail() { echo "::error title=Real upload::$*"; exit 1; }
# shellcheck source=deploy/ci/host-nginx.sh
. deploy/ci/host-nginx.sh

mail="$(mktemp -d)"
chmod 777 "$mail"
env_backup="$(mktemp)"
cp -a deploy/.env.prod "$env_backup"
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "=== WHY"
    docker logs zuvo-host-nginx 2>&1 | tail -n 10 || true
    docker logs zuvo-ci-smtp 2>&1 | tail -n 5 || true
    compose logs --no-log-prefix --tail 15 api worker 2>&1 | cut -c1-240 || true
  fi
  stop_host_nginx
  docker rm -f zuvo-ci-smtp > /dev/null 2>&1 || true
  cp -a "$env_backup" deploy/.env.prod
  compose up -d --quiet-pull --wait --wait-timeout 300 api worker > /dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

echo "--- capture SMTP on the stack network, and the API + worker pointed at it"
docker rm -f zuvo-ci-smtp > /dev/null 2>&1 || true
docker run -d --name zuvo-ci-smtp --network zuvo_default -u 1000:1000 \
  -v "$PWD/deploy/ci/smtp-capture.mjs:/smtp/capture.mjs:ro" -v "$mail:/out" \
  node:24-alpine node /smtp/capture.mjs /out 2525 > /dev/null
sed -i -e 's/^SMTP_HOST=.*/SMTP_HOST=zuvo-ci-smtp/' -e 's/^SMTP_PORT=.*/SMTP_PORT=2525/' \
  -e 's/^SMTP_SECURE=.*/SMTP_SECURE=false/' deploy/.env.prod
compose up -d --quiet-pull --wait --wait-timeout 300 api worker || fail "the API did not come back with the CI mail settings"

echo "--- the host Nginx site in front, reached by its real name"
start_host_nginx || fail "nginx -t failed"
grep -q " $HOST\$" /etc/hosts || echo "127.0.0.1 $HOST" >> /etc/hosts
[ "$(c -o /dev/null -w '%{http_code}' "https://$HOST/v1/ready")" = 200 ] || fail "/v1/ready through Nginx"

MAIL_DIR="$mail" NODE_TLS_REJECT_UNAUTHORIZED=0 node deploy/ci/upload-smoke.mjs
