#!/usr/bin/env bash
# CI only (job "Production stack" in .github/workflows/ci.yml): deploys the production stack on the
# runner exactly like correm-deploy does on the server, then checks it. Fake secrets, no real SMTP.
#   run as root by the job ($AS_ROOT passes ZUVO_DATA_DIR, ZUVO_BACKUP_DIR and GITHUB_SHA by name)
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ZUVO_DATA_DIR:?}" "${ZUVO_BACKUP_DIR:?}"
export ZUVO_DIR="$PWD"
compose() { docker compose -p zuvo -f deploy/docker-compose.prod.yml "$@"; }
fail() { echo "::error title=Production stack::$*"; exit 1; }
# On any failure: which container is in which state, and the last lines of the app's services.
explain() {
  echo "=== WHY"
  [ -f /tmp/zuvo-up.log ] && { echo "up: $(cat /tmp/zuvo-up.status 2>/dev/null)"; grep -vE "Container |Network |Waiting|Healthy|Started|Created|Running" /tmp/zuvo-up.log | tail -n 6; }
  compose ps -a --format '{{.Service}}: {{.Status}}' || true
  for svc in backup migrate api worker; do compose logs --no-log-prefix --tail 6 "$svc" 2>&1 | sed "s/^/$svc| /" | cut -c1-240 || true; done
}
trap 'status=$?; [ "$status" -eq 0 ] || explain; exit "$status"' EXIT

echo "--- setup-env.sh (the one the owner runs once on the server)"
SMTP_PASS=ci-not-a-real-password bash deploy/scripts/setup-env.sh
# CI never talks to real SMTP.
sed -i 's/^SMTP_HOST=.*/SMTP_HOST=smtp.invalid/' deploy/.env.prod
[ "$(stat -c %a deploy/.env.prod)" = 600 ] || fail "deploy/.env.prod is not chmod 600"
grep -q '^NODE_ENV=production$' deploy/.env.prod || fail "NODE_ENV must be production"
bash deploy/scripts/setup-env.sh | grep >/dev/null 'kept unchanged' || fail "a second setup-env run must change nothing"

echo "--- compose config + the correm-deploy port guard: exactly web 127.0.0.1:7155, api 127.0.0.1:7156"
compose config --quiet
compose config --format json | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const published = [];
    for (const [name, svc] of Object.entries(JSON.parse(s).services))
      for (const p of svc.ports || []) published.push(`${name}=${p.host_ip || "0.0.0.0"}:${p.published}->${p.target}`);
    const want = ["api=127.0.0.1:7156->4000", "web=127.0.0.1:7155->8080"];
    if (JSON.stringify(published.sort()) !== JSON.stringify(want)) {
      console.log("NOT ALLOWED: " + published.join(", ") + " (only " + want.join(", ") + ")"); process.exit(1);
    }
    console.log("published ports OK: " + published.join(", "));
  });' || fail "published ports must be exactly web 127.0.0.1:7155 and api 127.0.0.1:7156"

echo "--- build + up --wait (same flags as correm-deploy)"
compose build
up_wait() {
  local rc=0
  compose up -d --quiet-pull --wait --wait-timeout 300 --remove-orphans > /tmp/zuvo-up.log 2>&1 || rc=$?
  echo "exit $rc" > /tmp/zuvo-up.status; cat /tmp/zuvo-up.log; return "$rc"
}
up_wait

echo "--- checks"
ready="$(curl -fsS http://127.0.0.1:7156/v1/ready)" || fail "/v1/ready is not 200"
echo "$ready"
node -e 'const r = JSON.parse(process.argv[1]); if (r.status !== "ready") process.exit(1)' "$ready" \
  || fail "/v1/ready did not say ready"
[ "$(curl -fsS http://127.0.0.1:7155/health)" = ok ] || fail "web /health"
# The images name the commit they were built from (.git/HEAD through .dockerignore, "meta" stage).
health="$(curl -fsS http://127.0.0.1:7156/v1/health)" || fail "/v1/health is not 200"
echo "$health"
want="${GITHUB_SHA:0:7}"
node -e 'const h = JSON.parse(process.argv[1]); const w = process.argv[2];
  if (!h.builtAt || (w ? h.commit !== w : !/^[0-9a-f]{7}$/.test(h.commit))) process.exit(1)' "$health" "$want"   || fail "/v1/health must name commit ${want:-<sha>} and a build time"
