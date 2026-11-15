#!/usr/bin/env bash
# CI only (job "Production stack" in .github/workflows/ci.yml): deploys the production stack on the
# runner exactly like correm-deploy does on the server, then checks it. Fake secrets, no real SMTP.
#   sudo -E bash deploy/ci/prod-smoke.sh   (ZUVO_DATA_DIR and ZUVO_BACKUP_DIR set by the job)
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ZUVO_DATA_DIR:?}" "${ZUVO_BACKUP_DIR:?}"
export ZUVO_DIR="$PWD"
compose() { docker compose -p zuvo -f deploy/docker-compose.prod.yml "$@"; }
fail() { echo "::error title=Production stack::$*"; exit 1; }

echo "--- setup-env.sh (the one the owner runs once on the server)"
SMTP_PASS=ci-not-a-real-password bash deploy/scripts/setup-env.sh
# CI never talks to real SMTP.
sed -i 's/^SMTP_HOST=.*/SMTP_HOST=smtp.invalid/' deploy/.env.prod
[ "$(stat -c %a deploy/.env.prod)" = 600 ] || fail "deploy/.env.prod is not chmod 600"
grep -q '^NODE_ENV=production$' deploy/.env.prod || fail "NODE_ENV must be production"
bash deploy/scripts/setup-env.sh | grep -q 'kept unchanged' || fail "a second setup-env run must change nothing"

echo "--- compose config + the correm-deploy port guard (only 127.0.0.1:7147 and :7148)"
compose config --quiet
compose config --format json | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const bad = [];
    for (const [name, svc] of Object.entries(JSON.parse(s).services))
      for (const p of svc.ports || [])
        if (p.host_ip !== "127.0.0.1" || !["7147", "7148"].includes(String(p.published)))
          bad.push(`${name} ${p.host_ip || "0.0.0.0"}:${p.published}`);
    if (bad.length) { console.log("NOT ALLOWED: " + bad.join(", ")); process.exit(1); }
    console.log("published ports OK");
  });'

echo "--- build + up --wait (same flags as correm-deploy)"
compose build
compose up -d --wait --wait-timeout 300 --remove-orphans

echo "--- checks"
ready="$(curl -fsS http://127.0.0.1:7148/v1/ready)" || fail "/v1/ready is not 200"
echo "$ready"
node -e 'const r = JSON.parse(process.argv[1]); if (r.status !== "ready") process.exit(1)' "$ready" \
  || fail "/v1/ready did not say ready"
[ "$(curl -fsS http://127.0.0.1:7147/health)" = ok ] || fail "web /health"
curl -fsS http://127.0.0.1:7147/ | grep -q '<div id="root">' || fail "the app shell did not load"
curl -fsS http://127.0.0.1:7147/chats | grep -q '<div id="root">' || fail "SPA routes must get the shell"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7147/assets/missing-abc123.js)"
[ "$code" = 404 ] || fail "a missing asset must be 404 (got $code)"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7148/v1/test/outbox/latest)"
[ "$code" = 404 ] || fail "test-only routes must not exist in production (got $code)"
compose logs migrate | grep -Eq 'Index changes applied|All indexes are in sync' || fail "migrate did not sync indexes"
compose logs migrate | grep -q 'Database: zuvo_prod' || fail "migrate must use zuvo_prod"
ls "$ZUVO_BACKUP_DIR"/predeploy/zuvo-*.archive.gz > /dev/null || fail "no predeploy backup"
for svc in api worker web redis; do
  [ "$(docker inspect -f '{{.Config.User}}' "zuvo-$svc-1")" != "" ] || fail "$svc runs as root"
done
compose logs api | grep -q 'Using MONGODB_DB=zuvo_prod' || fail "the API must log its database"

echo "--- a second deploy (correm-deploy runs up again): backup and migrate run again, API stays up"
compose up -d --wait --wait-timeout 300 --remove-orphans
[ "$(ls "$ZUVO_BACKUP_DIR"/predeploy/zuvo-*.archive.gz | wc -l)" -ge 2 ] || fail "the second deploy made no backup"
curl -fsS -o /dev/null http://127.0.0.1:7148/v1/ready || fail "/v1/ready after the second deploy"
echo "production stack OK"