commit="$(node -e 'console.log(JSON.parse(process.argv[1]).commit)' "$health")"
compose exec -T web grep -rl "$commit" /usr/share/nginx/html/assets > /dev/null   || fail "the web app does not carry commit $commit (Help → About)"
compose exec -T api sh -c 'ls -A /app | grep -x .git' > /dev/null && fail "the API image must not contain .git"
curl -fsS http://127.0.0.1:7155/ | grep >/dev/null '<div id="root">' || fail "the app shell did not load"
curl -fsS http://127.0.0.1:7155/chats | grep >/dev/null '<div id="root">' || fail "SPA routes must get the shell"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7155/assets/missing-abc123.js)"
[ "$code" = 404 ] || fail "a missing asset must be 404 (got $code)"
type="$(curl -fsS -o /dev/null -w '%{content_type}' http://127.0.0.1:7155/sounds/chime.wav)" || fail "the chime is missing"
[ "$type" = audio/wav ] || fail "sounds must be served as audio/wav (got $type)"
type="$(curl -fsS -o /dev/null -w '%{content_type}' http://127.0.0.1:7155/manifest.webmanifest)" || fail "the manifest is missing"
[ "$type" = application/manifest+json ] || fail "the manifest must be application/manifest+json (got $type)"
share="$(curl -s -o /dev/null -X POST -F text=hi -w '%{http_code} %{redirect_url}' http://127.0.0.1:7155/share-target)"
[ "${share%% *}" = 303 ] && [[ "$share" == */share\?retry=1 ]] || fail "a share without the service worker must go to /share?retry=1 (got $share)"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7155/sounds/missing.wav)"
[ "$code" = 404 ] || fail "a missing sound must be 404, not the app shell (got $code)"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7156/v1/test/outbox/latest)"
[ "$code" = 404 ] || fail "test-only routes must not exist in production (got $code)"
compose logs migrate | grep -E >/dev/null 'Index changes applied|All indexes are in sync' || fail "migrate did not sync indexes"
compose logs migrate | grep >/dev/null 'Database: zuvo_prod' || fail "migrate must use zuvo_prod"
ls "$ZUVO_BACKUP_DIR"/predeploy/zuvo-*.archive.gz > /dev/null || fail "no predeploy backup"
for svc in api worker web redis; do
  [ "$(docker inspect -f '{{.Config.User}}' "zuvo-$svc-1")" != "" ] || fail "$svc runs as root"
done
compose logs api | grep >/dev/null 'Using MONGODB_DB=zuvo_prod' || fail "the API must log its database"
# What is really published once running: mongo, redis, worker, backup and migrate publish nothing.
ports="$(docker ps -a --filter label=com.docker.compose.project=zuvo --format '{{.Label "com.docker.compose.service"}} {{.Ports}}' | sort)"
echo "$ports"
[ "$(grep -oE '[0-9.]+:[0-9]+->[0-9]+/tcp' <<< "$ports" | sort -u | tr '
' ' ')" = "127.0.0.1:7155->8080/tcp 127.0.0.1:7156->4000/tcp " ]   || fail "running containers must publish only 127.0.0.1:7155 (web) and 127.0.0.1:7156 (api)"
for svc in mongo redis worker; do
  if grep -E "^$svc .*->" <<< "$ports" > /dev/null; then fail "$svc must not publish a port"; fi
done

echo "--- a second deploy (correm-deploy runs up again): backup and migrate run again, API stays up"
up_wait
[ "$(ls "$ZUVO_BACKUP_DIR"/predeploy/zuvo-*.archive.gz | wc -l)" -ge 2 ] || fail "the second deploy made no backup"
curl -fsS -o /dev/null http://127.0.0.1:7156/v1/ready || fail "/v1/ready after the second deploy"
echo "production stack OK"
